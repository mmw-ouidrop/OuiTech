// Fiches méthodes : service (cache local, hors ligne, médias) branché sur le VRAI code serveur (gas/Methods.gs, Notion simulé).
import 'fake-indexeddb/auto'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { makeWorld, run, api as gasApi, PNG_B64 } from '../../gas/tests/fake-notion.mjs'
import { createStore } from '../src/db.js'
import { createMethodsService, groupMethods, groupNodes, embedUrl, linkifySegments, statusTone, imageKeys } from '../src/lib/methods.js'
class ApiError extends Error { constructor(code, message) { super(message); this.code = code } }

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs'].map((f) => fs.readFileSync(path.join(here, '../../gas', f), 'utf8'))
let seq = 0
const rt = (t) => [{ type: 'text', text: { content: t } }]
const img = (url) => ({ type: 'image', image: { type: 'file', file: { url }, caption: [] } })
const PNG = [...Buffer.from(PNG_B64, 'base64')]

function setup() {
  const w = makeWorld()
  SRC.forEach((s) => run(w.ctx, s))
  const { get } = gasApi(w)
  const unwrap = (r) => { if (!r.ok) throw new ApiError(r.error.code, r.error.message); return r.data }
  const state = { online: true, networkDown: false }
  const guard = (fn) => (...a) => { if (state.networkDown) throw new ApiError('NETWORK', 'Pas de réseau.'); return fn(...a) }
  const api = {
    methods: guard(({ sinceRev } = {}) => unwrap(get({ action: 'methods', sinceRev: sinceRev || '' }))),
    method: guard(({ id, sinceEdited }) => unwrap(get({ action: 'method', id, sinceEdited: sinceEdited || '' }))),
    methodMedia: guard(({ page, key, mode }) => unwrap(get({ action: 'methodMedia', page, key, mode: mode || 'data' })))
  }
  const store = createStore('methods-' + ++seq)
  const service = createMethodsService({ store, api, isOnline: () => state.online })
  return { w, state, store, service, api }
}

function seedOne(w) {
  w.addFile('https://files.test/1.png', PNG)
  w.addFile('https://files.test/2.png', PNG)
  w.addFile('https://files.test/s.pdf', [37, 80, 68, 70], 'application/pdf')
  return w.addMethod({
    title: 'Remplacement Lexium', groups: ['ASC', 'NAV'], status: 'Terminé',
    support: [{ name: 's.pdf', url: 'https://files.test/s.pdf' }],
    blocks: [
      { type: 'heading_2', heading_2: { rich_text: rt('Étapes') } },
      { type: 'numbered_list_item', numbered_list_item: { rich_text: rt('Couper'), children: [img('https://files.test/1.png')] } },
      img('https://files.test/2.png')
    ]
  })
}

test('liste : récupérée, gardée sur l’appareil, relue hors ligne ; inchangée = aucune relecture', async () => {
  const { w, state, service, store } = setup(); seedOne(w)
  const a = await service.loadList()
  assert.equal(a.items.length, 1); assert.equal(a.fromCache, false)
  assert.equal((await store.getMethodsList()).items[0].title, 'Remplacement Lexium')

  w.calls.length = 0
  const b = await service.loadList()
  assert.equal(b.items.length, 1)
  assert.equal(w.calls.filter((c) => /\/query$/.test(c.path)).length, 0, 'cache serveur de 2 min : Notion non interrogé')

  state.online = false
  const c = await service.loadList()
  assert.equal(c.fromCache, true); assert.equal(c.items.length, 1)
})

test('liste : hors ligne sans copie = message clair ; réseau coupé avec copie = copie + code', async () => {
  const { w, state, service } = setup(); seedOne(w)
  state.online = false
  assert.equal((await service.loadList()).error, 'OFFLINE_EMPTY')
  state.online = true
  await service.loadList()
  state.networkDown = true
  const r = await service.loadList()
  assert.equal(r.fromCache, true); assert.equal(r.error, 'NETWORK'); assert.equal(r.items.length, 1)
})

test('fiche : gardée, relue sans réseau, mise à jour quand Notion change', async () => {
  const { w, state, service } = setup(); const m = seedOne(w)
  const a = await service.loadMethod(m.nid)
  assert.equal(a.method.title, 'Remplacement Lexium'); assert.equal(a.fromCache, false)

  w.calls.length = 0
  const same = await service.loadMethod(m.nid)
  assert.equal(same.method.title, 'Remplacement Lexium')
  assert.equal(w.calls.filter((c) => /children/.test(c.path)).length, 0, 'inchangée : corps non relu')

  w.methodPages[0].last_edited_time = '2026-10-21T08:00:00Z'
  w.methodPages[0].properties.Nom.title[0].plain_text = 'Lexium (v2)'
  assert.equal((await service.loadMethod(m.nid)).method.title, 'Lexium (v2)')

  state.online = false
  assert.equal((await service.loadMethod(m.nid)).method.title, 'Lexium (v2)')
  assert.equal((await service.loadMethod('0'.repeat(32))).error, 'OFFLINE_EMPTY')
})

test('médias : téléchargés une fois, ensuite lus sur l’appareil même sans réseau ni lien valide', async () => {
  const { w, state, service, store } = setup(); const m = seedOne(w)
  const { method } = await service.loadMethod(m.nid)
  const keys = imageKeys(method); assert.equal(keys.length, 2)
  const r1 = await service.getMedia(m.nid, keys[0])
  assert.ok(r1.blob && r1.blob.size === PNG.length)

  // les liens Notion expirent : la copie locale suffit
  delete w.files['https://files.test/1.png']
  state.online = false
  const r2 = await service.getMedia(m.nid, keys[0])
  assert.ok(r2.blob)
  assert.equal((await service.getMedia(m.nid, keys[1])).error, 'OFFLINE')
  assert.deepEqual([...(await store.listMethodMediaKeys(m.nid))], [keys[0]])
})

