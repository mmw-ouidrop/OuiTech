// Pont entre l'interface Vue et le reste : connexion, identité, moteur de synchro.
import { ref, shallowRef, computed } from 'vue'
import store from '../db.js'
import { api } from './api.js'
import { online } from './online.js'
import { loadIdentity, saveName, hasName, fullName } from './identity.js'
import { createSyncEngine, watchMission } from './sync.js'
import { getAuth, setAuth, clearAuth, refreshAuth, subscribe, isExpired, daysLeft, can, ROLE_LABELS } from './auth.js'

/* ───────────────────────────── Identité ───────────────────────────── */

export const identity = ref(loadIdentity())
export const named = computed(() => hasName(identity.value))
export const displayName = computed(() => fullName(identity.value))

export function setName(firstName, lastName) {
  identity.value = saveName(identity.value, firstName, lastName)
}

/* ───────────────────────────── Connexion ───────────────────────────── */

export const auth = shallowRef(getAuth())
export const loggedIn = computed(() => !!auth.value)
export const role = computed(() => (auth.value ? auth.value.role : null))
export const roleLabel = computed(() => (role.value ? ROLE_LABELS[role.value] : ''))
export const hasRole = (min) => can(role.value, min)

// Horloge réactive (une minute) pour « session expirée » / « jours restants ».
const tick = ref(Date.now())
if (typeof setInterval !== 'undefined') setInterval(() => (tick.value = Date.now()), 60_000)
export const sessionExpired = computed(() => loggedIn.value && isExpired(auth.value, tick.value))
export const sessionDaysLeft = computed(() => (loggedIn.value ? daysLeft(auth.value, tick.value) : 0))

// Message à montrer sur la page de connexion après un refus du serveur.
export const loginNotice = ref('')

subscribe((e) => {
  auth.value = getAuth()
  if (e.type === 'rejected') {
    loginNotice.value = e.code === 'SESSION_EXPIRED'
      ? 'Votre session a expiré (ou a été révoquée). Reconnectez-vous : vos saisies sur cet appareil sont conservées.'
      : 'Connexion requise. Vos saisies sur cet appareil sont conservées.'
  }
})

export async function login({ password, firstName, lastName }) {
  const data = await api.login({ password, firstName, lastName, clientId: identity.value.clientId })
  setName(firstName, lastName)
  setAuth(data)
  loginNotice.value = ''
}

export function logout() {
  clearAuth()
}

// Au lancement (en ligne) : la session est-elle toujours acceptée ? Hors ligne ou serveur injoignable : on ne change rien.
export async function validateSession() {
  if (!loggedIn.value || !online.value) return
  try {
    refreshAuth(await api.session())
  } catch { /* refus → déjà traité par api.js ; réseau → on réessaiera */ }
}

/* ─────────────────────────── Synchronisation ─────────────────────────── */

export const engine = createSyncEngine({
  store,
  api,
  getIdentity: () => identity.value,
  isOnline: () => online.value && loggedIn.value
})

export const watch = (id) => watchMission(engine, store, id)

// À l'ouverture de l'app et au retour du réseau : on vide ce qui attend (toutes missions).
export function startBackgroundSync() {
  const run = () => engine.syncPending().catch(() => {})
  run()
  if (typeof window !== 'undefined') window.addEventListener('online', run)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') run()
    })
  }
}
