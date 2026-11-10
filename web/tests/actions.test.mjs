import test from 'node:test'
import assert from 'node:assert/strict'
import { currentState, progress, stateLabel } from '../src/lib/actions.js'
import { buildReport } from '../src/lib/reportPdf.js'

test('état courant = dernier état choisi ; un commentaire seul ne change rien', () => {
  assert.equal(currentState([]), '')
  assert.equal(currentState([{ state: 'doing' }, { state: '', text: 'ok' }]), 'doing')
  assert.equal(currentState([{ state: 'doing' }, { state: 'done' }]), 'done')
  assert.equal(stateLabel('blocked'), 'Impossible')
})

test('progression : Terminée et Impossible comptent comme traitées', () => {
  const actions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const log = { a: [{ state: 'done' }], b: [{ state: 'doing' }], c: [{ state: 'blocked' }] }
  assert.deepEqual(progress(actions, log), { done: 2, total: 3 })
})

test('PDF : les actions et leur journal sont repris', () => {
  const rec = { reference: 'FI-1', readOnlyData: [], templateBlocks: [], fields: {}, custom: {}, actions: [{ id: 'a', title: 'Changer le rack' }], actionLog: { a: [{ state: 'done', text: 'fait', by: 'Ana', at: 1 }] } }
  const rep = buildReport(rec, [])
  assert.equal(rep.actions[0].state, 'Terminée')
  assert.equal(rep.actions[0].entries[0].text, 'fait')
})
