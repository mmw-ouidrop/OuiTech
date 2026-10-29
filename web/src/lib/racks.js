// Racks et casiers KO : tri, recherche, diagnostics en attente, service « copie locale d'abord ».
// Aucune dépendance à Vue.

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export const KIND_LABELS = { casier: 'Casiers', rack: 'Racks', autre: 'Autres' }
export const STATE_TONE = { repaired: 'done', unrepairable: 'danger', left_as_is: 'info', watch: 'info' }

// Sites triés par nom, filtrés par la recherche.
export function filterSites(sites, query = '') {
  const q = fold(query).trim().split(/\s+/).filter(Boolean)
  return sites
    .filter((s) => !q.length || q.every((w) => fold(s.title).includes(w)))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
}

// { casier:[…], rack:[…], autre:[…] } — « Autres » n'apparaît que s'il y en a.
export function splitByKind(items) {
  const out = { casier: [], rack: [], autre: [] }
  for (const it of items) (out[it.kind] || out.autre).push(it)
  return out
}

export const needsDiagnosis = (it) => !it.diag && !it.pending

// Ton de la pastille d'un diagnostic (d'après son libellé, via la liste d'états du serveur).
export function diagTone(label, states) {
  const st = (states || []).find((s) => s.label === label)
  return st ? STATE_TONE[st.id] || 'info' : 'info'
}

// Superpose les diagnostics saisis sur cet appareil et pas encore envoyés : l'écran montre tout de suite
// ce que le technicien vient de noter. Plusieurs envois pour un même élément : le plus récent l'emporte.
export function overlayPending(items, entries, states, fmtAt = (ts) => new Date(ts).toLocaleString('fr-FR')) {
  const latest = new Map()
  for (const e of entries) {
    if (e.kind !== 'rack_diag') continue
    const prev = latest.get(e.payload.pageId)
    if (!prev || e.createdAt >= prev.createdAt) latest.set(e.payload.pageId, e)
  }
  return items.map((it) => {
    const e = latest.get(it.id)
    if (!e) return it
    const st = (states || []).find((s) => s.id === e.payload.state)
    const diag = { state: st ? st.label : e.payload.state, at: fmtAt(e.createdAt), by: e.payload.name, comment: e.payload.comment || '' }
    return { ...it, diag, history: it.diag ? [it.diag, ...(it.history || [])] : it.history || [], pending: e.status === 'failed' ? 'failed' : 'pending', pendingId: e.id, pendingError: e.lastError }
  })
}

export function createRacksService({ store, api, isOnline = () => true }) {
  const isNetwork = (e) => e && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'BAD_RESPONSE')

  // → { data:{ sites, total }, fetchedAt, fromCache, error }
  async function loadOverview() {
    const cached = await store.getRacksOverview()
    if (!isOnline()) return { data: cached || null, fetchedAt: cached && cached.fetchedAt, fromCache: true, error: cached ? null : 'OFFLINE_EMPTY' }
    try {
      const res = await api.racksOverview({ sinceRev: cached && cached.rev })
      if (res.unchanged && cached) { await store.touchRacksOverview(); return { data: cached, fetchedAt: Date.now(), fromCache: false, error: null } }
      await store.saveRacksOverview(res)
      return { data: res, fetchedAt: Date.now(), fromCache: false, error: null }
    } catch (e) {
      if (cached && (isNetwork(e) || e.code === 'NOTION_FORBIDDEN')) return { data: cached, fetchedAt: cached.fetchedAt, fromCache: true, error: e.code }
      throw e
    }
  }

  // → { data:{ site, states, items }, fetchedAt, fromCache, error }
  async function loadSite(siteId) {
    const cached = await store.getRacksSite(siteId)
    if (!isOnline()) return { data: cached || null, fetchedAt: cached && cached.fetchedAt, fromCache: true, error: cached ? null : 'OFFLINE_EMPTY' }
    try {
      const res = await api.racks({ site: siteId, sinceRev: cached && cached.rev })
      if (res.unchanged && cached) { await store.touchRacksSite(siteId); return { data: cached, fetchedAt: Date.now(), fromCache: false, error: null } }
      await store.saveRacksSite(siteId, res)
      return { data: res, fetchedAt: Date.now(), fromCache: false, error: null }
    } catch (e) {
      if (cached && isNetwork(e)) return { data: cached, fetchedAt: cached.fetchedAt, fromCache: true, error: e.code }
      throw e
    }
  }

  // Un diagnostic vient d'être enregistré côté serveur : on met à jour la copie locale du site concerné.
  async function applyDiagnosis(pageId, result) {
    if (!result || result.duplicate) return
    for (const rec of await store.listRacksSites()) {
      if (!rec.items.some((i) => i.id === pageId)) continue
      const items = rec.items.map((i) => (i.id === pageId ? { ...i, diag: result.diag, history: result.history || [] } : i))
      await store.saveRacksSite(rec.siteId, { ...rec, items })
    }
  }

  return { loadOverview, loadSite, applyDiagnosis }
}
