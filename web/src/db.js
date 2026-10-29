// ============================================================================
//  Base locale (IndexedDB via Dexie) — source de vérité hors ligne  (schéma v4)
// ============================================================================
//
//  Store `interventions` — une fiche par mission
//    id, reference, title, url, readOnlyData, templateBlocks, templateWarnings,
//    schema, remoteEditedAt, fetchedAt      lus dans Notion (getIntervention)
//    fields, custom, customRemovals, photoRemovals, conflicts, shared, pendingStatus
//                                           état du rapport partagé (voir lib/shared.js)
//    status         'draft' | 'validated'   statut EFFECTIF (ma demande en attente
//                                           prime sur celui du serveur)
//    baseRev        dernière révision serveur connue
//    needsSync      1 si quelque chose reste à envoyer (index)
//    syncing, syncStartedAt   envoi en cours (verrou entre onglets, expire à 10 min)
//    lastSyncAt, lastAttemptAt, nextTryAt, attempts, lastError   suivi des envois
//    notice         message à montrer (ex. « validé par un collègue »)
//    lastUpdated    dernière saisie locale
//
//  Store `media_queue` — une ligne par photo prise sur CET appareil
//    mediaId PK · interventionId · blockId (= id du COMPOSANT du template, ou d'un
//    champ ajouté) · fileBlob (JPEG) · fileName, mimeType, size, createdAt
//    uploadStatus  'queued' (local) → 'uploaded' (copie Drive de transit : driveFileId)
//                  → 'done' (présente dans le rapport Notion) ; 'failed' (abandonnée)
//    uploadAttempts, lastError
//
//  Store `methods_index` — liste des fiches méthodes : une ligne { key:'list', rev, items, fetchedAt }
//  Store `methods`       — fiches méthodes lues (corps complet) : id PK, title, updated, fetchedAt
//  Store `method_media`  — images / fichiers des fiches : id = `pageId|clé` PK, pageId (index),
//                          blob, mime, name, size, fetchedAt. Les adresses Notion expirent au bout
//                          d'environ une heure : on ne garde jamais d'adresse, seulement le fichier.
//
//  Stores `machines_index`, `machines`, `machine_media` — idem, pour la liste des machines (schéma v4).
//
//  Store `racks_overview` (une ligne 'overview') et `racks_sites` (une ligne par site : liste des racks/casiers KO)
//  Store `outbox`        — envois en attente (commentaires de méthode, diagnostics de racks) : id PK, kind,
//                          payload, createdAt, status 'pending' | 'failed', attempts, lastError  (schéma v5)
//
//  `createStore(nom)` crée une base indépendante (tests à deux appareils) ; les
//  exports nommés ci-dessous sont ceux de la base de l'application.
// ============================================================================

import Dexie from 'dexie'
import { uuid } from './lib/uuid.js'
import {
  effectiveStatus, needsSync as computeNeedsSync, mergeServerState, markAllDirty, restoreMine,
  dismissConflict, migrateV1Record, schemaFromTemplate, V1_OBSOLETE_KEYS
} from './lib/shared.js'

/* ───────────────────────────────── Erreurs ───────────────────────────────── */

export class LockedError extends Error {
  constructor() {
    super('Le CR est validé : rouvrez-le pour le modifier.')
    this.name = 'LockedError'
    this.code = 'LOCKED'
  }
}
export class NotFoundError extends Error {
  constructor(what) {
    super('Introuvable : ' + what)
    // Pas 'NotFoundError' : c'est un nom d'erreur IndexedDB que Dexie reconnaît et
    // enveloppe dans une DexieError à la sortie d'une transaction (instanceof perdu).
    this.name = 'MissionNotFoundError'
    this.code = 'NOT_FOUND'
  }
}
export class InvalidError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InvalidError'
    this.code = 'INVALID'
  }
}

export const STALE_SYNC_MS = 10 * 60 * 1000
export const MAX_CUSTOM_FIELDS = 50
export const CUSTOM_TYPES = ['text', 'textarea', 'number', 'checkbox', 'radio_group', 'image_upload']
export const MAX_PHOTO_ATTEMPTS = 3

const now = () => Date.now()
const isSyncRunning = (rec) => rec.syncing && now() - (rec.syncStartedAt || 0) < STALE_SYNC_MS

const newRecord = () => ({
  fields: {}, custom: {}, customRemovals: [], photoRemovals: [], conflicts: {},
  shared: null, pendingStatus: null, status: 'draft', baseRev: 0, needsSync: 0,
  syncing: false, syncStartedAt: null, lastSyncAt: null, lastAttemptAt: null, nextTryAt: 0,
  attempts: 0, lastError: null, notice: null
})

