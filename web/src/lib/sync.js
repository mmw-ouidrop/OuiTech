// ============================================================================
//  Moteur de synchronisation (voir gas/API.md)
//   · syncMission : photos → Drive, puis syncReport (champs, photos, statut) en
//     boucle tant qu'il reste des lots, puis fusion de la réponse ;
//   · pullMission : relève légère des modifications des collègues ;
//   · decideDue / watchMission : quand le faire (5 min, validation, retour réseau…).
//  Les dépendances (base, API, identité, horloge) sont injectées : testable sans navigateur.
// ============================================================================
import { computeChanges, serverFrozen, PHOTOS_PER_REQUEST } from './shared.js'
import { authorOf, fullName, hasName } from './identity.js'
import { blobToBase64 } from './image.js'

export const SYNC_EVERY_MS = 5 * 60_000     // enregistrement dans Notion, tant qu'il y a des modifications
export const FIRST_SYNC_MS = 30_000         // première sauvegarde : les responsables voient vite la fiche
export const POLL_EVERY_MS = 60_000         // relève des collègues, fiche ouverte
const MAX_ROUNDS = 25

export const RETRYABLE = new Set([
  'NETWORK', 'TIMEOUT', 'BAD_RESPONSE', 'BUSY', 'NOTION_UNAVAILABLE', 'NOTION_ERROR',
  'NOTION_UPLOAD_FAILED', 'INTERNAL', 'SERVER', 'STATE_DESYNC'
])
// (UNAUTHORIZED / SESSION_EXPIRED : jamais réessayés tels quels ; api.js renvoie l'utilisateur à la connexion)
export const isRetryable = (err) => !err || !err.code || RETRYABLE.has(err.code)

const hasQueued = (rows) => rows.some((r) => r.uploadStatus === 'queued')

export function createSyncEngine({ store, api, getIdentity, isOnline = () => true, now = Date.now, toBase64 = blobToBase64 }) {
  async function uploadOne(rec, row) {
    const fileData = await toBase64(row.fileBlob)
    try {
      const r = await api.uploadMedia({
        fileData, fileName: row.fileName, mimeType: row.mimeType, mediaId: row.mediaId, reference: rec.reference
      })
      await store.setPhotoUploaded(row.mediaId, r.fileId)
    } catch (err) {
      if (isRetryable(err)) throw err
      await store.failPhoto(row.mediaId, err.code)          // format refusé, etc. : inutile de réessayer
    }
  }

  // Envoie tout ce qui doit l'être pour une mission. Ne lève jamais : renvoie un résumé.
  async function syncMission(id, { force = false } = {}) {
    const who = getIdentity()
    if (!hasName(who)) return { skipped: 'NO_NAME' }
    if (!isOnline()) return { skipped: 'OFFLINE' }
    const first = await store.getIntervention(id)
    if (!first) return { skipped: 'NOT_FOUND' }
    if (!force && (first.nextTryAt || 0) > now()) return { skipped: 'BACKOFF' }
    if (!(await store.beginSync(id))) return { skipped: 'BUSY' }

    const summary = { requests: 0, applied: 0, conflicts: 0, photos: 0, rejected: false }
    let lastSignature = ''
    let photoError = null
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let rec = await store.getIntervention(id)
        if (!rec) break
        let rows = await store.listPhotos(id)

        // 1. photos prises sur cet appareil → copie de transit dans Drive (par lots)
        //    Un échec de photo ne bloque JAMAIS l'envoi du texte : on garde l'erreur, on envoie le
        //    reste, puis on termine en erreur (la photo repartira au prochain essai).
        if (!serverFrozen(rec)) {
          for (const row of rows.filter((r) => r.uploadStatus === 'queued').slice(0, PHOTOS_PER_REQUEST)) {
            try {
              await uploadOne(rec, row)
            } catch (err) {
              photoError = err
              break
            }
          }
          rows = await store.listPhotos(id)
          rec = await store.getIntervention(id)
        }

        // 2. un syncReport pour tout le reste
        const plan = computeChanges(rec, rows)
        if (!plan.hasWork) {
          if (round === 0 && !photoError) await pullMission(id, { inSync: true })
          break
        }
        const signature = JSON.stringify([Object.keys(plan.sent.fields).sort(), plan.batch.map((r) => r.mediaId), plan.changes.status || null, plan.photosLeft])
        if (signature === lastSignature) break                  // aucun progrès : on s'arrête
        lastSignature = signature

        const result = await api.syncReport({
          notionPageId: rec.id,
          reference: rec.reference,
          clientId: who.clientId,
          author: authorOf(who),
          clientNow: now(),
          baseRev: rec.baseRev,
          schema: rec.schema,
          changes: plan.changes
        })
        await store.applySyncResult(id, plan.sent, result)
        summary.requests++
        summary.applied += (result.applied && (result.applied.fields + result.applied.photos + result.applied.custom)) || 0
        summary.conflicts += (result.overridden || []).length
        summary.photos += (result.applied && result.applied.photos) || 0
        if (result.rejected && result.rejected.reason) summary.rejected = true

        const after = await store.getIntervention(id)
        const afterRows = await store.listPhotos(id)
        const next = computeChanges(after, afterRows)
        if (photoError) break
        if (!next.hasWork && !(hasQueued(afterRows) && !serverFrozen(after))) break
      }
      await store.endSync(id, photoError || undefined)
      return photoError ? { ...summary, error: photoError } : summary
    } catch (err) {
      await store.endSync(id, err)
      return { ...summary, error: err }
    }
  }

  // Relève légère : « rien de nouveau » ne coûte aucun appel à Notion côté serveur.
  async function pullMission(id, { inSync = false } = {}) {
    if (!isOnline()) return { skipped: 'OFFLINE' }
    const who = getIdentity()
    if (!hasName(who)) return { skipped: 'NO_NAME' }
    const rec = await store.getIntervention(id)
    if (!rec || (rec.syncing && !inSync)) return { skipped: 'BUSY' }
    try {
      const r = await api.getReport({ pageId: rec.id, sinceRev: rec.baseRev, clientId: who.clientId, name: fullName(who) })
      if (r.unchanged) {
        await store.setEditors(id, r.editors || [])
        return { unchanged: true }
      }
      if (!r.report) {
        if (rec.baseRev > 0) await store.markServerLost(id)
        return { lost: rec.baseRev > 0 }
      }
      await store.applyPull(id, { ...r.report, editors: r.editors || [] })
      return { updated: true }
    } catch (err) {
      return { error: err }
    }
  }

  // Au démarrage, au retour du réseau, à la reprise de l'app : tout ce qui attend.
  async function syncPending() {
    const out = []
    for (const rec of await store.listNeedingSync()) {
      if (serverFrozen(rec)) continue
      out.push([rec.id, await syncMission(rec.id)])
    }
    return out
  }

  return { syncMission, pullMission, syncPending }
}

