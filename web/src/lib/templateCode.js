// Mode « code » de l'éditeur de templates : le même template écrit en texte (Markdown + blocs ```json), comme dans
// docs/templates/*.md. Les éléments restent la référence ; ce module ne fait que les écrire en texte (toCode) et les relire (fromCode).
//
//   # Titre / ## Titre / ### Titre        section              - [ ] texte      case à cocher Notion
//   Texte seul                            paragraphe           - texte          puce          1. texte   numéro
//   > texte                               citation             > [!callout] texte   encadré
//   ---                                   séparateur           ```html … ```    bloc HTML
//   ```json { "type": "text", … } ```     champ (ou liste de champs)
//   <!-- 🔒 Image : photo.png | ref=… --> bloc verrouillé (image, vidéo, tableau…) : à laisser tel quel
//   Ligne en retrait de 2 espaces         suite du texte précédent ; « \ » en début de ligne : texte littéral
import { FIELD_KINDS, CHOICE_TYPES, newKey, optionsClean, toPayload } from './templateEditor.js'

const FIELD_TYPES = FIELD_KINDS.map((k) => k.type)
const KNOWN = ['type', 'id', 'label', 'options', 'required', 'placeholder', 'unit']
const SPECIAL = /^(#{1,6} |[-*] |\d+[.)] |>|---|\*\*\*|___|```|<!--|\\|\s)/

const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').replace(/-->/g, '→')
const body = (text) => String(text || '').replace(/\r/g, '').split('\n').join('\n  ')   // suites en retrait
const esc = (text) => (SPECIAL.test(text) ? '\\' + text : text)

function fence(content, lang) {
  let f = '```'
  while (content.includes(f)) f += '`'
  return `${f}${lang}\n${content}\n${f}`
}

export function fieldObject(i) {
  const o = { type: i.type, id: i.id, label: i.label }
  if (CHOICE_TYPES.includes(i.type)) o.options = optionsClean(i.options)
  if (i.required) o.required = true
  if (i.placeholder) o.placeholder = i.placeholder
  if (i.unit) o.unit = i.unit
  for (const k of Object.keys(i.extra || {})) if (!KNOWN.includes(k)) o[k] = i.extra[k]
  return o
}

export function toCode(items) {
  return items.map((i) => {
    switch (i.t) {
      case 'section': return '#'.repeat(i.level || 2) + ' ' + body(i.text)
      case 'todo': return '- [ ] ' + body(i.text)
      case 'divider': return '---'
      case 'html': return fence(i.html || '', 'html')
      case 'field': return fence(JSON.stringify(fieldObject(i), null, 2), 'json')
      case 'locked': return `<!-- 🔒 ${oneLine(i.label)}${i.preview ? ' : ' + oneLine(i.preview) : ''} | ref=${i.ref} -->`
      default: {
        const t = body(i.text)
        if (i.style === 'bulleted_list') return '- ' + t
        if (i.style === 'numbered_list') return '1. ' + t
        if (i.style === 'quote') return '> ' + t
        if (i.style === 'callout') return '> [!callout] ' + t
        return esc(t)
      }
    }
  }).join('\n\n') + (items.length ? '\n' : '')
}

/* ───────────────────────────── Relecture ───────────────────────────── */

function fieldFrom(o, at, errors) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) { errors.push({ line: at, message: 'Un champ est un objet { "type": …, "id": …, "label": … }.' }); return null }
  if (!FIELD_TYPES.includes(o.type)) { errors.push({ line: at, message: `Type de champ inconnu : « ${o.type === undefined ? 'absent' : o.type} ». Types possibles : ${FIELD_TYPES.join(', ')}.` }); return null }
  if (typeof o.id !== 'string' || !o.id) { errors.push({ line: at, message: 'Il manque l’identifiant « id » du champ.' }); return null }
  const extra = {}
  for (const k of Object.keys(o)) if (!KNOWN.includes(k)) extra[k] = o[k]
  const f = {
    t: 'field', type: o.type, id: o.id, label: o.label === undefined || o.label === null ? '' : String(o.label),
    required: o.required === true, placeholder: typeof o.placeholder === 'string' ? o.placeholder : '', unit: typeof o.unit === 'string' ? o.unit : '', extra, idAuto: false
  }
  if (CHOICE_TYPES.includes(o.type)) f.options = Array.isArray(o.options) ? o.options.map(String) : []
  return f
}

