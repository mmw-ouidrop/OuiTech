// Racks et casiers KO + file d'envois hors ligne, branchés sur le VRAI code serveur (gas/Racks.gs + Methods.gs, Notion simulé).
import 'fake-indexeddb/auto'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { makeWorld, run, api as gasApi } from '../../gas/tests/fake-notion.mjs'
import { createStore } from '../src/db.js'
import { createOutbox } from '../src/lib/outbox.js'
import { createRacksService, splitByKind, filterSites, overlayPending, diagTone, needsDiagnosis, searchLocal } from '../src/lib/racks.js'
class ApiError extends Error { constructor(code, message) { super(message); this.code = code } }

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs', 'Machines.gs', 'Racks.gs'].map((f) => fs.readFileSync(path.join(here, '../../gas', f), 'utf8'))
let seq = 0
const t = (s) => [{ plain_text: s }]

function setup() {
  const w = makeWorld()
  SRC.forEach((s) => run(w.ctx, s))
  const { get, post } = gasApi(w)
  const supPost = gasApi(w, 'support').post
  const unwrap = (r) => { if (!r.ok) throw new ApiError(r.error.code, r.error.message); return r.data }
  const state = { online: true, loseNextResponse: false, down: false }
  const guard = (fn) => (...a) => { if (state.down) throw new ApiError('NETWORK', 'Pas de réseau.'); return fn(...a) }
  const api = {
    racksOverview: guard(({ sinceRev } = {}) => unwrap(get({ action: 'racksOverview', sinceRev: sinceRev || '' }))),
    racks: guard(({ site, all, sinceRev }) => unwrap(get({ action: 'racks', site, all: all ? '1' : '', sinceRev: sinceRev || '' }))),
    racksSearch: guard((c) => unwrap(get({ action: 'racksSearch', q: c.q || '', site: c.site || '', state: c.state || '', kind: c.kind || '' }))),
    rackSetState: guard((p) => unwrap(supPost({ action: 'rackSetState', ...p }))),
    rackDiagnosis: guard((p) => { const r = unwrap(post({ action: 'rackDiagnosis', ...p })); if (state.loseNextResponse) { state.loseNextResponse = false; throw new ApiError('NETWORK', 'réponse perdue') } return r }),
    methodComment: guard((p) => unwrap(post({ action: 'methodComment', ...p })))
  }
  const store = createStore('racks-' + ++seq)
  const racks = createRacksService({ store, api, isOnline: () => state.online })
  const done = []
  const outbox = createOutbox({
    store, isOnline: () => state.online,
    senders: { rack_diag: api.rackDiagnosis, method_comment: api.methodComment, rack_state: api.rackSetState },
    onDone: async (entry, result) => { done.push(entry.kind); if (entry.kind === 'rack_diag') await racks.applyDiagnosis(entry.payload.pageId, result); if (entry.kind === 'rack_state') await racks.applyState(entry.payload.pageId, result) }
  })
  return { w, state, store, racks, outbox, done }
}

function seed(w) {
  const site = w.addMachine({ props: { Dropper: { type: 'title', title: t('Dropper Ordener') } } })
  const c1 = w.addRack({ title: 'Casier 110', site: site.id })
  const c2 = w.addRack({ title: 'Casier 14-2', site: site.id })
  const r1 = w.addRack({ title: 'Rack 1141', site: site.id })
  return { site, c1, c2, r1 }
}
const diag = (id, over = {}) => ({ pageId: id, state: 'repaired', comment: 'ok', name: 'Karim Benali', ...over })
const commentOf = (x) => x.page.properties['Commentaire technicien'].rich_text.map((r) => r.plain_text).join('')

test('sites et liste : gardés sur l’appareil, relus hors ligne', async () => {
  const { w, state, racks } = setup(); const { site } = seed(w)
  const o = await racks.loadOverview()
  assert.equal(o.data.sites[0].title, 'Dropper Ordener'); assert.equal(o.data.sites[0].total, 3)
  const l = await racks.loadSite(site.nid)
  assert.deepEqual(l.data.items.map((i) => i.title), ['Casier 14-2', 'Casier 110', 'Rack 1141'])
  state.online = false
  assert.equal((await racks.loadOverview()).fromCache, true)
  assert.equal((await racks.loadSite(site.nid)).data.items.length, 3)
  assert.equal((await racks.loadSite('0'.repeat(32))).error, 'OFFLINE_EMPTY')
})

