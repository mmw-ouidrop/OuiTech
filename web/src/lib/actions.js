// Actions à réaliser : états proposés au technicien et lecture du journal local.
export const ACTION_STATES = [
  { value: 'todo', label: 'À faire' },
  { value: 'doing', label: 'En cours' },
  { value: 'done', label: 'Terminée' },
  { value: 'blocked', label: 'Impossible' }
]
export const stateLabel = (v) => (ACTION_STATES.find((s) => s.value === v) || {}).label || ''

// État courant d'une action = dernier état choisi par le technicien (sur cet appareil), '' si aucun.
export function currentState(log = []) {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].state) return log[i].state
  return ''
}

// Progression : { done, total } — « Terminée » ou « Impossible » comptent comme traitées.
export function progress(actions = [], actionLog = {}) {
  const treated = actions.filter((a) => ['done', 'blocked'].includes(currentState(actionLog[a.id]))).length
  return { done: treated, total: actions.length }
}
