// Éditeur de template (profil support) : logique PURE, sans interface ni réseau. Contrat avec le serveur : gas/Templates.gs.
// Un élément = un bloc de la page Notion : section, texte, case à cocher native, champ, séparateur, bloc HTML, ou bloc verrouillé.

export const MAX_ITEMS = 300
export const CHOICE_TYPES = ['radio_group', 'select', 'checkbox_group']
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const RESERVED_RE = /^(u_|todo_|S:)/

// Champs à remplir par le technicien.
export const FIELD_KINDS = [
  { type: 'text', label: 'Texte court', icon: 'input', help: 'Une ligne : numéro de série, nom…' },
  { type: 'textarea', label: 'Texte long', icon: 'textarea', help: 'Plusieurs lignes : observations' },
  { type: 'number', label: 'Nombre', icon: 'number', help: 'Mesure, quantité (unité possible)' },
  { type: 'checkbox', label: 'Case à cocher', icon: 'check', help: 'Oui / non' },
  { type: 'radio_group', label: 'Choix unique', icon: 'radio', help: 'Une réponse parmi quelques-unes' },
  { type: 'select', label: 'Liste déroulante', icon: 'select', help: 'Une réponse parmi beaucoup' },
  { type: 'checkbox_group', label: 'Choix multiples', icon: 'multi', help: 'Plusieurs réponses possibles' },
  { type: 'date', label: 'Date', icon: 'calendar', help: 'Un jour' },
  { type: 'image_upload', label: 'Photos', icon: 'camera', help: 'Photos à prendre' }
]
// Éléments de mise en page.
export const LAYOUT_KINDS = [
  { id: 'section', label: 'Section', icon: 'heading', help: 'Un titre qui découpe le formulaire' },
  { id: 'note', label: 'Consigne', icon: 'text', help: 'Un texte, une liste, une citation' },
  { id: 'divider', label: 'Séparateur', icon: 'divider', help: 'Un trait horizontal' },
  { id: 'html', label: 'Bloc HTML', icon: 'code', help: 'Mise en page libre (avancé)' }
]
export const TEXT_STYLES = [
  { id: 'paragraph', label: 'Paragraphe' }, { id: 'bulleted_list', label: 'Puce' }, { id: 'numbered_list', label: 'Numéro' },
  { id: 'quote', label: 'Citation' }, { id: 'callout', label: 'Encadré' }
]

let counter = 0
export const newKey = () => 'k' + Date.now().toString(36) + (counter++).toString(36)

export function iconOf(item) {
  if (item.t === 'field') return (FIELD_KINDS.find((k) => k.type === item.type) || {}).icon || 'input'
  return { section: 'heading', text: 'text', todo: 'check', divider: 'divider', html: 'code', locked: 'lock' }[item.t] || 'text'
}
export function kindLabel(item) {
  if (item.t === 'field') return (FIELD_KINDS.find((k) => k.type === item.type) || {}).label || 'Champ'
  return { section: 'Section', text: 'Consigne', todo: 'Case à cocher', divider: 'Séparateur', html: 'Bloc HTML', locked: item.label || 'Bloc Notion' }[item.t] || 'Élément'
}

// Identifiant lisible tiré du libellé : « Étanchéité du joint » → « etancheite_du_joint ». Jamais déjà pris, jamais réservé.
export function slugId(label, taken = new Set()) {
  let base = String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  if (!base) base = 'champ'
  if (RESERVED_RE.test(base + '_')) base = 'c_' + base
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
}

export const takenIds = (items, except = null) => new Set(items.filter((i) => i.t === 'field' && i !== except).map((i) => i.id))

// Nouvel élément vide. `kind` : id de mise en page, ou type de champ.
export function createItem(kind, items = []) {
  const key = newKey()
  if (kind === 'section') return { key, t: 'section', level: 2, text: '' }
  if (kind === 'note') return { key, t: 'text', style: 'paragraph', text: '' }
  if (kind === 'divider') return { key, t: 'divider' }
  if (kind === 'html') return { key, t: 'html', html: '' }
  const f = { key, t: 'field', type: kind, id: '', label: '', required: false, placeholder: '', unit: '', extra: {}, idAuto: true }
  if (CHOICE_TYPES.includes(kind)) f.options = ['', '']
  return f
}

// Libellé tapé → identifiant, tant que l'identifiant n'a pas été fixé à la main ni enregistré.
export function syncAutoId(items, item) {
  if (item.t === 'field' && !item.ref && item.idAuto) item.id = slugId(item.label, takenIds(items, item))
}

export function fromServer(list) {
  return (list || []).map((i) => ({ key: newKey(), placeholder: '', unit: '', ...i }))
}