test('hors ligne : le diagnostic est gardé, affiché tout de suite, envoyé au retour du réseau', async () => {
  const { w, state, racks, outbox, store, done } = setup(); const { site, c1 } = seed(w)
  const { data } = await racks.loadSite(site.nid)
  state.online = false
  await outbox.add('rack_diag', diag(c1.nid, { state: 'unrepairable', comment: 'Charnière cassée' }))
  assert.deepEqual(await outbox.flush(), { sent: 0, failed: 0, stopped: 'OFFLINE' })

  const shown = overlayPending(data.items, await outbox.list(), data.states)
  const mine = shown.find((i) => i.id === c1.nid)
  assert.equal(mine.diag.state, 'Non réparable'); assert.equal(mine.pending, 'pending'); assert.equal(needsDiagnosis(mine), false)
  assert.equal(needsDiagnosis(shown.find((i) => i.title === 'Rack 1141')), true)
  assert.equal(commentOf(c1), '', 'rien n’est parti')

  state.online = true
  const r = await outbox.flush()
  assert.equal(r.sent, 1); assert.deepEqual(done, ['rack_diag'])
  assert.match(commentOf(c1), /^État : Non réparable\nDate : .+\nTech : Karim Benali\nCommentaire : Charnière cassée$/)
  assert.deepEqual(await outbox.list(), [])
  const cached = (await store.getRacksSite(site.nid)).items.find((i) => i.id === c1.nid)
  assert.equal(cached.diag.state, 'Non réparable', 'la copie locale reflète le serveur')
})

test('réponse perdue : l’envoi est rejoué sans doublon dans Notion', async () => {
  const { w, state, outbox } = setup(); const { c1 } = seed(w)
  await outbox.add('rack_diag', diag(c1.nid))
  state.loseNextResponse = true
  const a = await outbox.flush()
  assert.equal(a.stopped, 'NETWORK'); assert.equal((await outbox.list())[0].attempts, 1)
  const b = await outbox.flush()
  assert.equal(b.sent, 1)
  assert.equal((commentOf(c1).match(/État :/g) || []).length, 1)
})

test('refus définitif (colonne absente) : mis de côté sans bloquer les suivants ; reprise possible', async () => {
  const { w, outbox } = setup(); const { c2 } = seed(w)
  const bare = w.addRack({ title: 'Casier 8', comment: null })
  await outbox.add('rack_diag', diag(bare.nid))
  await outbox.add('rack_diag', diag(c2.nid))
  const r = await outbox.flush()
  assert.deepEqual([r.sent, r.failed], [1, 1])
  const left = await outbox.list()
  assert.equal(left.length, 1); assert.equal(left[0].status, 'failed'); assert.equal(left[0].lastError.code, 'COLUMN_MISSING')
  bare.page.properties['Commentaire technicien'] = { type: 'rich_text', rich_text: [] }     // la colonne est créée dans Notion
  await outbox.retry(left[0].id)
  assert.equal((await outbox.flush()).sent, 1)
  assert.deepEqual(await outbox.list(), [])
})

test('réseau coupé en plein envoi : on s’arrête, rien n’est perdu, l’ordre est conservé', async () => {
  const { w, state, outbox } = setup(); const { c1, c2 } = seed(w)
  await outbox.add('rack_diag', diag(c1.nid)); await outbox.add('rack_diag', diag(c2.nid))
  state.down = true
  assert.equal((await outbox.flush()).stopped, 'NETWORK')
  assert.equal((await outbox.list()).length, 2)
  state.down = false
  assert.equal((await outbox.flush()).sent, 2)
})

test('commentaires de méthode via la file : envoyés, copie locale prête à être mise à jour', async () => {
  const { w, outbox, done } = setup()
  const m = w.addMethod({ title: 'Lexium' }); m.page.properties.Commentaires = { type: 'rich_text', rich_text: [] }
  await outbox.add('method_comment', { pageId: m.nid, text: 'Pensez au frein filet', name: 'Karim Benali' })
  assert.equal((await outbox.flush()).sent, 1); assert.deepEqual(done, ['method_comment'])
  assert.match(m.page.properties.Commentaires.rich_text[0].plain_text, /^Karim Benali · .+\nPensez au frein filet$/)
})

test('aides : séparation casiers / racks, recherche de sites, tons des diagnostics', () => {
  const items = [{ kind: 'rack', id: 'a' }, { kind: 'casier', id: 'b' }, { kind: 'autre', id: 'c' }, { kind: 'casier', id: 'd' }]
  const s = splitByKind(items)
  assert.deepEqual([s.casier.length, s.rack.length, s.autre.length], [2, 1, 1])
  assert.deepEqual(filterSites([{ title: 'Dropper Lyon' }, { title: 'Épinay' }], 'epi').map((x) => x.title), ['Épinay'])
  const states = [{ id: 'repaired', label: 'Réparé' }, { id: 'unrepairable', label: 'Non réparable' }, { id: 'watch', label: 'À surveiller' }]
  assert.deepEqual(['Réparé', 'Non réparable', 'À surveiller', '?'].map((l) => diagTone(l, states)), ['done', 'danger', 'info', 'info'])
})

