// Fiches méthodes : mise en forme, recherche, et service « réseau d'abord si utile, local sinon ».
// Aucune dépendance à Vue ni à l'interface : testable seul (voir tests/methods.test.mjs).

export const OTHER_GROUP = 'Autres'
const MAX_PREFETCH_IMAGES = 60

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Texte brut → segments, avec les adresses http(s) rendues cliquables.
export function linkifySegments(text) {
  const out = []
  let last = 0
  const re = /https?:\/\/[^\s<>"']+/g
  let m
  const src = String(text || '')
  while ((m = re.exec(src))) {
    const url = m[0].replace(/[).,;:!?]+$/, '')
    if (m.index > last) out.push({ t: src.slice(last, m.index) })
    out.push({ t: url, h: url })
    last = m.index + url.length
    re.lastIndex = last
  }
  if (last < src.length) out.push({ t: src.slice(last) })
  return out
}

export const segmentsText = (rt) => (rt || []).map((s) => s.t).join('')

/* ───────────────────────────── Liste / recherche ───────────────────────────── */

// Fiches filtrées par la recherche (titre, ensemble, résumé), puis regroupées par ensemble.
// Une fiche de plusieurs ensembles apparaît dans chacun. « Autres » (sans ensemble) passe en dernier.
export function groupMethods(items, query = '') {
  const q = fold(query).trim().split(/\s+/).filter(Boolean)
  const match = (it) => {
    if (!q.length) return true
    const hay = fold([it.title, it.summary, ...(it.groups || [])].join(' '))
    return q.every((w) => hay.includes(w))
  }
  const map = new Map()
  for (const it of items) {
    if (!match(it)) continue
    const gs = it.groups && it.groups.length ? it.groups : [OTHER_GROUP]
    for (const g of gs) {
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(it)
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === OTHER_GROUP) - (b === OTHER_GROUP) || a.localeCompare(b, 'fr'))
    .map(([group, list]) => ({ group, items: list.sort((x, y) => x.title.localeCompare(y.title, 'fr')) }))
}

export function statusTone(status) {
  const s = fold(status)
  if (s.startsWith('termin')) return 'done'
  if (s.includes('mettre a jour')) return 'danger'
  return 'info'
}

/* ─────────────────────────── Corps d'une fiche ─────────────────────────── */

// Regroupe les éléments de liste consécutifs : [{type:'ol'|'ul', items:[nœud…]}, …] ; les autres nœuds passent tels quels.
export function groupNodes(nodes) {
  const out = []
  for (const n of nodes || []) {
    if (n.k === 'li') {
      const type = n.n ? 'ol' : 'ul'
      const last = out[out.length - 1]
      if (last && last.k === 'list' && last.type === type) last.items.push(n)
      else out.push({ k: 'list', type, items: [n] })
    } else out.push(n)
  }
  return out
}

// Adresse d'une vidéo hébergée → lecteur intégrable, ou null (le lien s'ouvre alors dans un nouvel onglet).
export function embedUrl(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    let id = ''
    if (host === 'youtu.be') id = u.pathname.slice(1)
    else if (host === 'youtube.com' || host === 'm.youtube.com') {
      id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/) || [])[1] || ''
    }
    if (/^[\w-]{6,}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`
    if (host === 'vimeo.com') {
      const m = u.pathname.match(/^\/(\d+)/)
      if (m) return `https://player.vimeo.com/video/${m[1]}`
    }
    if (host === 'loom.com') {
      const m = u.pathname.match(/^\/(?:share|embed)\/([\w-]+)/)
      if (m) return `https://www.loom.com/embed/${m[1]}`
    }
  } catch { /* adresse illisible : pas d'intégration */ }
  return null
}

// Toutes les clés de médias « image » d'une fiche (pour le téléchargement hors ligne).
export function imageKeys(method) {
  const keys = []
  for (const m of method.media || []) if (m.kind === 'image' && !keys.includes(m.key)) keys.push(m.key)
  return keys
}

export function base64ToBlob(b64, mime) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

/* ───────────────────────────────── Service ───────────────────────────────── */