export function createStore(name = 'ouidrop-interventions') {
  const db = new Dexie(name)

  db.version(1).stores({
    interventions: 'id, reference, syncStatus, status, lastUpdated',
    media_queue: 'mediaId, interventionId, blockId, uploadStatus, [interventionId+blockId]'
  })
  db.version(2)
    .stores({
      interventions: 'id, reference, needsSync, status, lastUpdated',
      media_queue: 'mediaId, interventionId, blockId, uploadStatus, [interventionId+blockId]'
    })
    .upgrade(async (tx) => {
      await tx.table('interventions').toCollection().modify((rec) => {
        Object.assign(rec, migrateV1Record(rec))
        for (const k of V1_OBSOLETE_KEYS) delete rec[k]
      })
      // Les copies Drive de transit de la v1 n'existent plus : tout repart.
      await tx.table('media_queue').toCollection().modify((row) => {
        row.uploadStatus = 'queued'
        row.driveFileId = null
        row.uploadAttempts = 0
      })
    })

  db.version(3).stores({
    methods_index: 'key',
    methods: 'id, title',
    method_media: 'id, pageId'
  })
  db.version(4).stores({
    machines_index: 'key',
    machines: 'id, title',
    machine_media: 'id, pageId'
  })
  db.version(5).stores({
    racks_overview: 'key',
    racks_sites: 'siteId',
    outbox: 'id, kind, createdAt'
  })

  /* ── utilitaires internes (à appeler dans une transaction) ── */
  const rowsOf = (id) => db.media_queue.where('interventionId').equals(id).toArray()

  async function load(id) {
    const rec = await db.interventions.get(id)
    if (!rec) throw new NotFoundError('mission ' + id)
    return rec
  }

  // Écrit la fiche en recalculant `needsSync` et `status`.
  async function commit(rec, patch = {}) {
    const next = { ...rec, ...patch }
    const rows = await rowsOf(rec.id)
    next.needsSync = computeNeedsSync(next, rows) ? 1 : 0
    await db.interventions.put(next)
    return next
  }

  const assertEditable = (rec) => {
    if (effectiveStatus(rec) === 'validated') throw new LockedError()
  }

  /* ────────────────────────────── Lecture ────────────────────────────── */

  const getIntervention = (id) => db.interventions.get(id)

  const listInterventions = () => db.interventions.orderBy('lastUpdated').reverse().toArray()

  // « FI-252 » exact ; ou « 252 » seul si une seule fiche locale finit par « -252 ».
  async function findByReference(ref) {
    if (!ref) return undefined
    const exact = await db.interventions.where('reference').equals(ref).first()
    if (exact || ref.includes('-')) return exact
    const suffix = '-' + ref
    const hits = await db.interventions.filter((r) => String(r.reference).endsWith(suffix)).toArray()
    return hits.length === 1 ? hits[0] : undefined
  }

  async function listPhotos(interventionId, componentId) {
    const rows = componentId
      ? await db.media_queue.where('[interventionId+blockId]').equals([interventionId, componentId]).toArray()
      : await rowsOf(interventionId)
    return rows.sort((a, b) => a.createdAt - b.createdAt)
  }

  /* ───────────────── Création / actualisation d'une mission ───────────────── */

  // `m` = `data` de getIntervention. L'actualisation ne touche JAMAIS aux saisies :
  // elle remplace le template et fusionne l'état partagé du serveur.
  const saveMission = (m) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const prev = await db.interventions.get(m.id)
      const templateBlocks = m.templateBlocks || []
      const fresh = {
        id: m.id,
        reference: m.reference,
        title: m.title || '',
        url: m.url || '',
        readOnlyData: m.properties || [],
        templateBlocks,
        templateWarnings: m.warnings || [],
        schema: m.schema || schemaFromTemplate(templateBlocks),
        remoteEditedAt: m.lastEditedTime || null,
        fetchedAt: now()
      }
      let rec = prev ? { ...prev, ...fresh } : { ...newRecord(), ...fresh, lastUpdated: now() }
      const rows = await rowsOf(m.id)
      if (m.report) {
        const merged = mergeServerState(rec, m.report, { localMediaIds: rows.map((r) => r.mediaId) })
        rec = { ...rec, ...merged.patch }
        for (const mediaId of merged.ackedMediaIds) {
          await db.media_queue.update(mediaId, { uploadStatus: 'done', driveFileId: null })
        }
      }
      return commit(rec)
    })

  /* ────────────────────────────── Saisies ────────────────────────────── */

  // `patch` : { idChamp: valeur }. Chaque valeur est horodatée (heure de saisie) :
  // c'est ce qui départage deux techniciens qui modifient le même champ.
  const setFields = (id, patch) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const rec = await load(id)
      assertEditable(rec)
      const fields = { ...rec.fields }
      const conflicts = { ...rec.conflicts }
      const t = now()
      for (const [fid, value] of Object.entries(patch)) {
        const prev = fields[fid]
        fields[fid] = { v: value === undefined ? '' : value, at: Math.max(t, prev ? prev.at + 1 : 0), dirty: true }
        delete conflicts[fid]
      }
      const next = await commit(rec, { fields, conflicts, lastUpdated: t })
      return Object.fromEntries(Object.entries(next.fields).map(([k, f]) => [k, f.v]))
    })

  /* ────────────────────────────── Photos ────────────────────────────── */

  // `blob` : image déjà préparée (JPEG, voir lib/image.js).
  const addPhoto = (interventionId, componentId, blob, { fileName } = {}) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const rec = await load(interventionId)
      assertEditable(rec)
      const mediaId = uuid()
      await db.media_queue.add({
        mediaId, interventionId, blockId: componentId,
        fileBlob: blob, fileName: fileName || `${componentId}-${now()}.jpg`,
        mimeType: blob.type || 'image/jpeg', size: blob.size,
        uploadStatus: 'queued', driveFileId: null, uploadAttempts: 0, lastError: null, createdAt: now()
      })
      await commit(rec, { lastUpdated: now() })
      return mediaId
    })

  const removePhoto = (mediaId) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const row = await db.media_queue.get(mediaId)
      if (!row) return
      const rec = await db.interventions.get(row.interventionId)
      if (rec) assertEditable(rec)
      await db.media_queue.delete(mediaId)
      if (rec) {
        // Déjà dans Notion : il faut demander sa suppression. Sinon, effacement local seul.
        const photoRemovals = row.uploadStatus === 'done' ? [...rec.photoRemovals, { mediaId, at: now() }] : rec.photoRemovals
        await commit(rec, { photoRemovals, lastUpdated: now() })
      }
    })

  /* ─────────────────── Champs ajoutés par le technicien ─────────────────── */

  const addCustomField = (id, { type, label, options }) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const rec = await load(id)
      assertEditable(rec)
      const clean = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 200)
      if (!clean) throw new InvalidError('Donnez un nom au champ.')
      if (!CUSTOM_TYPES.includes(type)) throw new InvalidError('Type de champ non proposé.')
      let opts
      if (type === 'radio_group') {
        opts = (options || []).map((o) => String(o).trim().slice(0, 80)).filter(Boolean)
        if (opts.length < 2 || opts.length > 20) throw new InvalidError('Indiquez de 2 à 20 choix.')
      }
      if (Object.keys(rec.custom).length >= MAX_CUSTOM_FIELDS) throw new InvalidError('Trop de champs ajoutés (maximum 50).')
      const cid = 'u_' + uuid().replace(/-/g, '').slice(0, 10)
      const custom = { ...rec.custom, [cid]: { type, label: clean, ...(opts ? { options: opts } : {}), at: now(), dirty: true } }
      await commit(rec, { custom, lastUpdated: now() })
      return cid
    })

  const removeCustomField = (id, customId) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const rec = await load(id)
      assertEditable(rec)
      const c = rec.custom[customId]
      if (!c) return
      const custom = { ...rec.custom }
      delete custom[customId]
      const fields = { ...rec.fields }
      delete fields[customId]
      const customRemovals = c.dirty ? rec.customRemovals : [...rec.customRemovals, { id: customId, at: now() }]
      await db.media_queue.where('[interventionId+blockId]').equals([id, customId]).delete()
      await commit(rec, { custom, fields, customRemovals, lastUpdated: now() })
    })

  /* ──────────────────── Validation / réouverture du CR ──────────────────── */

  // « Valider » et « Modifier à nouveau » sont des DEMANDES horodatées : elles
  // partent avec la prochaine synchronisation (immédiate, voir lib/sync.js).
  const setReportStatus = (id, value) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      if (value !== 'validated' && value !== 'draft') throw new InvalidError('Statut inconnu.')
      const rec = await load(id)
      if (effectiveStatus(rec) === value) return rec
      const server = rec.shared ? rec.shared.status : 'draft'
      const pendingStatus = value === server && !isSyncRunning(rec) ? null : { value, at: now() }
      return commit(rec, { pendingStatus, status: value, notice: null, lastUpdated: now() })
    })

  /* ──────────────────────────── Conflits & avis ──────────────────────────── */

  const resolveConflict = (id, fieldId, choice) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const rec = await load(id)
      if (choice === 'mine') {
        assertEditable(rec)
        const patch = restoreMine(rec, fieldId)
        return patch ? commit(rec, { ...patch, lastUpdated: now() }) : rec
      }
      return commit(rec, dismissConflict(rec, fieldId))
    })

  const dismissNotice = (id) => db.interventions.update(id, { notice: null })

  /* ─────────────────────── Moteur de synchronisation ─────────────────────── */

  // Missions à remonter (ordre : la plus récemment modifiée d'abord).
  const listNeedingSync = async () =>
    (await db.interventions.where('needsSync').equals(1).toArray()).sort((a, b) => b.lastUpdated - a.lastUpdated)

  // Réserve l'envoi (verrou atomique : deux onglets ne partent pas en même temps).
  const beginSync = (id) =>
    db.transaction('rw', db.interventions, async () => {
      const rec = await db.interventions.get(id)
      if (!rec || isSyncRunning(rec)) return null
      const patch = { syncing: true, syncStartedAt: now(), lastAttemptAt: now() }
      await db.interventions.update(id, patch)
      return { ...rec, ...patch }
    })

  const endSync = (id, error) =>
    db.transaction('rw', db.interventions, async () => {
      const rec = await db.interventions.get(id)
      if (!rec) return
      const attempts = error ? (rec.attempts || 0) + 1 : 0
      const delay = error ? Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1)) : 0
      await db.interventions.update(id, {
        syncing: false,
        syncStartedAt: null,
        attempts,
        nextTryAt: error ? now() + delay : 0,
        lastError: error ? { code: error.code || 'UNKNOWN', message: error.message || String(error), at: now() } : null
      })
    })

  const setPhotoUploaded = (mediaId, driveFileId) =>
    db.media_queue.update(mediaId, { uploadStatus: 'uploaded', driveFileId, lastError: null })

  const failPhoto = (mediaId, code) => db.media_queue.update(mediaId, { uploadStatus: 'failed', lastError: code })

  // Fusionne la réponse de syncReport. `sent` = ce que computeChanges a envoyé.
  const applySyncResult = (id, sent, result) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      let rec = await load(id)
      const rows = await rowsOf(id)
      const merged = mergeServerState(rec, result.report, {
        sent, overridden: result.overridden, rejected: result.rejected, localMediaIds: rows.map((r) => r.mediaId)
      })
      rec = { ...rec, ...merged.patch }
      if (result.reset) rec = { ...rec, ...markAllDirty(rec) }

      for (const mediaId of merged.ackedMediaIds) {
        await db.media_queue.update(mediaId, { uploadStatus: 'done', driveFileId: null })
      }
      if (result.reset) {
        for (const r of rows) {
          if (r.uploadStatus !== 'failed') await db.media_queue.update(r.mediaId, { uploadStatus: 'queued', driveFileId: null })
        }
      }
      for (const e of result.photoErrors || []) {
        const row = rows.find((r) => r.mediaId === e.mediaId)
        if (!row || merged.ackedMediaIds.includes(row.mediaId)) continue
        const attempts = (row.uploadAttempts || 0) + 1
        if (e.code === 'MEDIA_NOT_FOUND' && attempts < MAX_PHOTO_ATTEMPTS) {
          await db.media_queue.update(row.mediaId, { uploadStatus: 'queued', driveFileId: null, uploadAttempts: attempts })
        } else {
          await db.media_queue.update(row.mediaId, { uploadStatus: 'failed', uploadAttempts: attempts, lastError: e.code })
        }
      }

      let notice = rec.notice
      if (result.rejected && result.rejected.reason === 'VALIDATED') {
        const by = result.report.statusBy
        notice = { code: 'VALIDATED_BY_OTHER', message: `${by || 'Un collègue'} a validé le CR : vos dernières saisies sont gardées sur cet appareil. Rouvrez le CR pour les envoyer.`, at: now() }
      }
      return commit(rec, { notice, lastSyncAt: now(), lastError: null })
    })

  // Relève des modifications des collègues (réponse de getReport avec `report`).
  const applyPull = (id, report) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      let rec = await load(id)
      const rows = await rowsOf(id)
      const wasValidated = effectiveStatus(rec) === 'validated'
      const merged = mergeServerState(rec, report, { localMediaIds: rows.map((r) => r.mediaId) })
      rec = { ...rec, ...merged.patch }
      for (const mediaId of merged.ackedMediaIds) {
        await db.media_queue.update(mediaId, { uploadStatus: 'done', driveFileId: null })
      }
      let notice = rec.notice
      const isValidated = effectiveStatus(rec) === 'validated'
      if (isValidated && !wasValidated) {
        notice = { code: 'VALIDATED_BY_OTHER', message: `${report.statusBy || 'Un collègue'} a validé le CR.`, at: now() }
      } else if (!isValidated && wasValidated) {
        notice = { code: 'REOPENED_BY_OTHER', message: `${report.statusBy || 'Un collègue'} a rouvert le CR.`, at: now() }
      }
      return commit(rec, { notice })
    })

  // Seules les présences changent : on évite d'écrire toute la fiche.
  const setEditors = (id, editors) =>
    db.transaction('rw', db.interventions, async () => {
      const rec = await db.interventions.get(id)
      if (!rec || !rec.shared) return
      await db.interventions.update(id, { shared: { ...rec.shared, editors } })
    })

  // Le serveur n'a plus de rapport pour une fiche qu'il connaissait : tout repart.
  const markServerLost = (id) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const rec = await load(id)
      for (const r of await rowsOf(id)) {
        if (r.uploadStatus !== 'failed') await db.media_queue.update(r.mediaId, { uploadStatus: 'queued', driveFileId: null })
      }
      return commit(rec, { ...markAllDirty(rec), shared: null, baseRev: 0 })
    })

  /* ──────────────────────────────── Nettoyage ──────────────────────────────── */

  // Retire une mission de l'appareil (fiche + photos). Refusé s'il reste des
  // saisies non envoyées, sauf `force`.
  const deleteIntervention = (id, { force = false } = {}) =>
    db.transaction('rw', db.interventions, db.media_queue, async () => {
      const rec = await db.interventions.get(id)
      if (!rec) return
      if (rec.needsSync === 1 && !force) throw new Error("Des saisies de cette mission ne sont pas encore envoyées.")
      await db.media_queue.where('interventionId').equals(id).delete()
      await db.interventions.delete(id)
    })

  /* ─────────────── Catalogues en lecture seule (méthodes, machines) ─────────────── */

  // Trois tables par catalogue : liste (une ligne), fiches, médias. Un média = un fichier gardé sur l'appareil.
  function catalog(indexTbl, itemTbl, mediaTbl) {
    const mediaId = (pageId, key) => `${pageId}|${key}`
    return {
      getList: () => db[indexTbl].get('list'),
      saveList: (list) => db[indexTbl].put({ key: 'list', rev: list.rev, items: list.items, fetchedAt: now() }),
      touchList: () => db[indexTbl].update('list', { fetchedAt: now() }),
      getItem: (id) => db[itemTbl].get(id),
      listCachedIds: async () => new Set(await db[itemTbl].toCollection().primaryKeys()),
      saveItem: (m) => db[itemTbl].put({ ...m, fetchedAt: now() }),
      touchItem: (id) => db[itemTbl].update(id, { fetchedAt: now() }),
      getMedia: (pageId, key) => db[mediaTbl].get(mediaId(pageId, key)),
      listMediaKeys: async (pageId) =>
        new Set((await db[mediaTbl].where('pageId').equals(pageId).primaryKeys()).map((id) => id.slice(pageId.length + 1))),
      saveMedia: (pageId, key, { blob, mime, name }) =>
        db[mediaTbl].put({ id: mediaId(pageId, key), pageId, blob, mime: mime || blob.type, name: name || '', size: blob.size, fetchedAt: now() }),
      // Efface tout ce qui vient de ce catalogue (les missions et leurs photos ne sont pas touchées).
      clear: () => db.transaction('rw', db[indexTbl], db[itemTbl], db[mediaTbl], async () => {
        await db[indexTbl].clear(); await db[itemTbl].clear(); await db[mediaTbl].clear()
      }),
      stats: async () => {
        let bytes = 0
        await db[mediaTbl].each((r) => { bytes += r.size || 0 })
        return { items: await db[itemTbl].count(), media: await db[mediaTbl].count(), bytes }
      }
    }
  }
  /* ── Racks et casiers KO : copies locales par site ── */
  const getRacksOverview = () => db.racks_overview.get('overview')
  const saveRacksOverview = (o) => db.racks_overview.put({ key: 'overview', rev: o.rev, total: o.total, sites: o.sites, fetchedAt: now() })
  const touchRacksOverview = () => db.racks_overview.update('overview', { fetchedAt: now() })
  const getRacksSite = (siteId) => db.racks_sites.get(siteId)
  const listRacksSites = () => db.racks_sites.toArray()
  const saveRacksSite = (siteId, d) => db.racks_sites.put({ siteId, rev: d.rev, site: d.site, states: d.states, items: d.items, fetchedAt: now() })
  const touchRacksSite = (siteId) => db.racks_sites.update(siteId, { fetchedAt: now() })
  const clearRacksCache = () => db.transaction('rw', db.racks_overview, db.racks_sites, async () => {
    await db.racks_overview.clear(); await db.racks_sites.clear()
  })

  /* ── Envois en attente (hors ligne) ── */
  const outboxAdd = async (kind, payload) => {
    const entry = { id: uuid(), kind, payload, createdAt: now(), status: 'pending', attempts: 0, lastError: null }
    await db.outbox.add(entry)
    return entry
  }
  const outboxList = () => db.outbox.orderBy('createdAt').toArray()
  const outboxUpdate = (id, patch) => db.outbox.update(id, patch)
  const outboxRemove = (id) => db.outbox.delete(id)

  const methodsCat = catalog('methods_index', 'methods', 'method_media')
  const machinesCat = catalog('machines_index', 'machines', 'machine_media')

  // Noms historiques (fiches méthodes).
  const getMethodsList = methodsCat.getList
  const saveMethodsList = methodsCat.saveList
  const touchMethodsList = methodsCat.touchList
  const getMethod = methodsCat.getItem
  const listCachedMethodIds = methodsCat.listCachedIds
  const saveMethod = methodsCat.saveItem
  const touchMethod = methodsCat.touchItem
  const getMethodMedia = methodsCat.getMedia
  const listMethodMediaKeys = methodsCat.listMediaKeys
  const saveMethodMedia = methodsCat.saveMedia
  const clearMethodsCache = methodsCat.clear
  const methodsCacheStats = async () => { const s = await methodsCat.stats(); return { methods: s.items, media: s.media, bytes: s.bytes } }

  return {
    getMethodsList, saveMethodsList, touchMethodsList, getMethod, listCachedMethodIds, saveMethod, touchMethod,
    getMethodMedia, listMethodMediaKeys, saveMethodMedia, clearMethodsCache, methodsCacheStats,
    methodsCatalog: methodsCat, machinesCatalog: machinesCat,
    getRacksOverview, saveRacksOverview, touchRacksOverview, getRacksSite, listRacksSites, saveRacksSite, touchRacksSite, clearRacksCache,
    outboxAdd, outboxList, outboxUpdate, outboxRemove,
    db, getIntervention, listInterventions, findByReference, listPhotos, saveMission, setFields,
    addPhoto, removePhoto, addCustomField, removeCustomField, setReportStatus, resolveConflict,
    dismissNotice, listNeedingSync, beginSync, endSync, setPhotoUploaded, failPhoto,
    applySyncResult, applyPull, setEditors, markServerLost, deleteIntervention
  }
}

/* ────────────────────── Base de l'application (singleton) ────────────────────── */

const store = createStore(globalThis.__OUIDROP_DB_NAME__ || 'ouidrop-interventions')
export const {
  getMethodsList, saveMethodsList, touchMethodsList, getMethod, listCachedMethodIds, saveMethod, touchMethod,
  getMethodMedia, listMethodMediaKeys, saveMethodMedia, clearMethodsCache, methodsCacheStats,
  methodsCatalog, machinesCatalog,
  getRacksOverview, saveRacksOverview, touchRacksOverview, getRacksSite, listRacksSites, saveRacksSite, touchRacksSite, clearRacksCache,
  outboxAdd, outboxList, outboxUpdate, outboxRemove,
  db, getIntervention, listInterventions, findByReference, listPhotos, saveMission, setFields,
  addPhoto, removePhoto, addCustomField, removeCustomField, setReportStatus, resolveConflict,
  dismissNotice, listNeedingSync, beginSync, endSync, setPhotoUploaded, failPhoto,
  applySyncResult, applyPull, setEditors, markServerLost, deleteIntervention
} = store
export default store
