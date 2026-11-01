// Affichage des propriétés Notion lues en lecture seule (sans nom de colonne en dur).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function formatDateString(s) {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const withTime = s.includes('T')
  return new Intl.DateTimeFormat('fr-FR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(d)
}

// Propriété sans valeur (texte vide, liste vide, aucun fichier) : rangée dans « Champs vides ». Un « Non » ou un 0 est une valeur.
export function isEmptyProperty(prop) {
  if (Array.isArray(prop.files)) return prop.files.length === 0
  const v = prop.value
  if (v === null || v === undefined) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'string') return v.trim() === ''
  return false
}

export function formatPropertyValue(prop) {
  const v = prop.value
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'number') return new Intl.NumberFormat('fr-FR').format(v)
  const s = String(v)
  if (['date', 'created_time', 'last_edited_time'].includes(prop.type) || (prop.type === 'formula' && ISO_DATE.test(s))) {
    // Intervalle « début → fin »
    return s.split(' → ').map(formatDateString).join(' → ')
  }
  return s
}

// Valeur d'un champ du formulaire, lisible (conflits, récapitulatifs).
export function formatFieldValue(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  return String(v)
}

export function formatTime(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

export function formatDateTime(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts))
}

// Libellé et ton de la pastille d'état d'une mission (modèle v2, voir db.js / lib/shared.js).
//   « à envoyer » = saisies locales pas encore dans Notion ; « envoi en échec » = dernière tentative refusée.
export function missionStatus(rec) {
  const validated = (rec.pendingStatus ? rec.pendingStatus.value : rec.shared && rec.shared.status) === 'validated'
  const pending = rec.needsSync === 1
  if (rec.syncing) return { label: 'Envoi en cours…', tone: 'info' }
  if (pending && rec.lastError && (rec.attempts || 0) > 0) {
    return { label: validated ? 'Validé · envoi en échec' : 'Envoi en échec', tone: 'danger' }
  }
  if (validated) return pending ? { label: 'Validé · à envoyer', tone: 'info' } : { label: '✓ Validé', tone: 'done' }
  if (pending) return { label: rec.lastSyncAt ? 'Modifié · à envoyer' : 'Brouillon · à envoyer', tone: 'info' }
  if (rec.lastSyncAt || (rec.baseRev || 0) > 0) return { label: 'Enregistré', tone: 'neutral' }
  return { label: 'Brouillon', tone: 'neutral' }
}

// Nom d'une personne, quelle que soit la forme reçue : texte, { firstName, lastName } ou { name }. Jamais « [object Object] ».
export function personName(v) {
  if (typeof v === 'string') return v === '[object Object]' ? '' : v.trim()
  if (v && typeof v === 'object') {
    const full = [v.firstName, v.lastName].filter((x) => typeof x === 'string' && x.trim()).join(' ')
    return full || (typeof v.name === 'string' ? v.name.trim() : '')
  }
  return ''
}
