import test from 'node:test'
import assert from 'node:assert/strict'
import { currentState, progress, stateLabel, mergeEntries } from '../src/lib/actions.js'
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

test('historique : commentaires Notion de tous les techniciens + envois locaux pas encore visibles, sans doublon', () => {
  const server = [
    { id: 'n1', by: 'Romane Perez', state: 'done', text: 'Pas d’amorces', at: 10 },
    { id: 'n2', by: 'Karim', state: '', text: 'Précision', at: 20 }
  ]
  const local = [
    { id: 'l1', by: 'Romane Perez', state: 'done', text: 'Pas d’amorces', at: 11, sent: true },   // déjà dans Notion
    { id: 'l2', by: 'Moi', state: 'doing', text: 'Je reprends', at: 30, sent: false }            // pas encore
  ]
  const m = mergeEntries(server, local)
  assert.deepEqual(m.map((e) => [e.by, e.local]), [['Romane Perez', false], ['Karim', false], ['Moi', true]])
  assert.equal(currentState(m), 'doing')                                  // la dernière mise à jour fait foi
  assert.equal(currentState(mergeEntries(server, [])), 'done')            // le commentaire seul ne change pas l'état
  assert.deepEqual(progress([{ id: 'a', entries: server }], {}), { done: 1, total: 1 })
})
