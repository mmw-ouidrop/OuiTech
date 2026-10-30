// ============================================================================
//  Logique PURE du rapport partagé côté application (aucune E/S : testable seule)
//  Contrat avec le serveur : gas/API.md.
//
//  Une fiche locale garde :
//    fields   { [id]: { v, at, by?, dirty? } }  valeur courante ; `dirty` = saisie pas
//                                               encore acquittée par le serveur
//    custom   { [id]: { type, label, options?, at, by?, dirty? } }  champs ajoutés
//    customRemovals [{id, at}]  ·  photoRemovals [{mediaId, at}]    suppressions à envoyer
//    shared   dernier état public du serveur (sans les valeurs, déjà fusionnées dans fields)
//    pendingStatus { value:'validated'|'draft', at }   demande de (ré)ouverture à envoyer
//    conflicts { [id]: { mine, theirs:{v,by,at} } }    saisies écrasées par un collègue
// ============================================================================

export const PHOTOS_PER_REQUEST = 6        // identique au serveur (MAX_PHOTOS_PER_CALL)
export const CUSTOM_SECTION_ID = 'S:custom'
export const CUSTOM_SECTION_TITLE = 'Ajouts terrain'

/* ───────────────────────────── Statut & valeurs ───────────────────────────── */

// Statut effectif : ma demande en attente prime sur ce que le serveur a dit.
export function effectiveStatus(rec) {
  if (rec.pendingStatus) return rec.pendingStatus.value
  return rec.shared ? rec.shared.status : 'draft'
}

// Le serveur refuse les saisies tant que le CR est validé (sauf si cette même
// requête le rouvre).
export function serverFrozen(rec) {
  const server = rec.shared ? rec.shared.status : 'draft'
  return server === 'validated' && !(rec.pendingStatus && rec.pendingStatus.value === 'draft')
}

export const fieldValue = (rec, id) => (rec.fields && rec.fields[id] ? rec.fields[id].v : undefined)

export function isFilled(item, value, photoCount = 0) {
  if (item.type === 'image_upload') return photoCount > 0
  if (item.type === 'checkbox' || item.type === 'to_do') return value === true
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') return true
  return value !== undefined && value !== null && String(value).trim() !== ''
}

/* ─────────────────────── Éléments affichés dans le formulaire ──────────────── */

// Template (tel que lu dans Notion) puis champs ajoutés par les techniciens.
export function buildItems(rec) {
  const items = []
  for (const b of rec.templateBlocks || []) {
    if (b.kind === 'section') items.push({ k: 'section', id: 'S:' + b.blockId, level: b.level, text: b.text })
    else if (b.kind === 'component') items.push({ k: 'field', ...b })
    else if (b.kind === 'text') items.push({ k: 'text', id: 'T:' + b.blockId, style: b.style, text: b.text })
    else if (b.kind === 'divider') items.push({ k: 'divider', id: 'D:' + b.blockId })
    else if (b.kind === 'media') items.push({ k: 'media', id: 'M:' + b.blockId, type: b.type, blockId: b.blockId, name: b.name, caption: b.caption, url: b.url })
    else if (b.kind === 'link') items.push({ k: 'link', id: 'L:' + b.blockId, url: b.url, text: b.text })
    else if (b.kind === 'html') items.push({ k: 'html', id: 'H:' + b.blockId, html: b.html })
  }
  const custom = Object.keys(rec.custom || {}).sort((a, b) => rec.custom[a].at - rec.custom[b].at || (a < b ? -1 : 1))
  if (custom.length) {
    items.push({ k: 'section', id: CUSTOM_SECTION_ID, level: 1, text: CUSTOM_SECTION_TITLE })
    for (const id of custom) {
      const c = rec.custom[id]
      items.push({ k: 'field', id, type: c.type, label: c.label, options: c.options, custom: true })
    }
  }
  return items
}

// Schéma envoyé au serveur (même forme que `schema` de getIntervention).
export function schemaFromTemplate(templateBlocks) {
  const out = []
  for (const b of templateBlocks || []) {
    if (b.kind === 'section') out.push({ k: 's', id: 'S:' + b.blockId, text: b.text, level: b.level === 1 ? 1 : 2 })
    else if (b.kind === 'component' && b.id && b.type) {
      const f = { k: 'f', id: String(b.id), type: String(b.type), label: String(b.label || b.id) }
      if (Array.isArray(b.options)) f.options = b.options.map(String)
      out.push(f)
    }
  }
  return out
}

/* ─────────────────────────── Ce qu'il faut envoyer ───────────────────────────
 *  `photoRows` : lignes de media_queue de la fiche.
 *   uploadStatus : 'queued' (local) → 'uploaded' (copie Drive de transit) → 'done'
 *                  (présente dans le rapport) ; 'failed' : abandonnée.
 *  La validation n'est envoyée que dans la DERNIÈRE requête, quand plus aucune
 *  photo n'attend : le serveur refuse les photos arrivant après la validation.
 * ──────────────────────────────────────────────────────────────────────────── */
