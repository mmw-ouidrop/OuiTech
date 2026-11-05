// Tests de la couche données (schéma v2). Lancer : npm test
import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import Dexie from 'dexie'
import {
  db, createStore, saveMission, setFields, addPhoto, removePhoto, listPhotos, findByReference,
  setReportStatus, addCustomField, removeCustomField, moveCustomField, resolveConflict, beginSync, endSync,
  listNeedingSync, setPhotoUploaded, applySyncResult, applyPull, markServerLost, deleteIntervention,
  getIntervention, dismissNotice, LockedError, InvalidError, NotFoundError, STALE_SYNC_MS
} from '../src/db.js'
import { buildItems } from '../src/lib/shared.js'

const mission = (over = {}) => ({
  id: 'page-1', reference: 'FI-252', title: 'Compteur',
  properties: [{ label: 'Client', value: 'Dupont', type: 'rich_text' }],
  templateBlocks: [
    { kind: 'component', id: 'photo_compteur', type: 'image_upload', label: 'Photo', blockId: 'b1' },
    { kind: 'component', id: 'notes', type: 'textarea', label: 'Notes', blockId: 'b2' }
  ],
  warnings: [], lastEditedTime: '2026-10-19T08:00:00Z', url: 'https://notion.so/x', ...over
})
const jpeg = (n = 10) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' })
const report = (o = {}) => ({ rev: 1, status: 'draft', fields: {}, custom: [], removedCustom: [], photos: {}, editors: [], ...o })
const sentOf = (o = {}) => ({ fields: {}, status: null, customAdd: [], customRemove: [], photoRemove: [], ...o })
const result = (o = {}) => ({ report: report(), overridden: [], rejected: { fields: [], custom: [], photos: [], status: false, reason: null }, reset: false, photoErrors: [], ...o })

test.beforeEach(async () => {
  await db.interventions.clear()
  await db.media_queue.clear()
})

test('saveMission : crée une fiche vide ; actualiser conserve saisies, statut et file d’envoi', async () => {
  const a = await saveMission(mission())
  assert.equal(a.status, 'draft')
  assert.equal(a.needsSync, 0)
  assert.equal(a.lastSyncAt, null)
  assert.deepEqual(a.schema.map((s) => s.id), ['photo_compteur', 'notes'])

  await setFields('page-1', { notes: 'RAS' })
  await setReportStatus('page-1', 'validated')
  const b = await saveMission(mission({ title: 'Compteur (modifié)', templateBlocks: [] }))
  assert.equal(b.title, 'Compteur (modifié)')
  assert.equal(b.fields.notes.v, 'RAS')
  assert.equal(b.status, 'validated')
  assert.equal(b.needsSync, 1)
})

test('saveMission : reprend un rapport déjà commencé par un collègue', async () => {
  const rec = await saveMission(mission({ report: report({ rev: 4, fields: { notes: { v: 'déjà là', at: 10, by: 'Sophie Martin' } }, last: { by: 'Sophie Martin', at: 10 } }) }))
  assert.equal(rec.fields.notes.v, 'déjà là')
  assert.equal(rec.baseRev, 4)
  assert.equal(rec.needsSync, 0)
  assert.equal(rec.shared.last.by, 'Sophie Martin')
})

test('setFields : horodate, marque « à envoyer », refuse un CR validé', async () => {
  await saveMission(mission())
  const t0 = Date.now()
  const out = await setFields('page-1', { a: 1, b: 'x' })
  assert.deepEqual(out, { a: 1, b: 'x' })
  const rec = await getIntervention('page-1')
  assert.ok(rec.fields.a.at >= t0 && rec.fields.a.dirty === true)
  assert.equal(rec.needsSync, 1)
  const again = await setFields('page-1', { a: 2 })
  assert.ok((await getIntervention('page-1')).fields.a.at > rec.fields.a.at - 1)
  assert.equal(again.a, 2)
  assert.deepEqual(await setFields('page-1', { b: undefined }), { a: 2, b: '' }, 'vider = valeur vide')
  await assert.rejects(setFields('nope', { a: 1 }), NotFoundError)
  await setReportStatus('page-1', 'validated')
  await assert.rejects(setFields('page-1', { a: 3 }), LockedError)
})