// Éléments d'un autre template, sans lien avec ses blocs (copie) ; les blocs verrouillés (médias…) ne se copient pas.
export function forImport(list, existing = []) {
  const taken = takenIds(existing)
  const out = []
  for (const i of list || []) {
    if (i.t === 'locked') continue
    const { ref, fixed, rich, ...rest } = i
    const it = { key: newKey(), placeholder: '', unit: '', ...rest }
    if (it.t === 'field') {
      it.id = slugId(it.id, taken)
      taken.add(it.id)
      it.idAuto = false
    }
    out.push(it)
  }
  return out
}

export function moveItem(items, index, delta) {
  const j = index + delta
  if (index < 0 || j < 0 || j >= items.length) return items
  const out = items.slice()
  ;[out[index], out[j]] = [out[j], out[index]]
  return out
}

export function insertAfter(items, afterKey, item) {
  const i = items.findIndex((x) => x.key === afterKey)
  const out = items.slice()
  out.splice(i < 0 ? out.length : i + 1, 0, item)
  return out
}

export function duplicateItem(items, key) {
  const i = items.findIndex((x) => x.key === key)
  if (i < 0 || items[i].t === 'locked') return items
  const { ref, fixed, rich, ...rest } = items[i]
  const copy = { ...rest, key: newKey() }
  if (copy.options) copy.options = copy.options.slice()
  if (copy.t === 'field') {
    copy.id = slugId(copy.id, takenIds(items))
    copy.idAuto = false
  }
  const out = items.slice()
  out.splice(i + 1, 0, copy)
  return out
}

// Texte → options (une par ligne, sans doublon ni ligne vide).
export const optionsFromText = (text) => [...new Set(String(text || '').split('\n').map((s) => s.trim()).filter(Boolean))]

/* ───────────────────────────── Validation ───────────────────────────── */

// Mêmes règles que le serveur → { [key]: message } (un seul message par élément : le premier trouvé).
export function validateItems(items) {
  const errors = {}
  const seen = new Set()
  for (const it of items) {
    let msg = ''
    if (it.t === 'section' && !String(it.text || '').trim()) msg = 'Donnez un titre à la section.'
    else if (it.t === 'text' && !String(it.text || '').trim()) msg = 'Écrivez le texte de la consigne.'
    else if (it.t === 'todo' && !String(it.text || '').trim()) msg = 'Écrivez le texte de la case à cocher.'
    else if (it.t === 'html' && !String(it.html || '').trim()) msg = 'Le bloc HTML est vide.'
    else if (it.t === 'field') {
      if (!String(it.label || '').trim()) msg = 'Donnez un libellé au champ.'
      else if (!ID_RE.test(it.id || '')) msg = 'Identifiant invalide : lettres, chiffres, _ et - (64 au plus).'
      else if (RESERVED_RE.test(it.id)) msg = 'Cet identifiant est réservé : changez-le.'
      else if (seen.has(it.id)) msg = 'Cet identifiant est déjà utilisé par un autre champ.'
      else if (CHOICE_TYPES.includes(it.type)) {
        const n = optionsClean(it.options).length
        if (n < 2) msg = 'Indiquez au moins 2 choix.'
        else if (n > 20) msg = '20 choix au plus.'
      }
      if (it.t === 'field' && it.id) seen.add(it.id)
    }
    if (msg) errors[it.key] = msg
  }
  if (items.length > MAX_ITEMS) errors.__all = `Trop d’éléments (${MAX_ITEMS} au plus).`
  return errors
}

export const optionsClean = (opts) => [...new Set((opts || []).map((o) => String(o).trim()).filter(Boolean))]

/* ───────────────────────────── Envoi ───────────────────────────── */

export function toPayload(items) {
  return items.map((i) => {
    const out = { t: i.t }
    if (i.ref) out.ref = i.ref
    if (i.t === 'section') Object.assign(out, { level: i.level, text: i.text })
    else if (i.t === 'text') Object.assign(out, { style: i.style, text: i.text })
    else if (i.t === 'todo') out.text = i.text
    else if (i.t === 'html') out.html = i.html
    else if (i.t === 'field') {
      Object.assign(out, { type: i.type, id: i.id, label: i.label, required: !!i.required, placeholder: i.placeholder || '', unit: i.unit || '' })
      if (CHOICE_TYPES.includes(i.type)) out.options = optionsClean(i.options)
      out.extra = i.extra || {}
    } else if (i.t === 'locked') out.label = i.label
    return out
  })
}

export const signature = (items) => JSON.stringify(toPayload(items))

// Ce que l'enregistrement va retirer de Notion : blocs existants qui ne sont plus dans la liste.
export function removedCount(original, items) {
  const kept = new Set(items.filter((i) => i.ref).map((i) => i.ref))
  return original.filter((i) => i.ref && !kept.has(i.ref)).length
}
