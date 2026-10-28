// Moteur de synchro branché sur le VRAI code serveur (gas/Code.gs + Report.gs, Notion/Drive simulés),
// avec deux appareils (deux bases locales). Lancer : npm test
import 'fake-indexeddb/auto'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { makeWorld, run, api as gasApi, PAGE, PNG_B64 } from '../../gas/tests/fake-notion.mjs'
import { createStore } from '../src/db.js'
import { createSyncEngine, decideDue, isRetryable } from '../src/lib/sync.js'
class ApiError extends Error { constructor(code, message) { super(message); this.code = code } }   // même forme que lib/api.js (qui lit import.meta.env)

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs'].map((f) => fs.readFileSync(path.join(here, '../../gas', f), 'utf8'))
let seq = 0

function setup() {
  const w = makeWorld()
  SRC.forEach((s) => run(w.ctx, s))
  const { post, get } = gasApi(w)
  const unwrap = (r) => { if (!r.ok) throw new ApiError(r.error.code, r.error.message); return r.data }
  const server = {
    getIntervention: (id) => unwrap(get({ action: 'getIntervention', id })),
    uploadMedia: (p) => unwrap(post({ action: 'uploadMedia', ...p })),
    getReport: (p) => unwrap(get({ action: 'getReport', ...p })),
    syncReport: (p) => unwrap(post({ action: 'syncReport', ...p }))
  }
  const device = (first, last, skew = 0) => {
    const store = createStore('e2e-' + ++seq)
    const identity = { clientId: 'client-' + seq + '-xxxxxxxx', firstName: first, lastName: last }
    const state = { online: true }
    const engine = createSyncEngine({
      store, api: server, getIntervention: null, getIdentity: () => identity,
      isOnline: () => state.online, now: () => w.now + skew, toBase64: async () => PNG_B64
    })
    return { store, engine, state, identity, skew }
  }
  return { w, server, device }
}
let ID = null   // id tel que Notion le renvoie (avec tirets) : c'est lui que le client stocke
const open = async (d, server) => { const m = server.getIntervention('FI-252'); ID = m.id; return d.store.saveMission(m) }
const jpeg = () => new Blob([new Uint8Array(20)], { type: 'image/jpeg' })

test('1re synchro : champs saisis → Notion, révision locale alignée, plus rien à envoyer', async () => {
  const { w, server, device } = setup()
  const a = device('Karim', 'Benali')
  await open(a, server)
  await a.store.setFields(ID, { etat_materiel: 'Usagé' })
  assert.equal((await a.store.getIntervention(ID)).needsSync, 1)
  const s = await a.engine.syncMission(ID)
  assert.equal(s.error, undefined, String(s.error))
  const rec = await a.store.getIntervention(ID)
  assert.equal(rec.needsSync, 0)
  assert.equal(rec.baseRev, 1)
  assert.ok(rec.lastSyncAt)
  assert.ok(w.visibleReport().map((b) => w.text(b)).includes('État du matériel : Usagé'))
})

test('sans prénom/nom ou hors ligne : rien n’est envoyé, rien n’est perdu', async () => {
  const { server, device } = setup()
  const a = device('', '')
  await open(a, server)
  await a.store.setFields(ID, { etat_materiel: 'Neuf' })
  assert.deepEqual(await a.engine.syncMission(ID), { skipped: 'NO_NAME' })
  a.identity.firstName = 'Karim'; a.identity.lastName = 'Benali'
  a.state.online = false
  assert.deepEqual(await a.engine.syncMission(ID), { skipped: 'OFFLINE' })
  assert.equal((await a.store.getIntervention(ID)).needsSync, 1)
  a.state.online = true
  assert.equal((await a.engine.syncMission(ID)).error, undefined)
  assert.equal((await a.store.getIntervention(ID)).needsSync, 0)
})