test('photos : file locale, retrait local, retrait demandé au serveur si déjà dans Notion', async () => {
  await saveMission(mission())
  const m1 = await addPhoto('page-1', 'photo_compteur', jpeg(10))
  const m2 = await addPhoto('page-1', 'photo_compteur', jpeg(20), { fileName: 'b.jpg' })
  assert.deepEqual((await listPhotos('page-1', 'photo_compteur')).map((r) => r.mediaId), [m1, m2])
  assert.equal((await getIntervention('page-1')).needsSync, 1)

  await removePhoto(m1)                                              // jamais envoyée : disparaît
  assert.equal((await getIntervention('page-1')).photoRemovals.length, 0)

  await db.media_queue.update(m2, { uploadStatus: 'done' })          // déjà dans Notion
  await removePhoto(m2)
  assert.deepEqual((await getIntervention('page-1')).photoRemovals.map((r) => r.mediaId), [m2])
  assert.equal(await listPhotos('page-1').then((r) => r.length), 0)
  await removePhoto('inconnue')                                      // sans effet

  await setReportStatus('page-1', 'validated')
  await assert.rejects(addPhoto('page-1', 'photo_compteur', jpeg()), LockedError)
})

test('champs ajoutés : validation, ajout, suppression locale ou demandée au serveur', async () => {
  await saveMission(mission())
  await assert.rejects(addCustomField('page-1', { type: 'text', label: '  ' }), InvalidError)
  await assert.rejects(addCustomField('page-1', { type: 'script', label: 'x' }), InvalidError)
  await assert.rejects(addCustomField('page-1', { type: 'radio_group', label: 'x', options: ['seul'] }), InvalidError)

  const a = await addCustomField('page-1', { type: 'radio_group', label: ' Accès ', options: ['Libre', ' Clé ', ''] })
  assert.match(a, /^u_[0-9a-f]{10}$/)
  let rec = await getIntervention('page-1')
  assert.deepEqual(rec.custom[a].options, ['Libre', 'Clé'])
  assert.equal(rec.custom[a].label, 'Accès')
  assert.equal(rec.custom[a].dirty, true)

  await setFields('page-1', { [a]: 'Clé' })
  await removeCustomField('page-1', a)                               // jamais envoyé : effacé sans trace
  rec = await getIntervention('page-1')
  assert.equal(rec.custom[a], undefined)
  assert.equal(rec.fields[a], undefined)
  assert.deepEqual(rec.customRemovals, [])

  const b = await addCustomField('page-1', { type: 'text', label: 'B' })
  await applySyncResult('page-1', sentOf({ customAdd: [b] }), result({ report: report({ rev: 2, custom: [{ id: b, type: 'text', label: 'B', by: 'Moi', at: 1 }] }) }))
  assert.equal((await getIntervention('page-1')).custom[b].dirty, undefined, 'acquitté')
  await removeCustomField('page-1', b)                               // déjà au serveur : retrait demandé
  assert.deepEqual((await getIntervention('page-1')).customRemovals.map((r) => r.id), [b])
})

