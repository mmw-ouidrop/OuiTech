// Liste des machines : service (cache local, hors ligne, photos) sur le VRAI code serveur (gas/Machines.gs, Notion simulé).
import 'fake-indexeddb/auto'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { makeWorld, run, api as gasApi, PNG_B64 } from '../../gas/tests/fake-notion.mjs'
import { createStore } from '../src/db.js'
import { createMachinesService } from '../src/lib/methods.js'
import { groupMachines, machineTone, mapLinks, formatSince, inactiveCount } from '../src/lib/machines.js'
class ApiError extends Error { constructor(code, message) { super(message); this.code = code } }

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs', 'Machines.gs'].map((f) => fs.readFileSync(path.join(here, '../../gas', f), 'utf8'))
let seq = 0
const t = (s) => [{ plain_text: s }]
const PNG = [...Buffer.from(PNG_B64, 'base64')]

function setup() {
  const w = makeWorld()
  SRC.forEach((s) => run(w.ctx, s))
  const { get } = gasApi(w)
  const unwrap = (r) => { if (!r.ok) throw new ApiError(r.error.code, r.error.message); return r.data }
  const state = { online: true, networkDown: false }
  const guard = (fn) => (...a) => { if (state.networkDown) throw new ApiError('NETWORK', 'Pas de réseau.'); return fn(...a) }
  const api = {
    machines: guard(({ sinceRev } = {}) => unwrap(get({ action: 'machines', sinceRev: sinceRev || '' }))),
    machine: guard(({ id, sinceEdited }) => unwrap(get({ action: 'machine', id, sinceEdited: sinceEdited || '' }))),
    machineMedia: guard(({ page, key, mode }) => unwrap(get({ action: 'machineMedia', page, key, mode: mode || 'data' })))
  }
  const store = createStore('machines-' + ++seq)
  const service = createMachinesService({ store: store.machinesCatalog, api, isOnline: () => state.online })
  return { w, state, store, service }
}

function seed(w) {
  w.addFile('https://files.test/p1.png', PNG)
  w.addFile('https://files.test/p2.png', PNG)
  const region = w.addRelated('Île de France')
  const a = w.addMachine({ props: {
    Dropper: { type: 'title', title: t('Dropper Ordener') },
    'Adresse du site (Carte)': { type: 'rich_text', rich_text: t('162 Rue Ordener, 75018 Paris, France') },
    'Code boite à clé': { type: 'rich_text', rich_text: t('1818') },
    'En exploitation': { type: 'select', select: { name: 'OUI' } },
    'Régions de stock': { type: 'relation', relation: [{ id: region }] },
    'Photo site': { type: 'files', files: [
      { name: 'p1.png', type: 'file', file: { url: 'https://files.test/p1.png' } },
      { name: 'p2.png', type: 'file', file: { url: 'https://files.test/p2.png' } }] }
  } })
  w.addMachine({ props: { Dropper: { type: 'title', title: t('Dropper Lyon') }, 'Adresse du site': { type: 'rich_text', rich_text: t('1 Rue X, 69001 Lyon') }, 'En exploitation': { type: 'select', select: { name: 'OUI' } } } })
  w.addMachine({ props: { Dropper: { type: 'title', title: t('Forum des Halles') }, 'En exploitation': { type: 'select', select: { name: 'NON' } } } })
  return a
}

test('liste et fiche : gardées sur l’appareil, relues sans réseau', async () => {
  const { w, state, service, store } = setup(); const a = seed(w)
  const l = await service.loadList()
  assert.equal(l.items.length, 3)
  const m = await service.loadMachine(a.nid)
  assert.equal(m.machine.keybox, '1818'); assert.equal(m.fromCache, false)

  state.online = false
  assert.equal((await service.loadList()).fromCache, true)
  const off = await service.loadMachine(a.nid)
  assert.equal(off.machine.keybox, '1818'); assert.equal(off.fromCache, true)
  assert.equal((await service.loadMachine('0'.repeat(32))).error, 'OFFLINE_EMPTY')
  assert.equal((await store.machinesCatalog.listCachedIds()).size, 1)
})

test('photos du site : gardées (même après expiration du lien), tout télécharger = toutes les machines', async () => {
  const { w, state, service, store } = setup(); const a = seed(w)
  const { items } = await service.loadList()
  const out = await service.prefetchAll(items)
  assert.equal(out.items, 3); assert.equal(out.images, 2)
  w.files = {}                         // les liens Notion ont expiré
  state.online = false
  const { machine } = await service.loadMachine(a.nid)
  const r = await service.getMedia(machine.id, machine.photos[0].key)
  assert.ok(r.blob && r.blob.size === PNG.length)
  assert.equal((await store.machinesCatalog.stats()).media, 2)
  await store.machinesCatalog.clear()
  assert.equal((await store.machinesCatalog.stats()).items, 0)
})

test('les catalogues sont indépendants : vider les machines ne touche pas aux méthodes', async () => {
  const { w, service, store } = setup(); seed(w)
  await service.loadList()
  await store.saveMethodsList({ rev: 'x', items: [{ id: '1', title: 'M' }] })
  await store.machinesCatalog.clear()
  assert.equal((await store.getMethodsList()).items.length, 1)
})

test('recherche et regroupement par région ; hors exploitation masquées par défaut', () => {
  const items = [
    { id: '1', title: 'Dropper Ordener', city: 'Paris', region: 'Île de France', active: true, project: 'D008' },
    { id: '2', title: 'Dropper Lyon', city: 'Lyon', region: '', active: true },
    { id: '3', title: 'Forum des Halles', city: 'Paris', region: 'Île de France', active: false },
    { id: '4', title: 'Inconnue', region: 'Gironde', active: null }
  ]
  assert.deepEqual(groupMachines(items).map((g) => [g.group, g.items.length]), [['Gironde', 1], ['Île de France', 1], ['Sans région', 1]])
  assert.deepEqual(groupMachines(items, '', { showInactive: true }).find((g) => g.group === 'Île de France').items.map((i) => i.id), ['1', '3'])
  assert.deepEqual(groupMachines(items, 'ile de france d008').map((g) => g.items[0].id), ['1'])
  assert.deepEqual(groupMachines(items, 'LYON').map((g) => g.group), ['Sans région'])
  assert.equal(inactiveCount(items), 1)
})

test('aides : itinéraires (adresse carte d’abord), tons, dates', () => {
  const l = mapLinks({ mapAddress: '162 Rue Ordener, 75018 Paris, France', address: 'x' })
  assert.ok(l.google.endsWith('162%20Rue%20Ordener%2C%2075018%20Paris%2C%20France'))
  assert.ok(l.waze.startsWith('https://waze.com/ul?q=') && l.waze.endsWith('&navigate=yes'))
  assert.equal(mapLinks({ address: 'A' }).apple, 'https://maps.apple.com/?q=A')
  assert.equal(mapLinks({}), null)
  assert.equal(machineTone('Station Bloquée'), 'danger'); assert.equal(machineTone('OK'), 'done'); assert.equal(machineTone(''), 'info')
  assert.equal(formatSince('2022-11-21'), '21 novembre 2022'); assert.equal(formatSince('21 novembre 2022'), '21 novembre 2022'); assert.equal(formatSince(''), '')
})
