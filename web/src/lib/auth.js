// Session de connexion (voir gas/Auth.gs). Sans Vue : testable seule, utilisée par api.js.
//  · la session (jeton signé par le serveur) est gardée sur l'appareil ; elle vaut ~30 jours ;
//  · l'heure du serveur à la connexion sert à juger l'expiration sans dépendre de l'horloge du téléphone ;
//  · une session expirée n'empêche PAS de travailler hors ligne (les données sont sur l'appareil) :
//    c'est le serveur qui refuse, au premier appel réseau, et l'application demande alors de se reconnecter.

const KEY = 'ouidrop.auth.v1'

export const ROLES = ['tech', 'support']
export const ROLE_LABELS = { tech: 'Technicien', support: 'Support' }
export const roleRank = (r) => ROLES.indexOf(r)
export const can = (role, minRole = 'tech') => roleRank(role) >= 0 && roleRank(role) >= roleRank(minRole)

export const isRejectCode = (code) => code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED'

let state = null            // { session, role, issuedAt, expiresAt, offset }
let loaded = false
const listeners = new Set()

function store(storage) {
  return storage || (typeof localStorage !== 'undefined' ? localStorage : null)
}

export function readAuth(storage) {
  try {
    const raw = JSON.parse(store(storage).getItem(KEY))
    if (raw && typeof raw.session === 'string' && ROLES.includes(raw.role) && Number.isFinite(raw.expiresAt)) {
      return { session: raw.session, role: raw.role, issuedAt: raw.issuedAt || 0, expiresAt: raw.expiresAt, offset: Number(raw.offset) || 0 }
    }
  } catch { /* absent ou abîmé : non connecté */ }
  return null
}

export function getAuth() {
  if (!loaded) {
    state = readAuth()
    loaded = true
  }
  return state
}

export const getSession = () => (getAuth() ? getAuth().session : '')

const emit = (e) => listeners.forEach((fn) => fn(e))
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// `data` = réponse de login : { session, role, issuedAt, expiresAt, serverNow }
export function setAuth(data, { now = Date.now(), storage } = {}) {
  state = {
    session: data.session, role: data.role, issuedAt: data.issuedAt || now, expiresAt: data.expiresAt,
    offset: Number.isFinite(data.serverNow) ? data.serverNow - now : 0
  }
  loaded = true
  try { store(storage).setItem(KEY, JSON.stringify(state)) } catch { /* stockage indisponible : valable pour cette session */ }
  emit({ type: 'change' })
  return state
}

// Mise à jour après `session` (la session est toujours valable) : niveau, échéance, décalage d'horloge.
export function refreshAuth(info, opts = {}) {
  const cur = getAuth()
  if (!cur) return null
  return setAuth({ ...cur, role: info.role, expiresAt: info.expiresAt, serverNow: info.serverNow }, opts)
}

export function clearAuth({ storage } = {}) {
  state = null
  loaded = true
  try { store(storage).removeItem(KEY) } catch { /* rien à faire */ }
  emit({ type: 'change' })
}

// Le serveur a refusé la session : on l'oublie (les données de l'appareil restent) et on prévient l'interface.
export function reportAuthFailure(code) {
  if (!getAuth()) return
  clearAuth()
  emit({ type: 'rejected', code })
}

export function isExpired(auth, now = Date.now()) {
  return !auth || now + (auth.offset || 0) >= auth.expiresAt
}

export function daysLeft(auth, now = Date.now()) {
  if (!auth) return 0
  return Math.max(0, Math.ceil((auth.expiresAt - (now + (auth.offset || 0))) / 86400000))
}

// pour les tests
export function _reset() {
  state = null
  loaded = false
  listeners.clear()
}
