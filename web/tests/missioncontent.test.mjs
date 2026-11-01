// Contenu d'une mission côté PWA : listes, mise en forme, auteur, champs vides, fichiers des champs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildItems, mergeServerState } from '../src/lib/shared.js'
import { groupLists, buildOutline } from '../src/lib/outline.js'
import { personName, isEmptyProperty } from '../src/lib/format.js'
import { propertyFileKeys, hostedMediaKeys } from '../src/lib/methods.js'

const li = (style, text, level = 0, id = text) => ({ kind: 'text', style, text, level, blockId: id, rt: [{ t: text, b: 1 }] })

test('listes : numéros par niveau, remise à 1 après un autre bloc, mise en forme conservée', () => {
  const items = buildItems({ templateBlocks: [
    li('numbered_list', 'A'), li('numbered_list', 'B'), li('bulleted_list', 'x', 1), li('numbered_list', 'B1', 1), li('numbered_list', 'B2', 1),
    li('numbered_list', 'C'),
    { kind: 'text', style: 'paragraph', text: 'Pause', blockId: 'p', rt: [{ t: 'Pause' }] },
    li('numbered_list', 'D')
  ] })
  assert.deepEqual(items.map((i) => i.num), [1, 2, undefined, 1, 2, 3, undefined, 1])
  assert.deepEqual(items.map((i) => i.level), [0, 0, 1, 1, 1, 0, undefined, 0])
  assert.deepEqual(items[0].rt, [{ t: 'A', b: 1 }])
})

test('un contenu enregistré avant la mise en forme (sans rt ni level) s’affiche encore', () => {
  const items = buildItems({ templateBlocks: [{ kind: 'text', style: 'bulleted_list', text: 'Vieux', blockId: 'v' }] })
  assert.equal(items[0].rt, null)
  assert.equal(items[0].level, 0)
})

test('groupLists : les lignes de liste consécutives forment un seul bloc ; une section ou un champ le coupe', () => {
  const items = buildItems({ templateBlocks: [
    li('bulleted_list', 'a'), li('bulleted_list', 'b'),
    { kind: 'component', id: 'f1', type: 'text', label: 'Champ', blockId: 'c' },
    li('numbered_list', 'c')
  ] })
  const rows = buildOutline(items, { value: () => '', photos: () => 0 }).rows
  const out = groupLists(rows)
  assert.deepEqual(out.map((r) => [r.k, r.rows ? r.rows.length : 1]), [['list', 2], ['field', 1], ['list', 1]])
})

test('auteur : texte, objet ou valeur abîmée donnent toujours un nom lisible', () => {
  assert.equal(personName('Ana Roy'), 'Ana Roy')
  assert.equal(personName({ firstName: 'Ana', lastName: 'Roy' }), 'Ana Roy')
  assert.equal(personName({ name: 'Ana' }), 'Ana')
  assert.equal(personName('[object Object]'), '')
  assert.equal(personName(undefined), '')
  const rec = { fields: {}, custom: {}, customRemovals: [], photoRemovals: [] }
  const m = mergeServerState(rec, { rev: 1, status: 'draft', fields: { a: { v: 'x', at: 1, by: '[object Object]' }, b: { v: 'y', at: 1, by: { firstName: 'Léo', lastName: 'Petit' } } }, custom: [] })
  assert.equal(m.patch.fields.a.by, '')
  assert.equal(m.patch.fields.b.by, 'Léo Petit')
})

test('champs vides : texte vide, liste vide, nombre absent ; « Non » et 0 sont des valeurs', () => {
  const e = (p) => isEmptyProperty(p)
  assert.deepEqual([e({ value: '' }), e({ value: '  ' }), e({ value: [] }), e({ value: null }), e({ value: '', files: [] })], [true, true, true, true, true])
  assert.deepEqual([e({ value: false }), e({ value: 0 }), e({ value: 'a' }), e({ value: ['a'] }), e({ value: ['x.png'], files: [{ key: 'k' }] })], [false, false, false, false, false])
})

test('fichiers des champs : images et PDF hébergés sont gardés hors ligne, pas les vidéos ni les liens externes', () => {
  const props = [
    { label: 'Photos', value: [], files: [{ key: 'p:Photos:0', kind: 'image' }, { key: 'p:Photos:1', kind: 'video' }, { key: 'p:Photos:2', kind: 'pdf' }, { key: 'p:Photos:3', kind: 'image', url: 'https://x/y.png' }] },
    { label: 'Texte', value: 'a' }
  ]
  assert.deepEqual(propertyFileKeys(props), ['p:Photos:0', 'p:Photos:2'])
  assert.deepEqual(propertyFileKeys(undefined), [])
  assert.deepEqual(hostedMediaKeys([{ kind: 'media', type: 'image', blockId: 'b1' }]), ['b1'])
})
