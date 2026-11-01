// ============================================================================
//  Structure affichable du formulaire (PURE : aucune E/S, testable seule)
//   · sections H1/H2 repliables, H3 = simple intertitre ;
//   · compteur « remplis / total » par section ;
//   · « masquer les champs remplis » ;
//   · champs obligatoires manquants (bloquent « Valider le CR »).
//  L'état replié / masqué est propre à l'appareil (voir loadViewPrefs).
// ============================================================================
import { isFilled, LIST_STYLES } from './shared.js'

const isField = (it) => it.k === 'field'

// Rang de repli : H1 et H2 se replient, H3 non.
export const isCollapsible = (it) => it.k === 'section' && it.level <= 2

/**
 * @param items    buildItems(rec)
 * @param ctx      { value(id), photos(id) → nombre, collapsed:{[sectionId]:true}, hideFilled, keep:Set<id> }
 *                 `keep` : champs à garder visibles même remplis (conflit en cours…)
 */
export function buildOutline(items, ctx) {
  const { value, photos, collapsed = {}, hideFilled = false, keep = new Set() } = ctx
  const filledOf = (it) => isFilled(it, value(it.id), photos ? photos(it.id) : 0)

  // 1. compteurs : une section couvre tout jusqu'à la prochaine section de rang ≤
  const stats = new Map()
  items.forEach((it, i) => {
    if (it.k !== 'section') return
    let total = 0, filled = 0
    for (let j = i + 1; j < items.length; j++) {
      const n = items[j]
      if (n.k === 'section' && n.level <= it.level) break
      if (isField(n)) { total++; if (filledOf(n)) filled++ }
    }
    stats.set(it.id, { total, filled })
  })

  // 2. lignes visibles
  const rows = []
  let hideUntilLevel = null            // on est dans une section repliée de ce rang
  for (const it of items) {
    if (it.k === 'section') {
      if (hideUntilLevel !== null && it.level > hideUntilLevel) continue
      hideUntilLevel = null
      const st = stats.get(it.id)
      const open = !(isCollapsible(it) && collapsed[it.id])
      rows.push({ k: 'section', id: it.id, level: it.level, text: it.text, collapsible: isCollapsible(it), open, ...st, done: st.total > 0 && st.filled === st.total })
      if (!open) hideUntilLevel = it.level
      continue
    }
    if (hideUntilLevel !== null) continue
    if (isField(it)) {
      const filled = filledOf(it)
      if (hideFilled && filled && !keep.has(it.id)) continue
      rows.push({ k: 'field', id: it.id, item: it, filled })
    } else if (!hideFilled) {
      rows.push({ k: it.k, id: it.id, item: it })
    }
  }

  const fields = items.filter(isField)
  const total = fields.length
  const filled = fields.filter(filledOf).length
  const missing = fields.filter((f) => f.required && !filledOf(f))
  return { rows, total, filled, missing }
}

// Lignes de liste à puces / numérotée consécutives → un seul bloc { k:'list', id, rows } (un <ul> dans l'écran).
export function groupLists(rows) {
  const out = []
  for (const r of rows) {
    if (r.k === 'text' && LIST_STYLES.includes(r.item.style)) {
      const last = out[out.length - 1]
      if (last && last.k === 'list') last.rows.push(r)
      else out.push({ k: 'list', id: 'LST:' + r.id, rows: [r] })
    } else out.push(r)
  }
  return out
}

// Menu « aller à… » : sections H1/H2 avec avancement.
export function jumpTargets(items, ctx) {
  const outline = buildOutline(items, { ...ctx, collapsed: {}, hideFilled: false })
  return outline.rows.filter((r) => r.k === 'section' && r.level <= 2).map((r) => ({ id: r.id, text: r.text, level: r.level, filled: r.filled, total: r.total }))
}

/* ───────────────────────── Réglages d'affichage (par appareil) ───────────────────────── */

const KEY = (missionId) => 'ouidrop.view.v1.' + missionId

export function loadViewPrefs(missionId, storage = globalThis.localStorage) {
  try {
    const p = JSON.parse(storage.getItem(KEY(missionId))) || {}
    return { hideFilled: p.hideFilled === true, collapsed: p.collapsed && typeof p.collapsed === 'object' ? p.collapsed : {} }
  } catch {
    return { hideFilled: false, collapsed: {} }
  }
}

export function saveViewPrefs(missionId, prefs, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY(missionId), JSON.stringify({ hideFilled: !!prefs.hideFilled, collapsed: prefs.collapsed || {} }))
  } catch { /* stockage plein ou bloqué : le réglage vaut pour cette session */ }
}

// Replie / déplie toutes les sections H1/H2.
export function setAllCollapsed(items, collapse) {
  const out = {}
  if (collapse) for (const it of items) if (isCollapsible(it)) out[it.id] = true
  return out
}

// Sections H1/H2 qui contiennent un champ (pour les déplier avant d'y aller).
export function ancestorSections(items, fieldId) {
  const stack = []
  for (const it of items) {
    if (it.k === 'section') {
      while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop()
      stack.push(it)
    } else if (it.k === 'field' && it.id === fieldId) {
      return stack.filter(isCollapsible).map((s) => s.id)
    }
  }
  return []
}