test('champs ajoutés : placés sous le champ choisi (ou en bas), déplacés, acquittés, retirés', async () => {
  await saveMission(mission())
  const ids = async () => buildItems(await getIntervention('page-1')).filter((i) => i.k === 'field').map((i) => i.label || i.id)
  // sans choix : tout en bas (sous le dernier champ) ; avec choix : sous ce champ
  const a = await addCustomField('page-1', { type: 'text', label: 'A' })
  assert.equal((await getIntervention('page-1')).custom[a].after, 'notes')
  const b = await addCustomField('page-1', { type: 'text', label: 'B', after: 'photo_compteur' })
  assert.deepEqual(await ids(), ['Photo', 'B', 'Notes', 'A'])
  const c = await addCustomField('page-1', { type: 'text', label: 'C', after: b })
  assert.deepEqual(await ids(), ['Photo', 'B', 'C', 'Notes', 'A'])
  // repère inconnu : tout en bas
  const d = await addCustomField('page-1', { type: 'text', label: 'D', after: 'nexiste-pas' })
  assert.equal((await getIntervention('page-1')).custom[d].after, a, 'sous le dernier champ (A)')
  // déplacement d'un champ pas encore envoyé : la position part avec l'ajout
  assert.equal(await moveCustomField('page-1', c, 'down'), true)
  let rec = await getIntervention('page-1')
  assert.equal(rec.custom[c].moved, undefined)
  assert.equal(rec.custom[c].dirty, true)
  assert.deepEqual(await ids(), ['Photo', 'B', 'Notes', 'C', 'A', 'D'])
  assert.equal(await moveCustomField('page-1', b, 'up'), true)
  assert.equal(await moveCustomField('page-1', b, 'up'), false, 'déjà tout en haut')
  assert.equal((await getIntervention('page-1')).custom[b].after, '^')
  // acquitté par le serveur, puis déplacé : déplacement à envoyer
  await applySyncResult('page-1', sentOf({ customAdd: [a, b, c, d] }), result({ report: report({ rev: 2, custom: [a, b, c, d].map((id, i) => ({ id, type: 'text', label: id, by: 'Moi', at: 1 + i, ...(rec.custom[id].after ? { after: rec.custom[id].after } : {}) })) }) }))
  rec = await getIntervention('page-1')
  assert.equal(await moveCustomField('page-1', a, 'up'), true)
  rec = await getIntervention('page-1')
  assert.equal(rec.custom[a].moved, true)
  assert.ok(rec.custom[a].mv > 0)
  assert.equal(rec.needsSync, 1)
  // retrait d'un champ : ceux placés sous lui passent sous son propre repère
  const e = await addCustomField('page-1', { type: 'text', label: 'E', after: c })
  await removeCustomField('page-1', c)
  assert.equal((await getIntervention('page-1')).custom[e].after, 'notes', 'sous le repère de C (qui était sous « Notes »)')
})

test('valider / rouvrir : demandes horodatées, idempotentes, annulables', async () => {
  await saveMission(mission())
  const v = await setReportStatus('page-1', 'validated')
  assert.equal(v.status, 'validated')
  assert.equal(v.pendingStatus.value, 'validated')
  assert.equal(v.needsSync, 1)
  const again = await setReportStatus('page-1', 'validated')
  assert.equal(again.pendingStatus.at, v.pendingStatus.at, 'idempotent')
  const back = await setReportStatus('page-1', 'draft')              // jamais parti : la demande disparaît
  assert.equal(back.pendingStatus, null)
  assert.equal(back.status, 'draft')
  assert.equal(back.needsSync, 0)
  await assert.rejects(setReportStatus('page-1', 'archive'), InvalidError)

  // validé côté serveur : rouvrir est une vraie demande
  await applySyncResult('page-1', sentOf(), result({ report: report({ rev: 3, status: 'validated', statusBy: 'Moi' }) }))
  const reopen = await setReportStatus('page-1', 'draft')
  assert.deepEqual(reopen.pendingStatus.value, 'draft')
  assert.equal(reopen.status, 'draft')
})

