import test from 'node:test'
import assert from 'node:assert/strict'
import { NAV, visibleNav, activeNavId } from '../src/lib/nav.js'

test('menu : toutes les sections demandées, Réglages en pied de menu', () => {
  assert.deepEqual(NAV.filter((n) => !n.footer).map((n) => n.id), ['home', 'fiches', 'methodes', 'machines', 'racks', 'inventaires'])
  assert.deepEqual(NAV.filter((n) => n.footer).map((n) => n.id), ['settings'])
  assert.ok(new Set(NAV.map((n) => n.to)).size === NAV.length, 'une adresse par entrée')
})

test('niveaux : le support voit au moins ce que voit le technicien ; sans niveau, rien', () => {
  const tech = visibleNav('tech').map((n) => n.id)
  const sup = visibleNav('support').map((n) => n.id)
  assert.ok(tech.every((id) => sup.includes(id)))
  assert.equal(tech.includes('fiches') && tech.includes('racks') && tech.includes('machines') && tech.includes('methodes'), true)
  assert.deepEqual(visibleNav(null), [])
})

test('entrée active : la fiche ouverte dépend de « Fiches et CR »', () => {
  assert.equal(activeNavId({ name: 'mission', meta: { section: 'fiches' } }), 'fiches')
  assert.equal(activeNavId({ name: 'racks', meta: {} }), 'racks')
})
