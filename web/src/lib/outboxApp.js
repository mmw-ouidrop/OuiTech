// File d'envois branchée sur la base locale, le serveur, la session et le réseau (voir lib/outbox.js).
import { shallowRef, ref } from 'vue'
import * as store from '../db.js'
import { api } from './api.js'
import { online } from './online.js'
import { loggedIn } from './session.js'
import { createOutbox } from './outbox.js'
import { racks } from './racksApp.js'

// Copie locale d'une fiche méthode après l'envoi d'un commentaire.
async function applyComment(pageId, result) {
  if (!result || result.duplicate || !result.comments) return
  const m = await store.getMethod(pageId)
  if (m) await store.saveMethod({ ...m, comments: result.comments })
}

export const outbox = createOutbox({
  store,
  isOnline: () => online.value && loggedIn.value,
  senders: { method_comment: api.methodComment, rack_diag: api.rackDiagnosis, rack_state: api.rackSetState, rack_comment: api.rackComment },
  onDone: async (entry, result) => {
    if (entry.kind === 'rack_diag') await racks.applyDiagnosis(entry.payload.pageId, result)
    if (entry.kind === 'rack_state') await racks.applyState(entry.payload.pageId, result)
    if (entry.kind === 'method_comment') await applyComment(entry.payload.pageId, result)
  }
})

// Envois en attente (ou refusés), pour l'affichage.
export const pendingEntries = shallowRef([])
// Incrémenté à chaque envoi réussi : les écrans relisent leurs copies locales.
export const doneTick = ref(0)

export async function refreshOutbox() {
  pendingEntries.value = await outbox.list()
}

export async function flushOutbox() {
  const r = await outbox.flush()
  if (r.sent) doneTick.value++
  await refreshOutbox()
  return r
}

// Enregistre sur l'appareil, affiche tout de suite, envoie si possible.
export async function enqueue(kind, payload) {
  const entry = await outbox.add(kind, payload)
  await refreshOutbox()
  flushOutbox().catch(() => {})
  return entry
}

export const retryEntry = async (id) => { await outbox.retry(id); await flushOutbox() }
export const discardEntry = async (id) => { await outbox.discard(id); await refreshOutbox() }

export function startOutbox() {
  refreshOutbox().then(flushOutbox).catch(() => {})
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => flushOutbox().catch(() => {}))
    setInterval(() => { if (pendingEntries.value.some((e) => e.status === 'pending')) flushOutbox().catch(() => {}) }, 60_000)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushOutbox().catch(() => {}) })
  }
}
