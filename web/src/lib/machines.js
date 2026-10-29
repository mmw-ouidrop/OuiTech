// Liste des machines : recherche, regroupement, liens d'itinéraire. Aucune dépendance à Vue.
import { OTHER_GROUP } from './methods.js'

export const NO_REGION = 'Sans région'

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Machines filtrées (recherche : nom, ville, adresse, projet, région), puis regroupées par région.
// `showInactive` : inclut les machines hors exploitation (masquées par défaut ; `active === null` = inconnu → affichée).
export function groupMachines(items, query = '', { showInactive = false } = {}) {
  const q = fold(query).trim().split(/\s+/).filter(Boolean)
  const map = new Map()
  for (const it of items) {
    if (!showInactive && it.active === false) continue
    if (q.length) {
      const hay = fold([it.title, it.city, it.address, it.project, it.region, it.status].join(' '))
      if (!q.every((w) => hay.includes(w))) continue
    }
    const g = it.region || NO_REGION
    if (!map.has(g)) map.set(g, [])
    map.get(g).push(it)
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === NO_REGION) - (b === NO_REGION) || a.localeCompare(b, 'fr'))
    .map(([group, list]) => ({ group, items: list.sort((x, y) => x.title.localeCompare(y.title, 'fr')) }))
}

export const inactiveCount = (items) => items.filter((i) => i.active === false).length

// Pastille d'état de la machine : tout ce qui n'est pas « normal » attire l'œil.
export function machineTone(status) {
  const s = fold(status)
  if (!s) return 'info'
  if (/(bloqu|panne|arret|hs|ko|hors)/.test(s)) return 'danger'
  if (/(ok|marche|fonction|operation|exploit)/.test(s)) return 'done'
  return 'info'
}

// Itinéraires : l'adresse « carte » (normalisée) est préférée à l'adresse saisie.
export function mapLinks(machine) {
  const q = (machine.mapAddress || machine.address || '').trim()
  if (!q) return null
  const e = encodeURIComponent(q)
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${e}`,
    waze: `https://waze.com/ul?q=${e}&navigate=yes`,
    apple: `https://maps.apple.com/?q=${e}`
  }
}

// « 21 novembre 2022 » ou date ISO : affichée telle quelle si illisible.
export function formatSince(s) {
  if (!s) return ''
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)))
}

export { OTHER_GROUP }