test('conflit : « remettre la mienne » renvoie la saisie ; « garder la sienne » l’oublie', async () => {
  await saveMission(mission())
  await setFields('page-1', { notes: 'Neuf' })
  const at = (await getIntervention('page-1')).fields.notes.at
  const theirs = { v: 'Usagé', by: 'Sophie Martin', at: at + 5 }
  await applySyncResult('page-1', sentOf({ fields: { notes: at } }), result({
    report: report({ rev: 2, fields: { notes: theirs } }),
    overridden: [{ id: 'notes', mine: 'Neuf', theirs }]
  }))
  let rec = await getIntervention('page-1')
  assert.equal(rec.fields.notes.v, 'Usagé')
  assert.equal(rec.conflicts.notes.mine, 'Neuf')
  assert.equal(rec.needsSync, 0)

  rec = await resolveConflict('page-1', 'notes', 'mine')
  assert.equal(rec.fields.notes.v, 'Neuf')
  assert.equal(rec.fields.notes.dirty, true)
  assert.ok(rec.fields.notes.at > theirs.at - 1000)
  assert.equal(rec.conflicts.notes, undefined)
  assert.equal(rec.needsSync, 1)

  await applySyncResult('page-1', sentOf({ fields: { notes: rec.fields.notes.at } }), result({
    report: report({ rev: 3, fields: { notes: { v: 'Défectueux', by: 'Sophie Martin', at: rec.fields.notes.at + 1 } } }),
    overridden: [{ id: 'notes', mine: 'Neuf', theirs: { v: 'Défectueux', by: 'Sophie Martin', at: rec.fields.notes.at + 1 } }]
  }))
  rec = await resolveConflict('page-1', 'notes', 'theirs')
  assert.equal(rec.conflicts.notes, undefined)
  assert.equal(rec.fields.notes.v, 'Défectueux')
})

test('modifier un champ efface son conflit affiché', async () => {
  await saveMission(mission())
  await db.interventions.update('page-1', { conflicts: { notes: { mine: 'a', theirs: { v: 'b', by: 'X', at: 1 } } } })
  await setFields('page-1', { notes: 'nouveau' })
  assert.deepEqual((await getIntervention('page-1')).conflicts, {})
})

test('verrou d’envoi : un seul à la fois, repris après 10 min ; erreur = attente croissante', async () => {
  await saveMission(mission())
  assert.ok(await beginSync('page-1'))
  assert.equal(await beginSync('page-1'), null, 'déjà en cours')
  await db.interventions.update('page-1', { syncStartedAt: Date.now() - STALE_SYNC_MS - 1 })
  assert.ok(await beginSync('page-1'), 'verrou périmé repris')

  const t0 = Date.now()
  await endSync('page-1', { code: 'NETWORK', message: 'Pas de réseau.' })
  let rec = await getIntervention('page-1')
  assert.equal(rec.syncing, false)
  assert.equal(rec.attempts, 1)
  assert.ok(rec.nextTryAt >= t0 + 30_000 - 5)
  assert.equal(rec.lastError.code, 'NETWORK')
  await beginSync('page-1'); await endSync('page-1', { code: 'NETWORK' })
  rec = await getIntervention('page-1')
  assert.equal(rec.attempts, 2)
  assert.ok(rec.nextTryAt >= t0 + 60_000 - 5, 'x2')
  await beginSync('page-1'); await endSync('page-1')
  rec = await getIntervention('page-1')
  assert.deepEqual([rec.attempts, rec.nextTryAt, rec.lastError], [0, 0, null])
})