// Texte → { items (sans ref), lines (1ʳᵉ ligne de chaque élément), errors:[{line,message}] }
export function parseCode(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n')
  const items = []
  const lines = []
  const errors = []
  const add = (it, line) => { items.push(it); lines.push(line) }
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n]
    const at = n + 1
    let m
    if (!row.trim()) continue
    const prev = items[items.length - 1]
    if ((m = row.match(/^ {2,}(\S.*)$/)) && prev && (prev.t === 'text' || prev.t === 'todo' || prev.t === 'section')) {
      prev.text += '\n' + m[1]
      continue
    }
    if ((m = row.match(/^(`{3,})\s*([A-Za-z0-9_-]*)\s*$/))) {
      const closing = m[1]
      const lang = m[2].toLowerCase()
      const inner = []
      let k = n + 1
      while (k < rows.length && rows[k].trim() !== closing) inner.push(rows[k++])
      if (k >= rows.length) { errors.push({ line: at, message: `Bloc de code non fermé : il manque ${closing} à la fin.` }); break }
      n = k
      const content = inner.join('\n')
      if (lang === 'html') add({ t: 'html', html: content }, at)
      else if (lang === 'json') {
        let data
        try { data = JSON.parse(content) } catch (e) { errors.push({ line: at + 1, message: 'JSON invalide : ' + String(e.message).replace(/^JSON\.parse: /, '') }); continue }
        const list = Array.isArray(data) ? data : [data]
        if (!list.length) errors.push({ line: at, message: 'Liste de champs vide.' })
        for (const o of list) { const f = fieldFrom(o, at, errors); if (f) add(f, at) }
      } else errors.push({ line: at, message: `Bloc « ${lang || 'sans langage'} » non pris en charge : utilisez json (champs) ou html.` })
    } else if (/^(---+|\*\*\*+|___+)\s*$/.test(row)) add({ t: 'divider' }, at)
    else if ((m = row.match(/^(#{1,6}) +(.*)$/))) {
      if (m[1].length > 3) errors.push({ line: at, message: 'Les titres vont de # à ### (3 niveaux).' })
      else add({ t: 'section', level: m[1].length, text: m[2] }, at)
    } else if ((m = row.match(/^<!--\s*🔒.*\|\s*ref=([A-Za-z0-9-]+)\s*-->\s*$/))) add({ t: 'locked', ref: m[1].replace(/-/g, '') }, at)
    else if (/^<!--/.test(row)) continue
    else if ((m = row.match(/^[-*] \[[ xX]?\] ?(.*)$/))) add({ t: 'todo', text: m[1] }, at)
    else if ((m = row.match(/^[-*] (.*)$/))) add({ t: 'text', style: 'bulleted_list', text: m[1] }, at)
    else if ((m = row.match(/^\d+[.)] (.*)$/))) add({ t: 'text', style: 'numbered_list', text: m[1] }, at)
    else if ((m = row.match(/^> ?\[!callout\] ?(.*)$/i))) add({ t: 'text', style: 'callout', text: m[1] }, at)
    else if ((m = row.match(/^> ?(.*)$/))) add({ t: 'text', style: 'quote', text: m[1] }, at)
    else if ((m = row.match(/^\\(.*)$/))) add({ t: 'text', style: 'paragraph', text: m[1] }, at)
    else add({ t: 'text', style: 'paragraph', text: row }, at)
  }
  return { items, lines, errors }
}

/* ───────────────────────────── Retrouver les blocs Notion ───────────────────────────── */

// Chaque élément relu retrouve, si possible, le bloc Notion d'où il vient (pour modifier en place au lieu de recréer) :
// 1. contenu identique ; 2. même identifiant de champ ; 3. même sorte, dans l'ordre.
const sig = (i) => JSON.stringify(toPayload([{ ...i, ref: undefined }])[0])

export function attachRefs(parsed, known) {
  const pool = known.filter((k) => k.ref)
  const used = new Set()
  const match = new Array(parsed.length).fill(null)
  const take = (k) => { used.add(k); return k }
  parsed.forEach((p, n) => {
    if (p.t === 'locked') match[n] = pool.find((k) => k.t === 'locked' && k.ref === p.ref && !used.has(k)) ? take(pool.find((k) => k.t === 'locked' && k.ref === p.ref)) : null
  })
  parsed.forEach((p, n) => {
    if (match[n] || p.t === 'locked') return
    const s = sig(p)
    const k = pool.find((c) => !used.has(c) && c.t === p.t && sig(c) === s)
    if (k) match[n] = take(k)
  })
  parsed.forEach((p, n) => {
    if (match[n] || p.t !== 'field') return
    const k = pool.find((c) => !used.has(c) && c.t === 'field' && c.id === p.id)
    if (k) match[n] = take(k)
  })
  let last = -1
  parsed.forEach((p, n) => {
    if (match[n]) { last = Math.max(last, pool.indexOf(match[n])); return }
    if (p.t === 'locked') return
    const k = pool.find((c, idx) => idx > last && !used.has(c) && c.t === p.t && (p.t !== 'text' || c.style === p.style) && (p.t !== 'section' || c.level === p.level))
    if (k) { match[n] = take(k); last = pool.indexOf(k) }
  })
  const out = []
  const from = []
  const errors = []
  parsed.forEach((p, n) => {
    const k = match[n]
    if (p.t === 'locked') {
      if (!k) errors.push({ n, message: 'Ce bloc verrouillé n’existe pas dans cette page : retirez la ligne.' })
      else { out.push({ ...k }); from.push(n) }
      return
    }
    const it = { key: newKey(), ...p }
    if (k) {
      it.ref = k.ref
      if (k.fixed) it.fixed = true
      if (k.rich && k.text === p.text && k.style === p.style) it.rich = true
      it.key = k.key || it.key
    }
    out.push(it)
    from.push(n)
  })
  return { items: out, from, lockedErrors: errors }
}

// Texte → { items, lines, errors:[{line,message}] } : items prêts pour l'éditeur (avec ref quand le bloc existe déjà).
export function fromCode(text, known = []) {
  const { items, lines, errors } = parseCode(text)
  const { items: out, from, lockedErrors } = attachRefs(items, known)
  lockedErrors.forEach((e) => errors.push({ line: lines[e.n], message: e.message }))
  return { items: out, lines: from.map((n) => lines[n]), errors: errors.sort((a, b) => a.line - b.line) }
}