export function computeChanges(rec, photoRows = [], { maxPhotos = PHOTOS_PER_REQUEST } = {}) {
  const sent = { fields: {}, status: null, customAdd: [], customRemove: [], photoRemove: [] }
  const changes = {}
  const frozen = serverFrozen(rec)

  const queued = photoRows.filter((r) => r.uploadStatus === 'queued')
  const uploaded = photoRows.filter((r) => r.uploadStatus === 'uploaded' && r.driveFileId)
  const batch = frozen ? [] : uploaded.slice(0, maxPhotos)
  const photosLeft = frozen ? 0 : queued.length + uploaded.length - batch.length

  if (!frozen) {
    const fields = {}
    for (const [id, f] of Object.entries(rec.fields || {})) {
      if (f.dirty) {
        fields[id] = { v: f.v, at: f.at }
        sent.fields[id] = f.at
      }
    }
    if (Object.keys(fields).length) changes.fields = fields

    const add = Object.entries(rec.custom || {})
      .filter(([, c]) => c.dirty)
      .map(([id, c]) => ({ id, type: c.type, label: c.label, ...(c.options ? { options: c.options } : {}), at: c.at }))
    const remove = (rec.customRemovals || []).map((r) => ({ id: r.id, at: r.at }))
    if (add.length || remove.length) {
      changes.custom = {}
      if (add.length) changes.custom.add = add
      if (remove.length) changes.custom.remove = remove
      sent.customAdd = add.map((c) => c.id)
      sent.customRemove = remove.map((c) => c.id)
    }

    const pAdd = batch.map((r) => ({ mediaId: r.mediaId, componentId: r.blockId, driveFileId: r.driveFileId, at: r.createdAt }))
    const pRemove = (rec.photoRemovals || []).map((r) => ({ mediaId: r.mediaId, at: r.at }))
    if (pAdd.length || pRemove.length) {
      changes.photos = {}
      if (pAdd.length) changes.photos.add = pAdd
      if (pRemove.length) changes.photos.remove = pRemove
      sent.photoRemove = pRemove.map((p) => p.mediaId)
    }
  }

  if (rec.pendingStatus && photosLeft === 0) {
    changes.status = { value: rec.pendingStatus.value, at: rec.pendingStatus.at }
    sent.status = { ...rec.pendingStatus }
  }

  return { changes, sent, batch, photosLeft, hasWork: Object.keys(changes).length > 0 }
}

// Reste-t-il quelque chose à envoyer (pour la pastille et la liste des missions) ?
export function needsSync(rec, photoRows = []) {
  if (rec.pendingStatus) return true
  if (Object.values(rec.fields || {}).some((f) => f.dirty)) return true
  if (Object.values(rec.custom || {}).some((c) => c.dirty)) return true
  if ((rec.customRemovals || []).length || (rec.photoRemovals || []).length) return true
  return photoRows.some((r) => r.uploadStatus === 'queued' || r.uploadStatus === 'uploaded')
}

/* ─────────────────────── Fusion de la réponse du serveur ───────────────────── */

