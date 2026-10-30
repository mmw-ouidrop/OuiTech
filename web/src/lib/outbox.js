// File d'attente des envois courts (commentaires de méthode, diagnostics de racks) : écrits d'abord sur l'appareil,
// puis envoyés dès qu'il y a du réseau. Chaque envoi porte un identifiant : si la réponse se perd et qu'on le renvoie,
// le serveur l'ignore (pas de doublon).
//
//   store : { outboxAdd, outboxList, outboxUpdate, outboxRemove }
//   senders : { <kind>: (payload) => Promise }
//   onDone(entry, result) : appelé après chaque envoi réussi (mise à jour des copies locales)

const PERMANENT = new Set(['BAD_REQUEST', 'NOT_FOUND', 'COLUMN_MISSING', 'AUTHOR_REQUIRED', 'CONFIG_INVALID', 'CONFIG_MISSING', 'NOTION_FORBIDDEN', 'COMMENTS_FORBIDDEN', 'FORBIDDEN_ROLE', 'UNKNOWN_ACTION'])
const AUTH = new Set(['UNAUTHORIZED', 'SESSION_EXPIRED'])

export function createOutbox({ store, senders, isOnline = () => true, onDone }) {
  let running = null

  const add = (kind, payload) => store.outboxAdd(kind, payload)
  const list = () => store.outboxList()

  async function runOnce() {
    const out = { sent: 0, failed: 0, stopped: null }
    if (!isOnline()) { out.stopped = 'OFFLINE'; return out }
    for (const entry of await store.outboxList()) {
      if (entry.status === 'failed') continue
      const send = senders[entry.kind]
      if (!send) { await store.outboxUpdate(entry.id, { status: 'failed', lastError: { code: 'UNKNOWN_KIND', message: 'Type d’envoi inconnu' } }); out.failed++; continue }
      try {
        const result = await send({ ...entry.payload, id: entry.id })
        await store.outboxRemove(entry.id)
        out.sent++
        if (onDone) { try { await onDone(entry, result) } catch { /* la copie locale se corrigera à la prochaine lecture */ } }
      } catch (e) {
        const code = (e && e.code) || 'ERROR'
        const lastError = { code, message: (e && e.message) || String(e), at: Date.now() }
        if (PERMANENT.has(code)) {
          await store.outboxUpdate(entry.id, { status: 'failed', attempts: (entry.attempts || 0) + 1, lastError })
          out.failed++
          continue                                   // les suivants peuvent passer
        }
        await store.outboxUpdate(entry.id, { attempts: (entry.attempts || 0) + 1, lastError })
        out.stopped = AUTH.has(code) ? 'AUTH' : code   // réseau, serveur occupé, session : on réessaiera
        break
      }
    }
    return out
  }

  // Une seule passe à la fois ; un appel pendant une passe attend le résultat de celle-ci.
  function flush() {
    if (!running) running = runOnce().finally(() => { running = null })
    return running
  }

  // Remet un envoi refusé dans la file (ex. après avoir créé la colonne Notion manquante).
  const retry = (id) => store.outboxUpdate(id, { status: 'pending', lastError: null })
  const discard = (id) => store.outboxRemove(id)

  return { add, list, flush, retry, discard }
}