test('applySyncResult : photos acquittées, erreurs, perte du rapport côté serveur', async () => {
  await saveMission(mission())
  const m1 = await addPhoto('page-1', 'photo_compteur', jpeg())
  const m2 = await addPhoto('page-1', 'photo_compteur', jpeg())
  const m3 = await addPhoto('page-1', 'photo_compteur', jpeg())
  for (const m of [m1, m2, m3]) await setPhotoUploaded(m, 'F' + m)
  await setFields('page-1', { notes: 'x' })
  const at = (await getIntervention('page-1')).fields.notes.at

  await applySyncResult('page-1', sentOf({ fields: { notes: at } }), result({
    report: report({ rev: 2, fields: { notes: { v: 'x', at, by: 'Moi' } }, photos: { photo_compteur: [{ mediaId: m1, by: 'Moi', at: 1 }] } }),
    photoErrors: [{ mediaId: m2, code: 'MEDIA_NOT_FOUND' }, { mediaId: m3, code: 'UNSUPPORTED_TYPE' }]
  }))
  const rows = Object.fromEntries((await listPhotos('page-1')).map((r) => [r.mediaId, r]))
  assert.equal(rows[m1].uploadStatus, 'done')
  assert.equal(rows[m2].uploadStatus, 'queued', 'à retransférer')
  assert.equal(rows[m2].driveFileId, null)
  assert.equal(rows[m3].uploadStatus, 'failed')
  assert.equal((await getIntervention('page-1')).fields.notes.dirty, undefined)

  // 3 échecs « introuvable » d'affilée : abandon
  for (let i = 0; i < 3; i++) {
    await setPhotoUploaded(m2, 'F2')
    await applySyncResult('page-1', sentOf(), result({ report: report({ rev: 3 }), photoErrors: [{ mediaId: m2, code: 'MEDIA_NOT_FOUND' }] }))
  }
  assert.equal((await listPhotos('page-1')).find((r) => r.mediaId === m2).uploadStatus, 'failed')

  // le serveur a perdu le rapport : tout repart
  await applySyncResult('page-1', sentOf(), result({ report: report({ rev: 1 }), reset: true }))
  const rec = await getIntervention('page-1')
  assert.equal(rec.fields.notes.dirty, true)
  assert.equal((await listPhotos('page-1')).find((r) => r.mediaId === m1).uploadStatus, 'queued')
  assert.equal((await listPhotos('page-1')).find((r) => r.mediaId === m3).uploadStatus, 'failed', 'les échecs définitifs restent')
})

test('applySyncResult : CR validé par un collègue pendant mon absence → avis, saisies gardées', async () => {
  await saveMission(mission())
  await setFields('page-1', { notes: 'hors ligne' })
  const at = (await getIntervention('page-1')).fields.notes.at
  await applySyncResult('page-1', sentOf({ fields: { notes: at } }), result({
    report: report({ rev: 5, status: 'validated', statusBy: 'Sophie Martin' }),
    rejected: { fields: ['notes'], custom: [], photos: [], status: false, reason: 'VALIDATED' }
  }))
  const rec = await getIntervention('page-1')
  assert.equal(rec.status, 'validated')
  assert.equal(rec.fields.notes.v, 'hors ligne')
  assert.equal(rec.fields.notes.dirty, true)
  assert.equal(rec.notice.code, 'VALIDATED_BY_OTHER')
  assert.match(rec.notice.message, /Sophie Martin/)
  await dismissNotice('page-1')
  assert.equal((await getIntervention('page-1')).notice, null)
})

test('applyPull : valeurs et statut des collègues, avis de validation / réouverture', async () => {
  await saveMission(mission())
  await applyPull('page-1', report({ rev: 2, fields: { notes: { v: 'collègue', at: 5, by: 'Sophie Martin' } } }))
  let rec = await getIntervention('page-1')
  assert.equal(rec.fields.notes.v, 'collègue')
  assert.equal(rec.needsSync, 0)
  await applyPull('page-1', report({ rev: 3, status: 'validated', statusBy: 'Sophie Martin', fields: { notes: { v: 'collègue', at: 5, by: 'Sophie Martin' } } }))
  rec = await getIntervention('page-1')
  assert.equal(rec.status, 'validated')
  assert.equal(rec.notice.code, 'VALIDATED_BY_OTHER')
  await applyPull('page-1', report({ rev: 4, status: 'draft', statusBy: 'Sophie Martin' }))
  assert.equal((await getIntervention('page-1')).notice.code, 'REOPENED_BY_OTHER')
})