// store : { getMethodsList, saveMethodsList, touchMethodsList, getMethod, saveMethod, touchMethod,
//           getMethodMedia, saveMethodMedia, listMethodMediaKeys }   api : { methods, method, methodMedia }
export function createMethodsService({ store, api, isOnline = () => true }) {
  const isNetwork = (e) => e && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'BAD_RESPONSE')

  // Liste : la copie locale sert tout de suite ; le réseau la rafraîchit s'il y a mieux.
  // → { items, fetchedAt, fromCache, error }   (error : pourquoi la copie n'a pas été rafraîchie)
  async function loadList() {
    const cached = await store.getMethodsList()
    if (!isOnline()) return { items: cached ? cached.items : [], fetchedAt: cached && cached.fetchedAt, fromCache: true, error: cached ? null : 'OFFLINE_EMPTY' }
    try {
      const res = await api.methods({ sinceRev: cached && cached.rev })
      if (res.unchanged && cached) {
        await store.touchMethodsList()
        return { items: cached.items, fetchedAt: Date.now(), fromCache: false, error: null }
      }
      await store.saveMethodsList(res)
      return { items: res.items, fetchedAt: Date.now(), fromCache: false, error: null }
    } catch (e) {
      if (cached && (isNetwork(e) || e.code === 'NOTION_FORBIDDEN')) return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: true, error: e.code }
      throw e
    }
  }

  // Fiche : copie locale d'abord ; en ligne, on vérifie la date de modification (sans relire le corps si rien n'a changé).
  // → { method, fromCache, error }
  async function loadMethod(id) {
    const cached = await store.getMethod(id)
    if (!isOnline()) {
      if (!cached) return { method: null, fromCache: true, error: 'OFFLINE_EMPTY' }
      return { method: cached, fromCache: true, error: null }
    }
    try {
      const res = await api.method({ id, sinceEdited: cached && cached.updated })
      if (res.unchanged && cached) {
        await store.touchMethod(id)
        return { method: cached, fromCache: false, error: null }
      }
      await store.saveMethod(res)
      return { method: res, fromCache: false, error: null }
    } catch (e) {
      if (cached && isNetwork(e)) return { method: cached, fromCache: true, error: e.code }
      throw e
    }
  }

  // Média : le fichier gardé sur l'appareil d'abord ; sinon téléchargé (via le serveur : les liens Notion expirent).
  // → { blob, name } | { url, name, tooLarge:true } | { error }
  async function getMedia(pageId, key) {
    const hit = await store.getMethodMedia(pageId, key)
    if (hit) return { blob: hit.blob, name: hit.name, mime: hit.mime }
    if (!isOnline()) return { error: 'OFFLINE' }
    try {
      const res = await api.methodMedia({ page: pageId, key })
      if (res.tooLarge) return { tooLarge: true, url: res.url, name: res.name, size: res.size }
      const blob = base64ToBlob(res.data, res.mime)
      await store.saveMethodMedia(pageId, key, { blob, mime: res.mime, name: res.name })
      return { blob, name: res.name, mime: res.mime }
    } catch (e) {
      return { error: e.code || 'ERROR', message: e.message }
    }
  }

  // Lien frais vers un fichier trop gros pour être gardé (vidéo, gros PDF) : en ligne seulement.
  async function getFreshUrl(pageId, key) {
    if (!isOnline()) return { error: 'OFFLINE' }
    try {
      const res = await api.methodMedia({ page: pageId, key, mode: 'url' })
      return { url: res.url, name: res.name }
    } catch (e) {
      return { error: e.code || 'ERROR', message: e.message }
    }
  }

  // Garde les images (et le support PDF léger) d'une fiche sur l'appareil. → { done, failed, skipped }
  async function prefetch(method, { onProgress, includeSupport = true } = {}) {
    const keys = imageKeys(method).slice(0, MAX_PREFETCH_IMAGES)
    if (includeSupport) for (const s of method.support || []) keys.push(s.key)
    const have = await store.listMethodMediaKeys(method.id)
    const todo = keys.filter((k) => !have.has(k))
    const result = { done: 0, failed: 0, tooLarge: 0, skipped: keys.length - todo.length }
    for (const k of todo) {
      if (!isOnline()) { result.failed += todo.length - result.done - result.failed - result.tooLarge; break }
      const r = await getMedia(method.id, k)
      if (r.blob) result.done++
      else if (r.tooLarge) result.tooLarge++
      else result.failed++
      if (onProgress) onProgress({ ...result, total: todo.length })
    }
    return result
  }

  // Télécharge toutes les fiches publiées (corps + images) pour travailler sans réseau.
  async function prefetchAll(items, { onProgress, signal } = {}) {
    const total = items.length
    let n = 0
    const out = { methods: 0, failed: 0, images: 0, tooLarge: 0 }
    for (const it of items) {
      if (signal && signal.aborted) break
      if (!isOnline()) break
      try {
        const { method } = await loadMethod(it.id)
        if (method) {
          const r = await prefetch(method)
          out.methods++; out.images += r.done; out.tooLarge += r.tooLarge; out.failed += r.failed
        }
      } catch {
        out.failed++
      }
      n++
      if (onProgress) onProgress({ n, total })
    }
    return out
  }

  return { loadList, loadMethod, getMedia, getFreshUrl, prefetch, prefetchAll }
}
