// Actions à réaliser : états proposés au technicien et lecture du journal local.
export const ACTION_STATES = [
  { value: 'todo', label: 'À faire' },
  { value: 'doing', label: 'En cours' },
  { value: 'done', label: 'Terminée' },
  { value: 'blocked', label: 'Impossible' }
]
export const stateLabel = (v) => (ACTION_STATES.find((s) => s.value === v) || {}).label || ''

// État courant d'une action = dernier état choisi (par n'importe quel technicien), '' si aucun.
export function currentState(entries = []) {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].state) return entries[i].state
  return ''
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const same = (a, b) => norm(a.by) === norm(b.by) && (a.state || '') === (b.state || '') && norm(a.text) === norm(b.text)

// Historique d'une action = commentaires lus dans Notion (tous les techniciens) + envois de cet appareil que Notion ne montre
// pas encore (en attente, échec, ou envoyés depuis la dernière lecture). Un envoi local déjà visible côté Notion n'est pas doublé.
// → du plus ancien au plus récent ; `local` marque ceux qui ne sont pas (encore) dans Notion.
export function mergeEntries(server = [], local = []) {
  const used = new Set()
  const pending = []
  for (const e of local) {
    const hit = server.findIndex((s, i) => !used.has(i) && same(s, e))
    if (hit >= 0) used.add(hit)
    else pending.push({ ...e, local: true })
  }
  return [...server.map((s) => ({ ...s, local: false })), ...pending].sort((a, b) => (a.at || 0) - (b.at || 0))
}

// Progression : { done, total } — « Terminée » ou « Impossible » comptent comme traitées.
export function progress(actions = [], actionLog = {}) {
  const treated = actions.filter((a) => ['done', 'blocked'].includes(currentState(mergeEntries(a.entries, actionLog[a.id])))).length
  return { done: treated, total: actions.length }
}
