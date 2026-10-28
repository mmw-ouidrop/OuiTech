import test from 'node:test'
import assert from 'node:assert/strict'
import { readAuth, getAuth, getSession, setAuth, refreshAuth, clearAuth, reportAuthFailure, isExpired, daysLeft, subscribe, can, isRejectCode, _reset } from '../src/lib/auth.js'

const memory = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m }
}
const DAY = 86400000
const login = (now, over = {}) => ({ session: 'v1.a.b', role: 'tech', issuedAt: now, expiresAt: now + 30 * DAY, serverNow: now, ...over })

test.beforeEach(() => _reset())

test('connexion : session mémorisée et relue, déconnexion = oubli (sans toucher aux données)', () => {
  const st = memory()
  assert.equal(readAuth(st), null)
  setAuth(login(1000), { now: 1000, storage: st })
  assert.equal(readAuth(st).role, 'tech')
  assert.equal(getSession(), 'v1.a.b')
  clearAuth({ storage: st })
  assert.equal(readAuth(st), null)
  assert.equal(getSession(), '')
})

test('données abîmées ou niveau inconnu : considéré non connecté', () => {
  const st = memory()
  st.setItem('ouidrop.auth.v1', '{pas du json')
  assert.equal(readAuth(st), null)
  st.setItem('ouidrop.auth.v1', JSON.stringify({ session: 'x', role: 'admin', expiresAt: 5 }))
  assert.equal(readAuth(st), null)
})

test('expiration jugée sur l’heure du SERVEUR : un téléphone décalé ne se trompe pas', () => {
  const st = memory()
  const server = 1_800_000_000_000
  const phoneNow = server - 3 * 3600_000                      // téléphone en retard de 3 h
  setAuth(login(server), { now: phoneNow, storage: st })
  const a = getAuth()
  assert.equal(isExpired(a, phoneNow + 29 * DAY), false)
  assert.equal(isExpired(a, phoneNow + 30 * DAY + 1000), true)
  assert.equal(daysLeft(a, phoneNow), 30)
  assert.equal(daysLeft(a, phoneNow + 29.5 * DAY), 1)
  assert.equal(isExpired(null), true)
})

test('refus du serveur : session oubliée, interface prévenue, une seule fois', () => {
  const st = memory()
  const events = []
  subscribe((e) => events.push(e.type + ':' + (e.code || '')))
  setAuth(login(1000), { now: 1000, storage: st })
  reportAuthFailure('SESSION_EXPIRED')
  reportAuthFailure('SESSION_EXPIRED')                          // déjà déconnecté : rien de plus
  assert.deepEqual(events, ['change:', 'change:', 'rejected:SESSION_EXPIRED'])
  assert.equal(getAuth(), null)
})

test('mise à jour après contrôle de session : niveau et échéance suivent le serveur', () => {
  const st = memory()
  setAuth(login(1000), { now: 1000, storage: st })
  refreshAuth({ role: 'support', expiresAt: 1000 + 10 * DAY, serverNow: 5000 }, { now: 5000, storage: st })
  assert.equal(getAuth().role, 'support')
  assert.equal(getAuth().expiresAt, 1000 + 10 * DAY)
})

test('niveaux : support ⊇ technicien', () => {
  assert.equal(can('tech', 'tech'), true)
  assert.equal(can('tech', 'support'), false)
  assert.equal(can('support', 'tech'), true)
  assert.equal(can('support', 'support'), true)
  assert.equal(can(undefined, 'tech'), false)
  assert.equal(isRejectCode('UNAUTHORIZED') && isRejectCode('SESSION_EXPIRED') && !isRejectCode('BAD_PASSWORD'), true)
})