test('erreur réseau : conservé, recul exponentiel, repart ensuite', async () => {
  const { w, server, device } = setup()
  const a = device('Karim', 'Benali')
  await open(a, server)
  await a.store.setFields(ID, { etat_materiel: 'Neuf' })
  const real = server.syncReport
  server.syncReport = async () => { throw new ApiError('NETWORK', 'Pas de réseau.') }
  const r = await a.engine.syncMission(ID)
  assert.equal(r.error.code, 'NETWORK')
  let rec = await a.store.getIntervention(ID)
  assert.equal(rec.needsSync, 1)
  assert.equal(rec.syncing, false)
  assert.ok(rec.nextTryAt > w.now)
  assert.deepEqual(await a.engine.syncMission(ID), { skipped: 'BACKOFF' })
  server.syncReport = real
  assert.equal((await a.engine.syncMission(ID, { force: true })).error, undefined)
  rec = await a.store.getIntervention(ID)
  assert.equal(rec.needsSync, 0)
  assert.equal(rec.attempts, 0)
})

test('photos : plus de 6 → plusieurs lots, toutes confirmées, statut envoyé en dernier', async () => {
  const { w, server, device } = setup()
  const a = device('Karim', 'Benali')
  await open(a, server)
  for (let i = 0; i < 8; i++) await a.store.addPhoto(ID, 'photo_compteur', jpeg())
  await a.store.setReportStatus(ID, 'validated')
  const s = await a.engine.syncMission(ID)
  assert.equal(s.error, undefined, String(s.error))
  assert.ok(s.requests >= 2, 'au moins 2 requêtes pour 8 photos')
  const rec = await a.store.getIntervention(ID)
  assert.equal(rec.needsSync, 0)
  assert.equal(rec.shared.status, 'validated')
  assert.equal(Object.values(rec.shared.photos).flat().length, 8)
  assert.equal((await a.store.listPhotos(ID)).filter((r) => r.uploadStatus === 'done').length, 8)
  assert.ok(w.visibleReport().length > 0)
})

test('échec d’envoi d’une photo : le texte part quand même, la photo repart au prochain essai', async () => {
  const { w, server, device } = setup()
  const a = device('Karim', 'Benali')
  await open(a, server)
  await a.store.setFields(ID, { etat_materiel: 'Usagé' })
  await a.store.addPhoto(ID, 'photo_compteur', jpeg())
  const real = server.uploadMedia
  server.uploadMedia = async () => { throw new ApiError('BAD_RESPONSE', 'Réponse inattendue du serveur.') }
  const r = await a.engine.syncMission(ID)
  assert.equal(r.error.code, 'BAD_RESPONSE')
  assert.ok(w.visibleReport().map((b) => w.text(b)).includes('État du matériel : Usagé'), 'le texte est dans Notion')
  let rec = await a.store.getIntervention(ID)
  assert.equal(rec.needsSync, 1, 'la photo reste à envoyer')
  assert.equal(rec.fields.etat_materiel.dirty, undefined)
  assert.equal((await a.store.listPhotos(ID))[0].uploadStatus, 'queued')
  server.uploadMedia = real
  const r2 = await a.engine.syncMission(ID, { force: true })
  assert.equal(r2.error, undefined, String(r2.error))
  rec = await a.store.getIntervention(ID)
  assert.equal(rec.needsSync, 0)
  assert.equal(Object.values(rec.shared.photos).flat().length, 1)
})

test('deux appareils : champs fusionnés, même champ = dernier gagnant, perdant prévenu et peut reprendre', async () => {
  const { w, server, device } = setup()
  const a = device('Karim', 'Benali')
  const b = device('Sophie', 'Martin', -4 * 60_000)
  await open(a, server); await open(b, server)

  await a.store.setFields(ID, { etat_materiel: 'Neuf' })
  w.now += 1000
  await b.store.setFields(ID, { etat_materiel: 'Défectueux' })
  w.now += 1000
  await b.engine.syncMission(ID)           // B (en retard de 4 min) est corrigée par le serveur
  w.now += 1000
  await a.engine.syncMission(ID)           // A est la plus récente → gagne
  const ra = await a.store.getIntervention(ID)
  assert.equal(ra.fields.etat_materiel.v, 'Neuf')

  w.now += 1000
  const p = await b.engine.pullMission(ID)
  assert.equal(p.updated, true)
  const rb = await b.store.getIntervention(ID)
  assert.equal(rb.fields.etat_materiel.v, 'Neuf', 'B voit la valeur de A')

  // rien de neuf → relève « unchanged » sans réécrire
  w.now += 1000
  assert.equal((await b.engine.pullMission(ID)).unchanged, true)
})