test('préchargement d’une fiche : images + support gardés ; relancé = rien à refaire ; gros fichier signalé', async () => {
  const { w, service, store } = setup(); const m = seedOne(w)
  w.addFile('https://files.test/big.png', new Array(7 * 1024 * 1024).fill(1))
  w.addMethod({ title: 'Gros', groups: ['X'], blocks: [img('https://files.test/big.png')] })
  const { method } = await service.loadMethod(m.nid)
  const r = await service.prefetch(method)
  assert.deepEqual({ done: r.done, failed: r.failed, skipped: r.skipped }, { done: 3, failed: 0, skipped: 0 })   // 2 images + 1 support
  const again = await service.prefetch(method)
  assert.deepEqual({ done: again.done, skipped: again.skipped }, { done: 0, skipped: 3 })

  const big = (await service.loadList()).items.find((i) => i.title === 'Gros')
  const g = (await service.loadMethod(big.id)).method
  const rg = await service.prefetch(g)
  assert.equal(rg.tooLarge, 1); assert.equal(rg.done, 0)
  const stats = await store.methodsCacheStats()
  assert.equal(stats.media, 3)
})

test('tout télécharger : toutes les fiches publiées, progression, arrêt hors ligne', async () => {
  const { w, state, service, store } = setup(); seedOne(w)
  w.addMethod({ title: 'Courroies', groups: ['ASC'], blocks: [] })
  const { items } = await service.loadList()
  const progress = []
  const out = await service.prefetchAll(items, { onProgress: (p) => progress.push(p.n) })
  assert.equal(out.methods, 2); assert.equal(out.images, 3)
  assert.deepEqual(progress, [1, 2])
  assert.equal((await store.listCachedMethodIds()).size, 2)
  await store.clearMethodsCache()
  assert.equal((await store.methodsCacheStats()).methods, 0)
  state.online = false
  assert.equal((await service.prefetchAll(items)).methods, 0)
})

test('fiche supprimée ou non publiée : NOT_FOUND remonté (pas de copie fantôme)', async () => {
  const { w, service } = setup(); const m = seedOne(w)
  w.methodPages[0].archived = true
  await assert.rejects(() => service.loadMethod(m.nid), (e) => e.code === 'NOT_FOUND')
})

test('regroupement et recherche : ensembles multiples, « Autres » en dernier, accents et casse ignorés', () => {
  const items = [
    { id: '1', title: 'Courroies', summary: '', groups: ['ASC', 'NAV'] },
    { id: '2', title: 'Armoire', summary: 'Plan électrique', groups: [] },
    { id: '3', title: 'Étic redémarrage', summary: '', groups: ['Etic'] }
  ]
  const g = groupMethods(items)
  assert.deepEqual(g.map((x) => x.group), ['ASC', 'Etic', 'NAV', 'Autres'])
  assert.deepEqual(groupMethods(items, 'ELEC').map((x) => x.group), ['Autres'])
  assert.deepEqual(groupMethods(items, 'etic redem').map((x) => x.items[0].id), ['3'])
  assert.deepEqual(groupMethods(items, 'nav courroie').map((x) => x.group), ['ASC', 'NAV'])
  assert.deepEqual(groupMethods(items, 'zzz'), [])
})

test('aides : listes regroupées, vidéos intégrables, adresses cliquables, tons de statut', () => {
  const nodes = [{ k: 'li', n: 1 }, { k: 'li', n: 1 }, { k: 'li', n: 0 }, { k: 'p' }, { k: 'li', n: 0 }]
  assert.deepEqual(groupNodes(nodes).map((n) => (n.k === 'list' ? n.type + n.items.length : n.k)), ['ol2', 'ul1', 'p', 'ul1'])
  assert.equal(embedUrl('https://youtu.be/abcdefghijk'), 'https://www.youtube-nocookie.com/embed/abcdefghijk')
  assert.equal(embedUrl('https://www.youtube.com/watch?v=abcdefghijk&t=3'), 'https://www.youtube-nocookie.com/embed/abcdefghijk')
  assert.equal(embedUrl('https://vimeo.com/123456'), 'https://player.vimeo.com/video/123456')
  assert.equal(embedUrl('https://example.com/v.mp4'), null)
  assert.equal(embedUrl('pas une adresse'), null)
  assert.deepEqual(linkifySegments('Voir https://a.fr/x). Merci'), [{ t: 'Voir ' }, { t: 'https://a.fr/x', h: 'https://a.fr/x' }, { t: '). Merci' }])
  assert.equal(statusTone('Terminé'), 'done'); assert.equal(statusTone('A mettre à jour'), 'danger'); assert.equal(statusTone('En cours'), 'info')
})

test('fiche enregistrée dans un ancien format : relue en entier même si Notion n’a pas bougé (carrousel, commentaires)', async () => {
  const { w, service, store } = setup(); const m = seedOne(w)
  const fresh = await service.loadMethod(m.nid)
  assert.equal(fresh.method.v, 2); assert.ok(Array.isArray(fresh.method.gallery))
  const { gallery, comments, commentsEnabled, v, ...old } = fresh.method         // ce que l'ancienne version avait enregistré
  await store.saveMethod(old)
  w.calls.length = 0
  const again = await service.loadMethod(m.nid)
  assert.equal(again.method.v, 2)
  assert.ok(w.calls.some((c) => /children/.test(c.path)), 'corps relu')
  w.calls.length = 0
  await service.loadMethod(m.nid)
  assert.equal(w.calls.filter((c) => /children/.test(c.path)).length, 0, 'ensuite : plus de relecture tant que Notion ne change pas')
})