// rec    : fiche locale (non modifiée)
// report : état public renvoyé par le serveur (getReport / syncReport / getIntervention)
// ctx    : { sent, overridden, rejected, reset, localMediaIds }
// Renvoie { patch, ackedMediaIds, conflicts }.
export function mergeServerState(rec, report, ctx = {}) {
  const sent = ctx.sent || { fields: {}, status: null, customAdd: [], customRemove: [], photoRemove: [] }
  const rejectedFields = new Set((ctx.rejected && ctx.rejected.fields) || [])
  const rejectedCustom = new Set((ctx.rejected && ctx.rejected.custom) || [])
  const overridden = Object.fromEntries((ctx.overridden || []).map((o) => [o.id, o]))

  // — valeurs
  const fields = { ...(rec.fields || {}) }
  const conflicts = { ...(rec.conflicts || {}) }
  const serverFields = report.fields || {}
  for (const id of Object.keys(serverFields)) {
    const local = fields[id]
    const sentAt = sent.fields[id]
    const dirty = local && local.dirty
    const ackedHere = dirty && sentAt !== undefined && sentAt === local.at && !rejectedFields.has(id)
    if (dirty && !ackedHere) continue                 // modifiée depuis l'envoi, ou refusée : on garde la mienne
    const s = serverFields[id]
    fields[id] = { v: s.v, at: s.at, by: s.by }
    if (ackedHere && overridden[id]) conflicts[id] = { mine: overridden[id].mine, theirs: overridden[id].theirs }
  }
  // Envoyée, acquittée, mais absente de la réponse (champ inconnu du serveur) : on arrête de la renvoyer.
  for (const id of Object.keys(sent.fields)) {
    const local = fields[id]
    if (local && local.dirty && local.at === sent.fields[id] && !rejectedFields.has(id) && !(id in serverFields)) {
      fields[id] = { ...local, dirty: false }
    }
  }

  // — champs ajoutés
  const custom = {}
  const removed = new Set(report.removedCustom || [])
  for (const c of report.custom || []) custom[c.id] = { type: c.type, label: c.label, options: c.options, by: c.by, at: c.at }
  for (const [id, c] of Object.entries(rec.custom || {})) {
    if (!c.dirty) continue
    const wasSent = sent.customAdd.includes(id)
    if (removed.has(id)) continue
    if (wasSent && custom[id]) continue                // acquitté : la version du serveur fait foi
    if (wasSent && !rejectedCustom.has(id) && !custom[id]) continue   // envoyé puis supprimé ailleurs
    custom[id] = c                                     // pas encore envoyé, ou refusé : on le garde
  }
  const activeOnServer = new Set((report.custom || []).map((c) => c.id))
  const customRemovals = (rec.customRemovals || []).filter((r) => activeOnServer.has(r.id) && !removed.has(r.id))
  for (const r of customRemovals) delete custom[r.id]

  // — photos
  const serverMedia = new Set()
  for (const list of Object.values(report.photos || {})) for (const p of list) serverMedia.add(p.mediaId)
  const photoRemovals = (rec.photoRemovals || []).filter((r) => serverMedia.has(r.mediaId))
  const ackedMediaIds = (ctx.localMediaIds || []).filter((m) => serverMedia.has(m))

  // — statut
  let pendingStatus = rec.pendingStatus || null
  if (pendingStatus && sent.status && sent.status.at === pendingStatus.at) pendingStatus = null
  const status = pendingStatus ? pendingStatus.value : report.status

  const { fields: _f, custom: _c, ...shared } = report
  return {
    patch: {
      fields, custom, customRemovals, photoRemovals, conflicts, pendingStatus, status,
      shared: { ...shared, receivedAt: ctx.now || Date.now() },
      baseRev: report.rev
    },
    ackedMediaIds,
    conflicts
  }
}

// Le serveur a perdu le rapport (supprimé à la main dans Notion) : tout ce que
// cet appareil connaît doit repartir.
export function markAllDirty(rec) {
  const fields = {}
  for (const [id, f] of Object.entries(rec.fields || {})) fields[id] = { ...f, dirty: true }
  const custom = {}
  for (const [id, c] of Object.entries(rec.custom || {})) custom[id] = { ...c, dirty: true }
  const patch = { fields, custom }
  if (rec.status === 'validated' && !rec.pendingStatus) patch.pendingStatus = { value: 'validated', at: Date.now() }
  return patch
}

/* ───────────────────────────── Résolution d'un conflit ────────────────────── */

export function restoreMine(rec, id, now = Date.now()) {
  const c = rec.conflicts && rec.conflicts[id]
  if (!c) return null
  const conflicts = { ...rec.conflicts }
  delete conflicts[id]
  return { fields: { ...rec.fields, [id]: { v: c.mine, at: now, dirty: true } }, conflicts }
}

export function dismissConflict(rec, id) {
  const conflicts = { ...(rec.conflicts || {}) }
  delete conflicts[id]
  return { conflicts }
}

/* ─────────────────────────── Migration depuis la v1 ──────────────────────────
 *  La v1 stockait formData {id: valeur} + photos dans formData ; la v2 stocke des
 *  valeurs horodatées. Tout est marqué « à envoyer » : le serveur ne connaît pas
 *  encore ces fiches. Fonction pure ; l'appel Dexie est dans db.js.
 * ──────────────────────────────────────────────────────────────────────────── */
export function migrateV1Record(rec, now = Date.now()) {
  const photoComponents = new Set(
    (rec.templateBlocks || []).filter((b) => b.kind === 'component' && b.type === 'image_upload').map((b) => b.id)
  )
  const at = rec.lastUpdated || now
  const fields = {}
  for (const [id, v] of Object.entries(rec.formData || {})) {
    if (photoComponents.has(id)) continue
    fields[id] = { v, at, dirty: true }
  }
  const validated = rec.status === 'validated'
  return {
    fields,
    custom: {},
    customRemovals: [],
    photoRemovals: [],
    conflicts: {},
    shared: null,
    schema: schemaFromTemplate(rec.templateBlocks),
    pendingStatus: validated ? { value: 'validated', at: rec.validatedAt || at } : null,
    status: validated ? 'validated' : 'draft',
    baseRev: 0,
    needsSync: 1,
    syncing: false,
    syncStartedAt: null,
    lastSyncAt: null,
    lastAttemptAt: null,
    nextTryAt: 0,
    attempts: 0,
    lastError: null,
    notice: null
  }
}

export const V1_OBSOLETE_KEYS = ['formData', 'syncStatus', 'syncId', 'syncAttempts', 'validatedAt']