test('CR validé par A pendant que B édite : B garde sa saisie, prévenu, peut rouvrir', async () => {
  const { w, server, device } = setup()
  const a = device('Karim', 'Benali'); const b = device('Sophie', 'Martin')
  await open(a, server); await open(b, server)
  await a.store.setFields(ID, { etat_materiel: 'Neuf' })
  await a.store.setReportStatus(ID, 'validated')
  await a.engine.syncMission(ID)
  w.now += 1000
  await b.store.setFields(ID, { etat_materiel: 'Usagé' })
  await b.engine.syncMission(ID)
  const rb = await b.store.getIntervention(ID)
  assert.equal(rb.notice && rb.notice.code, 'VALIDATED_BY_OTHER')
  assert.equal(rb.fields.etat_materiel.v, 'Usagé', 'saisie locale conservée')
  assert.equal(rb.shared.status, 'validated')
  assert.equal((await b.engine.syncMission(ID, { force: true })).requests, 0, 'CR figé : aucune requête inutile')
  assert.equal(decideDue(await b.store.getIntervention(ID), { lastPollAt: w.now }, w.now + 1e7).sync, false)

  // B rouvre → le serveur accepte, A le voit à sa prochaine relève
  w.now += 1000
  await b.store.setReportStatus(ID, 'draft')
  await b.engine.syncMission(ID, { force: true })
  w.now += 1000
  await a.engine.pullMission(ID)
  const ra = await a.store.getIntervention(ID)
  assert.equal(ra.shared.status, 'draft')
  assert.equal(ra.notice && ra.notice.code, 'REOPENED_BY_OTHER')
})

test('rapport supprimé dans Notion : l’appareil renvoie tout, rien n’est perdu', async () => {
  const { w, server, device } = setup()
  const a = device('Karim', 'Benali')
  await open(a, server)
  await a.store.setFields(ID, { etat_materiel: 'Neuf', notes_libres: 'x' })
  await a.engine.syncMission(ID)
  w.reportCallout().archived = true
  w.flushCache()
  w.now += 6 * 60_000
  await a.store.setFields(ID, { notes_libres: 'y' })
  const s = await a.engine.syncMission(ID)
  assert.equal(s.error, undefined, String(s.error))
  const lines = w.visibleReport().map((b) => w.text(b))
  assert.ok(lines.includes('État du matériel : Neuf'), 'valeur antérieure à la suppression renvoyée aussi')
  const rec = await a.store.getIntervention(ID)
  assert.equal(rec.needsSync, 0)
  assert.equal(rec.fields.etat_materiel.v, 'Neuf')
})

test('decideDue : 1re synchro rapide, puis 5 min, validation immédiate côté UI, relève 60 s, rien si figé', () => {
  const base = { id: 'x', needsSync: 1, syncing: false, status: 'draft', shared: { status: 'draft' }, lastAttemptAt: 0, lastSyncAt: null, nextTryAt: 0 }
  assert.equal(decideDue(base, { lastPollAt: 0 }, 29_000).sync, false)
  assert.equal(decideDue(base, { lastPollAt: 0 }, 31_000).sync, true)
  const synced = { ...base, lastSyncAt: 1, lastAttemptAt: 100_000 }
  assert.equal(decideDue(synced, { lastPollAt: 100_000 }, 100_000 + 299_000).sync, false)
  assert.equal(decideDue(synced, { lastPollAt: 100_000 }, 100_000 + 301_000).sync, true)
  assert.equal(decideDue({ ...synced, needsSync: 0 }, { lastPollAt: 0 }, 400_000).pull, true)
  assert.equal(decideDue({ ...synced, needsSync: 0 }, { lastPollAt: 399_000 }, 400_000).pull, false)
  assert.equal(decideDue({ ...synced, syncing: true }, { lastPollAt: 0 }, 1e9).sync, false)
  assert.equal(decideDue({ ...synced, nextTryAt: 1e12 }, { lastPollAt: 0 }, 1e9).sync, false)
  assert.equal(decideDue(null, {}, 1).sync, false)
})

test('codes d’erreur : réseau = on réessaie, refus = non', () => {
  assert.equal(isRetryable({ code: 'NETWORK' }), true)
  assert.equal(isRetryable({ code: 'UNAUTHORIZED' }), false)
  assert.equal(isRetryable({ code: 'NOT_FOUND' }), false)
})
