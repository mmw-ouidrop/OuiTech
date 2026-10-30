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

// Ton de la pastille d'état Notion : à traiter (KO) = alerte, « Diag tech » = à valider par le support, le reste = traité.
export function stateTone(state, { diagState = 'Diag tech', koStates = ['KO'] } = {}) {
  if (!state) return 'info'
  if (state === diagState) return 'info'
  return koStates.includes(state) ? 'danger' : 'done'
}

export const needsDiagnosis = (it) => !it.diag && !it.pending

// Ton de la pastille d'un diagnostic (d'après son libellé, via la liste d'états du serveur).
export function diagTone(label, states) {
  const st = (states || []).find((s) => s.label === label)
  return st ? STATE_TONE[st.id] || 'info' : 'info'
}

// Superpose ce qui a été saisi sur cet appareil et pas encore envoyé : l'écran montre tout de suite le résultat.
//  - diagnostic (rack_diag) : le diagnostic apparaît, et l'état passe en « Diag tech » si l'élément était à traiter ;
//  - changement d'état par le support (rack_state) : le nouvel état apparaît.
// Plusieurs envois pour un même élément : le plus récent l'emporte. meta = { koStates, diagState }.
export function overlayPending(items, entries, states, fmtAt = (ts) => new Date(ts).toLocaleString('fr-FR'), meta = {}) {
  const latest = new Map()
  const latestState = new Map()
  for (const e of entries) {
    const into = e.kind === 'rack_diag' ? latest : e.kind === 'rack_state' ? latestState : null
    if (!into) continue
    const prev = into.get(e.payload.pageId)
    if (!prev || e.createdAt >= prev.createdAt) into.set(e.payload.pageId, e)
  }
  return items.map((it) => {
    let out = it
    const e = latest.get(it.id)
    if (e) {
      const st = (states || []).find((s) => s.id === e.payload.state)
      const diag = { state: st ? st.label : e.payload.state, at: fmtAt(e.createdAt), by: e.payload.name, comment: e.payload.comment || '' }
      const toDiag = meta.diagState && (meta.koStates || []).includes(it.state)
      out = { ...out, diag, history: it.diag ? [it.diag, ...(it.history || [])] : it.history || [], pending: e.status === 'failed' ? 'failed' : 'pending', pendingId: e.id, pendingError: e.lastError, ...(toDiag ? { state: meta.diagState } : {}) }
    }
    const s = latestState.get(it.id)
    if (s) out = { ...out, state: s.payload.state, statePending: s.status === 'failed' ? 'failed' : 'pending', statePendingId: s.id, statePendingError: s.lastError }
    return out
  })
}

// Recherche sur les copies locales (hors ligne). Mêmes critères que le serveur : numéro (texte contenu), site, état, type.
//  state : '' = éléments à traiter (koStates) · '*' = tous · sinon un état précis.
export function searchLocal(records, { q = '', site = '', state = '', kind = '' } = {}) {
  const needle = fold(q).trim()
  const out = []
  const seen = new Set()
  for (const rec of records) {
    for (const it of rec.items) {
      if (seen.has(it.id)) continue
      const koStates = rec.koStates && rec.koStates.length ? rec.koStates : ['KO', 'Diag tech']
      if (state === '' && !koStates.includes(it.state)) continue
      if (state && state !== '*' && it.state !== state) continue
      if (kind && it.kind !== kind) continue
      if (site && (rec.site ? rec.site.id : '') !== site) continue
      if (needle && !fold(it.title).includes(needle)) continue
      seen.add(it.id)
      out.push({ ...it, siteId: rec.site ? rec.site.id : '', siteTitle: rec.site ? rec.site.title : '' })
    }
  }
  const digits = needle.match(/\d+/g) || []
  const rank = (it) => { const t = it.title.match(/\d+/g) || []; return digits.length && digits.every((d, i) => t[i] === d) ? 0 : 1 }
  return out.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'fr', { numeric: true })).slice(0, 100)
}

export function createRacksService({ store, api, isOnline = () => true }) {
  const isNetwork = (e) => e && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'BAD_RESPONSE')
  const key = (siteId, all) => (all ? siteId + ':all' : siteId)

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

  // all = true : tous les états (KO, Diag tech, Remis, Dead…), copie locale à part.
  // → { data:{ site, states, stateOptions, items }, fetchedAt, fromCache, error }
  async function loadSite(siteId, { all = false } = {}) {
    const k = key(siteId, all)
    const cached = await store.getRacksSite(k)
    if (!isOnline()) return { data: cached || null, fetchedAt: cached && cached.fetchedAt, fromCache: true, error: cached ? null : 'OFFLINE_EMPTY' }
    try {
      const res = await api.racks({ site: siteId, all, sinceRev: cached && cached.rev })
      if (res.unchanged && cached) { await store.touchRacksSite(k); return { data: cached, fetchedAt: Date.now(), fromCache: false, error: null } }
      await store.saveRacksSite(k, res)
      return { data: await store.getRacksSite(k), fetchedAt: Date.now(), fromCache: false, error: null }
    } catch (e) {
      if (cached && isNetwork(e)) return { data: cached, fetchedAt: cached.fetchedAt, fromCache: true, error: e.code }
      throw e
    }
  }

  // Met à jour un élément dans toutes les copies locales qui le contiennent.
  async function patchItem(pageId, patch) {
    for (const rec of await store.listRacksSites()) {
      if (!rec.items.some((i) => i.id === pageId)) continue
      const items = rec.items.map((i) => (i.id === pageId ? { ...i, ...patch(i) } : i))
      await store.saveRacksSite(rec.siteId, { ...rec, items })
    }
  }

  // Un diagnostic vient d'être enregistré côté serveur (il a aussi fait passer l'état en « Diag tech »).
  async function applyDiagnosis(pageId, result) {
    if (!result || result.duplicate) return
    await patchItem(pageId, () => ({ diag: result.diag, history: result.history || [], ...(result.state ? { state: result.state } : {}) }))
  }

  // Le support vient de changer l'état d'un élément.
  async function applyState(pageId, result) {
    if (!result || result.duplicate) return
    await patchItem(pageId, () => ({ state: result.state }))
  }

  // Recherche : serveur si possible, sinon copies locales (limitées aux sites déjà ouverts sur l'appareil).
  // → { items, truncated, stateOptions, diagState, koStates, states, offline }
  async function search(criteria) {
    const local = async () => {
      const recs = await store.listRacksSites()
      const ref = recs.find((r) => r.stateOptions && r.stateOptions.length) || recs[0] || {}
      return { items: searchLocal(recs, criteria), truncated: false, stateOptions: ref.stateOptions || [], diagState: ref.diagState || '', koStates: ref.koStates || [], states: ref.states || [], offline: true, sitesOnDevice: recs.length }
    }
    if (!isOnline()) return local()
    try {
      return { ...(await api.racksSearch(criteria)), offline: false }
    } catch (e) {
      if (isNetwork(e)) return local()
      throw e
    }
  }

  return { loadOverview, loadSite, applyDiagnosis, applyState, search }
}
