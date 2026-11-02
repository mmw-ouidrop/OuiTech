import test from 'node:test'
import assert from 'node:assert/strict'
import * as E from '../src/lib/templateEditor.js'

test('identifiant tiré du libellé : accents, doublons, préfixes réservés', () => {
  assert.equal(E.slugId('Étanchéité du joint'), 'etancheite_du_joint')
  assert.equal(E.slugId('N° de série ?'), 'n_de_serie')
  assert.equal(E.slugId('', new Set()), 'champ')
  assert.equal(E.slugId('Test', new Set(['test', 'test_2'])), 'test_3')
  assert.ok(!/^(u_|todo_)/.test(E.slugId('u x')))
})

test('un nouveau champ suit son libellé tant que l’identifiant n’est pas fixé', () => {
  const a = E.createItem('text'); const b = E.createItem('text')
  const items = [a, b]
  a.label = 'Tension'; E.syncAutoId(items, a)
  b.label = 'Tension'; E.syncAutoId(items, b)
  assert.deepEqual([a.id, b.id], ['tension', 'tension_2'])
  a.idAuto = false; a.label = 'Autre'; E.syncAutoId(items, a)
  assert.equal(a.id, 'tension')
  const old = { ...E.createItem('text'), ref: 'r1', id: 'fixe', label: 'x' }
  E.syncAutoId([old], old)
  assert.equal(old.id, 'fixe', 'un champ déjà enregistré garde son identifiant')
})

test('validation : mêmes règles que le serveur', () => {
  const f = (o) => ({ ...E.createItem('text'), id: 'a', label: 'A', ...o })
  const one = (it, extra = []) => E.validateItems([...extra, it])[it.key]
  assert.match(one(f({ label: ' ' })), /libellé/)
  assert.match(one(f({ id: 'a b' })), /invalide/)
  assert.match(one(f({ id: 'u_x' })), /réservé/)
  assert.match(one(f({ id: 'dup' }), [f({ id: 'dup' })]), /déjà utilisé/)
  assert.match(one(f({ type: 'radio_group', options: ['seul', ' '] })), /2 choix/)
  assert.equal(one(f({ type: 'select', options: ['a', 'b'] })), undefined)
  assert.match(one({ ...E.createItem('section') }), /titre/)
  assert.match(one({ ...E.createItem('html') }), /vide/)
})

test('déplacer, dupliquer, insérer', () => {
  const [a, b, c] = ['section', 'note', 'divider'].map((k) => E.createItem(k))
  assert.deepEqual(E.moveItem([a, b, c], 0, 1).map((i) => i.t), ['text', 'section', 'divider'])
  assert.deepEqual(E.moveItem([a, b, c], 0, -1), [a, b, c])
  assert.deepEqual(E.insertAfter([a, b], a.key, c).map((i) => i.t), ['section', 'divider', 'text'])
  assert.equal(E.insertAfter([a, b], 'inconnu', c).at(-1), c)
  const f = { ...E.createItem('radio_group'), ref: 'r', id: 'x', label: 'X', options: ['a', 'b'] }
  const d = E.duplicateItem([f], f.key)
  assert.equal(d.length, 2); assert.equal(d[1].ref, undefined); assert.equal(d[1].id, 'x_2')
  assert.notEqual(d[1].options, f.options)
})

test('import d’un autre template : sans liens, sans médias, identifiants libres', () => {
  const mine = [{ ...E.createItem('text'), id: 'tension', label: 'T' }]
  const got = E.forImport([{ t: 'section', ref: 'a', level: 1, text: 'S', fixed: true }, { t: 'locked', ref: 'b', label: 'Image' },
    { t: 'field', ref: 'c', type: 'text', id: 'tension', label: 'T' }], mine)
  assert.deepEqual(got.map((i) => i.t), ['section', 'field'])
  assert.equal(got[1].id, 'tension_2'); assert.equal(got[0].ref, undefined); assert.equal(got[0].fixed, undefined)
})

test('envoi : options nettoyées, rien d’interne, blocs existants gardent leur ref ; suppressions comptées', () => {
  const f = { ...E.createItem('select'), id: 'e', label: 'E', options: [' A ', 'A', 'B', ''] }
  const p = E.toPayload([{ key: 'k', t: 'section', ref: 'r1', level: 1, text: 'S', fixed: true }, f])
  assert.deepEqual(p[0], { t: 'section', ref: 'r1', level: 1, text: 'S' })
  assert.deepEqual(p[1].options, ['A', 'B'])
  assert.equal('key' in p[1], false)
  assert.equal(E.removedCount([{ ref: 'r1' }, { ref: 'r2' }, { ref: 'r3' }], [{ ref: 'r2' }, { }]), 2)
  assert.equal(E.signature([f]), E.signature([{ ...f, key: 'autre' }]))
})