/* ───────────────────────────── Quand synchroniser ───────────────────────────── */

// Pure. `st.lastPollAt` : dernière relève (mémoire de l'écran). Les seuils portent
// une gigue (`jitter`, ms) pour que plusieurs appareils ne frappent pas ensemble.
export function decideDue(rec, st, t, { jitter = 0, syncEveryMs = SYNC_EVERY_MS, firstSyncMs = FIRST_SYNC_MS, pollEveryMs = POLL_EVERY_MS } = {}) {
  const out = { sync: false, pull: false }
  if (!rec || rec.syncing) return out
  if (rec.needsSync === 1 && !serverFrozen(rec) && t >= (rec.nextTryAt || 0)) {
    const since = t - (rec.lastAttemptAt || 0)
    out.sync = since >= (rec.lastSyncAt ? syncEveryMs : firstSyncMs) + jitter
  }
  if (!out.sync && t - (st.lastPollAt || 0) >= pollEveryMs + jitter) out.pull = true
  return out
}

// Surveille UNE mission ouverte. À appeler au montage de l'écran, `stop()` au démontage.
export function watchMission(engine, store, id, { env = globalThis, tickMs = 15_000, now = Date.now, cfg } = {}) {
  const st = { lastPollAt: 0 }
  const jitter = Math.floor(Math.random() * 10_000)
  let stopped = false
  const visible = () => !env.document || env.document.visibilityState !== 'hidden'

  async function tick() {
    if (stopped || !visible()) return
    const rec = await store.getIntervention(id)
    const due = decideDue(rec, st, now(), { jitter, ...cfg })
    if (due.sync) await engine.syncMission(id)
    else if (due.pull) {
      st.lastPollAt = now()
      await engine.pullMission(id)
    }
  }
  const safeTick = () => tick().catch(() => {})

  const timer = setInterval(safeTick, tickMs)
  const onVisible = () => {
    if (visible()) {
      st.lastPollAt = 0
      safeTick()
    }
  }
  const onOnline = () => {
    st.lastPollAt = 0
    engine.syncMission(id, { force: true }).catch(() => {})
  }
  env.document && env.document.addEventListener('visibilitychange', onVisible)
  env.window && env.window.addEventListener('online', onOnline)
  safeTick()

  return {
    stop() {
      stopped = true
      clearInterval(timer)
      env.document && env.document.removeEventListener('visibilitychange', onVisible)
      env.window && env.window.removeEventListener('online', onOnline)
    },
    // Boutons « Valider », « Rouvrir », « Envoyer maintenant » : immédiat, sans attendre.
    syncNow: () => engine.syncMission(id, { force: true }),
    pullNow: () => engine.pullMission(id)
  }
}