test('tous les états : copie locale à part, états gardés ; un diagnostic fait passer KO → Diag tech dans les deux copies', async () => {
  const { w, racks, outbox } = setup(); const { site, c1 } = seed(w)
  w.addRack({ title: 'Casier 45', site: site.id, state: 'Remis' })
  w.stateOptions = ['KO', 'Diag tech', 'Remis', 'Dead']
  const ko = await racks.loadSite(site.nid)
  const all = await racks.loadSite(site.nid, { all: true })
  assert.equal(ko.data.items.length, 3); assert.equal(all.data.items.length, 4)
  assert.deepEqual(all.data.stateOptions, ['KO', 'Diag tech', 'Remis', 'Dead'])
  assert.equal(all.data.items.find((i) => i.title === 'Casier 45').state, 'Remis')

  await outbox.add('rack_diag', diag(c1.nid, { state: 'watch' })); await outbox.flush()
  for (const k of [site.nid, site.nid + ':all']) {
    const rec = await racks.loadSite(site.nid, { all: k.endsWith(':all') })
    assert.equal(rec.data.items.find((i) => i.id === c1.nid).state, 'Diag tech')
  }
})

test('support : changement d’état envoyé par la file ; copies locales mises à jour', async () => {
  const { w, racks, outbox, state } = setup(); const { site, c1 } = seed(w)
  w.stateOptions = ['KO', 'Diag tech', 'Remis', 'Dead']
  await racks.loadSite(site.nid, { all: true })
  await outbox.add('rack_state', { pageId: c1.nid, state: 'Remis', name: 'Léa Dupont' })
  state.down = true
  assert.equal((await outbox.flush()).sent, 0)
  state.down = false
  assert.equal((await outbox.flush()).sent, 1)
  assert.equal(c1.page.properties['État'].select.name, 'Remis')
  assert.equal((await racks.loadSite(site.nid, { all: true })).data.items.find((i) => i.id === c1.nid).state, 'Remis')
})

test('superposition : diagnostic en attente → « Diag tech » ; changement d’état en attente → nouvel état', () => {
  const items = [{ id: 'a', title: 'Casier 1', kind: 'casier', state: 'KO' }, { id: 'b', title: 'Casier 2', kind: 'casier', state: 'Diag tech' }, { id: 'c', title: 'Casier 3', kind: 'casier', state: 'Remis' }]
  const meta = { koStates: ['KO', 'Diag tech'], diagState: 'Diag tech' }
  const entries = [
    { id: 1, kind: 'rack_diag', status: 'pending', createdAt: 1, payload: { pageId: 'a', state: 'watch', name: 'K' } },
    { id: 2, kind: 'rack_diag', status: 'pending', createdAt: 1, payload: { pageId: 'c', state: 'watch', name: 'K' } },
    { id: 3, kind: 'rack_state', status: 'pending', createdAt: 2, payload: { pageId: 'b', state: 'Remis', name: 'L' } }
  ]
  const out = overlayPending(items, entries, [{ id: 'watch', label: 'À surveiller' }], (ts) => 't' + ts, meta)
  assert.equal(out[0].state, 'Diag tech'); assert.equal(out[0].pending, 'pending')
  assert.equal(out[1].state, 'Remis'); assert.equal(out[1].statePending, 'pending')
  assert.equal(out[2].state, 'Remis', 'un élément déjà remis garde son état')
})

test('recherche : serveur en ligne ; copies locales hors ligne (sites déjà ouverts seulement)', async () => {
  const { w, racks, state } = setup(); const { site } = seed(w)
  const other = w.addMachine({ props: { Dropper: { type: 'title', title: t('Dropper Lyon') } } })
  w.addRack({ title: 'Rack 14', site: other.id })
  const on = await racks.search({ q: '14' })
  assert.equal(on.offline, false)
  assert.deepEqual(on.items.map((i) => i.title), ['Casier 14-2', 'Rack 14', 'Rack 1141'])
  assert.equal(on.items[1].siteTitle, 'Dropper Lyon')

  await racks.loadSite(site.nid)                      // seul Ordener est sur l'appareil
  state.online = false
  const off = await racks.search({ q: '14' })
  assert.equal(off.offline, true)
  assert.deepEqual(off.items.map((i) => i.title), ['Casier 14-2', 'Rack 1141'])
  assert.deepEqual((await racks.search({ q: '14', kind: 'rack' })).items.map((i) => i.title), ['Rack 1141'])
  assert.equal((await racks.search({ q: '14', site: 'inconnu' })).items.length, 0)
  assert.equal(searchLocal([], { q: 'x' }).length, 0)
})