test('markServerLost : tout est à renvoyer', async () => {
  await saveMission(mission({ report: report({ rev: 3, fields: { notes: { v: 'a', at: 1, by: 'X' } } }) }))
  const m = await addPhoto('page-1', 'photo_compteur', jpeg())
  await db.media_queue.update(m, { uploadStatus: 'done' })
  const rec = await markServerLost('page-1')
  assert.equal(rec.shared, null)
  assert.equal(rec.baseRev, 0)
  assert.equal(rec.fields.notes.dirty, true)
  assert.equal((await listPhotos('page-1'))[0].uploadStatus, 'queued')
})

test('findByReference : exact, numéro seul unique, ambigu', async () => {
  await saveMission(mission())
  await saveMission(mission({ id: 'page-2', reference: 'DEV-252' }))
  await saveMission(mission({ id: 'page-3', reference: 'FI-7' }))
  assert.equal((await findByReference('FI-252')).id, 'page-1')
  assert.equal((await findByReference('7')).id, 'page-3')
  assert.equal(await findByReference('252'), undefined, 'ambigu : FI-252 et DEV-252')
  assert.equal(await findByReference(''), undefined)
})

test('listNeedingSync et deleteIntervention', async () => {
  await saveMission(mission())
  await saveMission(mission({ id: 'page-2', reference: 'FI-300' }))
  await setFields('page-2', { notes: 'x' })
  assert.deepEqual((await listNeedingSync()).map((r) => r.id), ['page-2'])
  await assert.rejects(deleteIntervention('page-2'), /pas encore envoyées/)
  await addPhoto('page-2', 'photo_compteur', jpeg())
  await deleteIntervention('page-2', { force: true })
  assert.equal(await getIntervention('page-2'), undefined)
  assert.equal(await db.media_queue.count(), 0)
  await deleteIntervention('page-1')                                  // rien à envoyer : accepté
  assert.equal(await getIntervention('page-1'), undefined)
})

// Migration réelle v1 → v2 (nécessite le vrai Dexie + fake-indexeddb ; ignorée avec la doublure).
test('migration Dexie v1 → v2 : fiches et photos conservées, tout à envoyer', { skip: typeof db.on !== 'function' }, async () => {
  const name = 'migration-test-' + Date.now()
  const old = new Dexie(name)
  old.version(1).stores({
    interventions: 'id, reference, syncStatus, status, lastUpdated',
    media_queue: 'mediaId, interventionId, blockId, uploadStatus, [interventionId+blockId]'
  })
  await old.table('interventions').put({
    id: 'p1', reference: 'FI-1', title: 't', url: '', readOnlyData: [], templateWarnings: [],
    templateBlocks: [{ kind: 'component', id: 'photo', type: 'image_upload', label: 'P', blockId: 'b' }, { kind: 'component', id: 'n', type: 'text', label: 'N', blockId: 'c' }],
    formData: { n: 'RAS', photo: ['m1'] }, status: 'validated', validatedAt: 123, syncStatus: 'pending', syncId: 's',
    lastUpdated: 100, syncing: false
  })
  await old.table('media_queue').put({ mediaId: 'm1', interventionId: 'p1', blockId: 'photo', uploadStatus: 'done', driveFileId: null, createdAt: 1, fileBlob: new Blob(['x']) })
  old.close()

  const s = createStore(name)
  const rec = await s.getIntervention('p1')
  assert.deepEqual(rec.fields, { n: { v: 'RAS', at: 100, dirty: true } })
  assert.deepEqual(rec.pendingStatus, { value: 'validated', at: 123 })
  assert.equal(rec.status, 'validated')
  assert.equal(rec.formData, undefined)
  assert.equal(rec.syncStatus, undefined)
  assert.equal((await s.listPhotos('p1'))[0].uploadStatus, 'queued')
  assert.equal((await s.listNeedingSync()).length, 1, 'index needsSync utilisable après migration')
  s.db.close()
  await Dexie.delete(name)
})
