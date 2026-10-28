/**
 * ============================================================================
 *  Report.gs — Rapport partagé : état, fusion champ par champ, écriture
 *  incrémentale dans Notion
 * ============================================================================
 *
 *  PRINCIPE
 *  Le rapport est UN bloc « callout » 📋 en fin de page Notion :
 *
 *    📋 Rapport d'intervention — En cours | Validé          ← titre
 *       Dernière modification : Prénom Nom · 20/10/2026 17:32  ← ligne grise
 *       ## Section                                           ┐ un bloc par
 *       ☑ Case à cocher                                      │ élément du
 *       **Champ** : valeur                                   │ template, mis à
 *       **Photos**                                           │ jour EN PLACE ;
 *          └ (images)                                        ┘ photos dessous
 *       ▸ Données de synchronisation (ne pas modifier)       ← toggle replié
 *            └ { JSON : état partagé }
 *
 *  Le JSON est la référence : pour chaque champ, valeur + auteur + heure. Le
 *  texte visible en est la vue. Modifier à la main un bloc du rapport dans
 *  Notion n'est pas relu par l'application et sera écrasé à la prochaine
 *  modification de ce champ.
 *
 *  FUSION (côté serveur, sous verrou)
 *   - champ par champ ; la saisie la plus récente gagne ;
 *   - l'heure d'une saisie = heure du téléphone corrigée de son décalage avec
 *     le serveur (mesuré à chaque requête : serverNow − clientNow) ;
 *   - égalité d'heure : le clientId le plus grand gagne (déterministe) ;
 *   - rejouer une même requête est sans effet (idempotent) ;
 *   - CR « Validé » : toute modification est refusée (rejected.*), sauf si la
 *     même requête le rouvre (changes.status = draft, plus récent) ;
 *   - photos : s'additionnent (identifiées par mediaId), jamais en conflit ;
 *   - champs ajoutés par les techniciens : s'additionnent, suppression douce.
 *
 *  REQUÊTE  POST { action:"syncReport", session,
 *    notionPageId, reference?,
 *    clientId,                       identifiant stable de l'appareil
 *    author: { firstName, lastName },
 *    clientNow,                      Date.now() du téléphone à l'envoi
 *    baseRev,                        dernière révision connue du client
 *    schema: [ … ],                  celui renvoyé par getIntervention
 *    changes: {
 *      fields:  { [id]: { v, at } }                 at = heure de saisie (ms)
 *      status:  { value:"validated"|"draft", at }
 *      custom:  { add:[{id,type,label,options?,at}], remove:[{id,at}] }
 *      photos:  { add:[{mediaId,componentId,driveFileId,at}],
 *                 remove:[{mediaId,at}] }
 *    } }
 *
 *  RÉPONSE  data = {
 *    report:        état public (voir publicState_) ou null,
 *    unchanged:     true si rien n'a été modifié côté serveur,
 *    serverNow,
 *    overridden:    [{ id, mine, theirs:{v,by,at} }]  mes saisies écrasées,
 *    rejected:      { fields:[id], custom:[id], photos:[mediaId], status:bool,
 *                     reason:"VALIDATED"|null }
 *    reset:         true si le rapport a dû être recréé (le client renvoie tout),
 *    photoErrors:   [{ mediaId, code, message }]  à renvoyer (ex. MEDIA_NOT_FOUND),
 *    photosRemaining: n   photos non traitées (limite par appel) : rappeler,
 *    applied:       { fields, custom, photos, … },
 *    warnings:      [...] }
 *
 *  LECTURE LÉGÈRE  GET ?action=getReport&pageId&sinceRev&clientId&name
 *    → { unchanged:true, rev, editors, serverNow } sans appel à Notion tant que
 *      la révision n'a pas bougé, sinon { report, editors, serverNow }.
 * ============================================================================
 */

const STATE_VERSION = 1;
const STATE_TOGGLE_TITLE = 'Données de synchronisation (ne pas modifier)';
const CUSTOM_SECTION_ID = 'S:custom';
const CUSTOM_SECTION_TITLE = 'Ajouts terrain';
const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'checkbox', 'radio_group', 'image_upload'];
const CHECKBOX_TYPES = ['checkbox', 'to_do'];
const MAX_PHOTOS_PER_CALL = 6;                 // un appel GAS dure au plus 6 min
const PRESENCE_TTL_MS = 10 * 60 * 1000;
const STATE_CACHE_MAX_CHARS = 90000;           // CacheService : 100 Ko par valeur ; JSON en ASCII = 1 octet/caractère
const STATE_MAX_CHARS = 190000;                // 100 rich_text × 2000 caractères
const MAX_SCHEMA_ITEMS = 300;
const MAX_CUSTOM_FIELDS = 50;
const MAX_LABEL = 200;

/* ═══════════════════════════════════════════════════════════════════════════
 *  Utilitaires
 * ═══════════════════════════════════════════════════════════════════════════ */

function normId_(id) {
  const s = String(id || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) throw new ApiError_('BAD_REQUEST', 'Identifiant de page Notion invalide');
  return s;
}

function clip_(v, n) {
  return String(v == null ? '' : v).slice(0, n);
}

function cleanName_(author) {
  const a = author || {};
  const full = typeof a === 'string' ? a : String(a.firstName || '') + ' ' + String(a.lastName || '');
  return full.replace(/\s+/g, ' ').trim().slice(0, 60);
}

function emptyState_() {
  return {
    v: STATE_VERSION, rev: 0,
    status: 'draft', statusBy: null, statusAt: 0, statusC: '',
    last: null,
    schema: [], fields: {}, custom: {}, photos: {},
    blocks: {}, meta: {}
  };
}

function listChildren_(blockId) {
  const out = [];
  let cursor = null;
  do {
    const q = '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
    const res = notion_('GET', '/blocks/' + blockId + '/children' + q);
    (res.results || []).forEach(function (b) { out.push(b); });
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

// Ajout simple (en fin de bloc) ; Notion renvoie les blocs créés, dans l'ordre.
function appendPlain_(parentId, blocks) {
  const res = notion_('PATCH', '/blocks/' + parentId + '/children', { children: blocks });
  // Les blocs créés sont les derniers de la liste renvoyée (ajout en fin de bloc).
  return (res.results || []).slice(-blocks.length);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Schéma du formulaire (template + champs ajoutés)
 * ═══════════════════════════════════════════════════════════════════════════ */

// Liste plate et ordonnée des éléments qui apparaissent dans le rapport,
// déduite du template lu dans Notion.
function buildSchema_(templateBlocks) {
  const out = [];
  (templateBlocks || []).forEach(function (b) {
    if (b.kind === 'section') {
      out.push({ k: 's', id: 'S:' + b.blockId, text: b.text, level: b.level === 1 ? 1 : 2 });
    } else if (b.kind === 'component' && b.id && b.type) {
      const f = { k: 'f', id: String(b.id), type: String(b.type), label: String(b.label || b.id) };
      if (Array.isArray(b.options)) f.options = b.options.map(String);
      out.push(f);
    }
  });
  return out;
}

function cleanOptions_(opts) {
  if (!Array.isArray(opts)) return undefined;
  return opts.slice(0, 20).map(function (o) { return clip_(o, 80); });
}

function cleanSchema_(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = {};
  arr.slice(0, MAX_SCHEMA_ITEMS).forEach(function (it) {
    if (!it || typeof it.id !== 'string' || it.id.length > 120 || seen[it.id]) return;
    if (it.k === 's') {
      out.push({ k: 's', id: it.id, text: clip_(it.text, MAX_LABEL), level: it.level === 1 ? 1 : 2 });
    } else if (it.k === 'f' && typeof it.type === 'string') {
      const f = { k: 'f', id: it.id, type: clip_(it.type, 40), label: clip_(it.label || it.id, MAX_LABEL) };
      const o = cleanOptions_(it.options);
      if (o) f.options = o;
      out.push(f);
    } else {
      return;
    }
    seen[it.id] = true;
  });
  return out;
}

// Union de l'ordre connu du serveur et du schéma envoyé par un client : un
// nouvel élément est inséré juste après son prédécesseur déjà connu. Un
// élément retiré du template par un responsable reste dans le rapport (il peut
// contenir des saisies).
function mergeSchema_(stateSchema, clientSchema) {
  const result = stateSchema.map(function (x) { return Object.assign({}, x); });
  const idx = function (id) {
    for (let i = 0; i < result.length; i++) if (result[i].id === id) return i;
    return -1;
  };
  const added = [];
  const relabeled = [];
  clientSchema.forEach(function (it, i) {
    const at = idx(it.id);
    if (at > -1) {
      const ex = result[at];
      const label = it.k === 's' ? it.text : it.label;
      const exLabel = ex.k === 's' ? ex.text : ex.label;
      if (ex.k === it.k && (label !== exLabel || ex.type !== it.type ||
          JSON.stringify(ex.options || null) !== JSON.stringify(it.options || null))) {
        result[at] = Object.assign({}, it);
        if (label !== exLabel) relabeled.push(it.id);
      }
      return;
    }
    let anchor = -1;
    for (let j = i - 1; j >= 0; j--) {
      const k = idx(clientSchema[j].id);
      if (k > -1) { anchor = k; break; }
    }
    result.splice(anchor + 1, 0, Object.assign({}, it));
    added.push(it.id);
  });
  return { schema: result, added: added, relabeled: relabeled };
}

function activeCustom_(state) {
  return Object.keys(state.custom)
    .filter(function (id) { return !state.custom[id].del; })
    .sort(function (a, b) { return state.custom[a].at - state.custom[b].at || (a < b ? -1 : 1); });
}

// Ce que le rapport affiche, dans l'ordre : template (union) puis champs ajoutés.
function renderList_(state) {
  const items = state.schema.slice();
  const ids = activeCustom_(state);
  if (ids.length) {
    items.push({ k: 's', id: CUSTOM_SECTION_ID, text: CUSTOM_SECTION_TITLE, level: 1 });
    ids.forEach(function (id) {
      const c = state.custom[id];
      const f = { k: 'f', id: id, type: c.type, label: c.label, custom: true };
      if (c.options) f.options = c.options;
      items.push(f);
    });
  }
  return items;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Validation des entrées
 * ═══════════════════════════════════════════════════════════════════════════ */

function cleanValue_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.slice(0, MAX_FIELD_CHARS);
  if (Array.isArray(v)) {
    if (v.length > 50) return undefined;
    return v.map(function (x) { return clip_(x, 500); });
  }
  return undefined;
}

function sameValue_(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cleanCustom_(it) {
  if (!it || !/^u_[A-Za-z0-9_-]{4,40}$/.test(String(it.id || ''))) return null;
  if (CUSTOM_FIELD_TYPES.indexOf(it.type) === -1) return null;
  const label = clip_(it.label, MAX_LABEL).trim();
  if (!label) return null;
  const out = { id: it.id, type: it.type, label: label };
  if (it.type === 'radio_group') {
    const o = cleanOptions_(it.options);
    if (!o || o.length < 2) return null;
    out.options = o;
  }
  return out;
}

function cleanPhotoAdds_(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 50).filter(function (p) {
    return p && /^[A-Za-z0-9_-]{8,64}$/.test(String(p.mediaId || '')) &&
      typeof p.componentId === 'string' && p.componentId.length <= 120 &&
      DRIVE_ID_RE.test(String(p.driveFileId || ''));
  });
}

// Heure de saisie corrigée du décalage d'horloge, jamais dans le futur.
function atCorr_(at, c) {
  const t = Number(at);
  if (!isFinite(t)) return c.serverNow;
  return Math.min(c.serverNow, Math.max(0, Math.round(t + c.offset)));
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Accès à Notion : cache, état, page autorisée
 * ═══════════════════════════════════════════════════════════════════════════ */

function cacheGetState_(pageId) {
  const s = CacheService.getScriptCache().get('st_' + pageId);
  if (!s) return null;
  try { return JSON.parse(s); } catch (err) { return null; }
}

function cachePutState_(pageId, state) {
  const c = CacheService.getScriptCache();
  c.put('rev_' + pageId, String(state.rev), SYNC_CACHE_SECONDS);
  const s = stateToJson_(state);
  if (s.length <= STATE_CACHE_MAX_CHARS) c.put('st_' + pageId, s, SYNC_CACHE_SECONDS);
  else c.remove('st_' + pageId);
}

function cacheClearState_(pageId) {
  CacheService.getScriptCache().removeAll(['st_' + pageId, 'rev_' + pageId]);
}

function cacheGetRev_(pageId) {
  const v = CacheService.getScriptCache().get('rev_' + pageId);
  return v === null ? null : Number(v);
}

// Seules les pages de la base Interventions sont modifiables (une session valide ne doit
// pas permettre d'écrire ailleurs dans l'espace de travail). Résultat mis en cache.
function assertPageInDatabase_(pageId) {
  const cache = CacheService.getScriptCache();
  if (cache.get('ok_' + pageId)) return;
  const page = notion_('GET', '/pages/' + pageId);
  const parent = page.parent || {};
  const dbId = String(parent.database_id || '').replace(/-/g, '');
  if (dbId !== cfg_('NOTION_DB_ID').replace(/-/g, '')) {
    throw new ApiError_('FORBIDDEN', "Cette page n'appartient pas à la base des interventions");
  }
  if (page.archived || page.in_trash) {
    throw new ApiError_('FORBIDDEN', 'Cette page est archivée');
  }
  cache.put('ok_' + pageId, '1', SYNC_CACHE_SECONDS);
}

// Lit l'état (cache d'abord, sinon Notion). null si aucun rapport n'existe.
// Lève STATE_MISSING / STATE_CORRUPT si le bloc de données a été abîmé.
function loadState_(pageId, opts) {
  opts = opts || {};
  const cached = opts.fresh ? null : cacheGetState_(pageId);
  if (cached) return cached;

  const calloutId = opts.calloutId || findReportBlocks_(pageId)[0];
  if (!calloutId) return null;

  const kids = listChildren_(calloutId);
  const toggle = kids.filter(function (b) {
    return b.type === 'toggle' && plain_(b.toggle.rich_text).indexOf(STATE_TOGGLE_TITLE) === 0;
  })[0];
  if (!toggle) throw new ApiError_('STATE_MISSING', 'Bloc « Données de synchronisation » introuvable dans le rapport');
  const code = listChildren_(toggle.id).filter(function (b) { return b.type === 'code'; })[0];
  if (!code) throw new ApiError_('STATE_MISSING', 'Données de synchronisation introuvables dans le rapport');

  let state;
  try {
    state = JSON.parse(plain_(code.code.rich_text));
  } catch (err) {
    throw new ApiError_('STATE_CORRUPT', 'Données de synchronisation illisibles');
  }
  if (!state || state.v !== STATE_VERSION || !state.fields || !state.schema) {
    throw new ApiError_('STATE_CORRUPT', 'Données de synchronisation invalides');
  }
  state.meta = Object.assign({}, state.meta, { callout: calloutId, toggle: toggle.id, code: code.id });
  if (!state.meta.meta) {
    const p = kids.filter(function (b) { return b.type === 'paragraph'; })[0];
    if (p) state.meta.meta = p.id;
  }
  cachePutState_(pageId, state);
  return state;
}

// JSON en ASCII pur : un découpage tous les 2000 caractères ne peut donc jamais
// couper un caractère multi-octets (emoji, accents) en deux.
function stateToJson_(state) {
  return JSON.stringify(state).replace(/[\u007f-￿]/g, function (ch) {
    return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
  });
}

function writeState_(pageId, state) {
  const json = stateToJson_(state);
  if (json.length > STATE_MAX_CHARS) {
    throw new ApiError_('STATE_TOO_LARGE', "Le rapport dépasse la taille maximale des données de synchronisation");
  }
  const rich = [];
  for (let i = 0; i < json.length; i += NOTION_MAX_TEXT) {
    rich.push({ type: 'text', text: { content: json.slice(i, i + NOTION_MAX_TEXT) } });
  }
  notion_('PATCH', '/blocks/' + state.meta.code, { code: { rich_text: rich, language: 'json' } });
  cachePutState_(pageId, state);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Présence (qui est sur la fiche) — en cache, jamais écrite dans Notion
 * ═══════════════════════════════════════════════════════════════════════════ */

function readPresence_(pageId) {
  try {
    return JSON.parse(CacheService.getScriptCache().get('pres_' + pageId) || '{}');
  } catch (err) {
    return {};
  }
}

function touchPresence_(pageId, clientId, name) {
  if (!clientId) return;
  const now = Date.now();
  const map = readPresence_(pageId);
  Object.keys(map).forEach(function (k) { if (now - map[k].s > PRESENCE_TTL_MS) delete map[k]; });
  map[clientId] = { n: name || '?', s: now };
  CacheService.getScriptCache().put('pres_' + pageId, JSON.stringify(map), 1800);
}

function pageEditors_(pageId, exceptClientId) {
  const now = Date.now();
  const map = readPresence_(pageId);
  return Object.keys(map)
    .filter(function (k) { return k !== exceptClientId && now - map[k].s <= PRESENCE_TTL_MS; })
    .map(function (k) { return { clientId: k, name: map[k].n, agoSec: Math.round((now - map[k].s) / 1000) }; });
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Vue publique de l'état (ce que reçoit la PWA)
 * ═══════════════════════════════════════════════════════════════════════════ */

function publicState_(state, editors) {
  const photos = {};
  Object.keys(state.photos).forEach(function (mediaId) {
    const p = state.photos[mediaId];
    if (p.del) return;
    (photos[p.f] = photos[p.f] || []).push({ mediaId: mediaId, by: p.by, at: p.at });
  });
  const custom = [];
  const removedCustom = [];
  Object.keys(state.custom).forEach(function (id) {
    const c = state.custom[id];
    if (c.del) { removedCustom.push(id); return; }
    const o = { id: id, type: c.type, label: c.label, by: c.by, at: c.at };
    if (c.options) o.options = c.options;
    custom.push(o);
  });
  custom.sort(function (a, b) { return a.at - b.at; });
  return {
    rev: state.rev,
    status: state.status, statusBy: state.statusBy, statusAt: state.statusAt,
    last: state.last,
    schema: state.schema,
    fields: state.fields,
    custom: custom, removedCustom: removedCustom,
    photos: photos,
    editors: editors || []
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Rendu des blocs Notion
 * ═══════════════════════════════════════════════════════════════════════════ */

function fieldRichText_(item, value) {
  if (item.type === 'image_upload') return rt_(item.label, { bold: true });
  return rt_(item.label, { bold: true }).concat(rt_(' : ' + display_(value)));
}

function blockForItem_(item, state) {
  if (item.k === 's') {
    const key = item.level === 1 ? 'heading_2' : 'heading_3';
    const b = { object: 'block', type: key };
    b[key] = { rich_text: rt_(item.text || '—') };
    return b;
  }
  const f = state.fields[item.id];
  const value = f ? f.v : '';
  if (CHECKBOX_TYPES.indexOf(item.type) > -1) {
    return { object: 'block', type: 'to_do', to_do: { rich_text: rt_(item.label), checked: value === true } };
  }
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: fieldRichText_(item, value) } };
}

function headerTitle_(state) {
  return rt_(REPORT_MARKER + ' — ' + (state.status === 'validated' ? 'Validé' : 'En cours'), { bold: true });
}

function metaText_(state) {
  let t = state.last
    ? 'Dernière modification : ' + state.last.by + ' · ' + formatWhen_(state.last.at)
    : 'Aucune saisie pour le moment';
  if (state.status === 'validated') {
    t += ' · Validé par ' + state.statusBy + ' (' + formatWhen_(state.statusAt) + ')';
  }
  return rt_(t, { color: 'gray' });
}

function codeBlock_() {
  return { object: 'block', type: 'code', code: { language: 'json', rich_text: rt_('{}') } };
}

// Met à jour le bloc d'un élément d'après sa valeur actuelle.
// Renvoie false si le bloc n'existe plus (supprimé à la main) : à recréer.
function updateItemBlock_(state, item) {
  const entry = state.blocks[item.id];
  if (!entry) return false;
  if (blockForItem_(item, state).type !== entry.t) return false;     // le type d'élément a changé
  const body = {};
  if (entry.t === 'to_do') {
    const f = state.fields[item.id];
    body.to_do = { rich_text: rt_(item.label), checked: !!(f && f.v === true) };
  } else if (entry.t === 'paragraph') {
    const f = state.fields[item.id];
    body.paragraph = { rich_text: fieldRichText_(item, f ? f.v : '') };
  } else {
    body[entry.t] = { rich_text: rt_(item.text || '—') };
  }
  try {
    notion_('PATCH', '/blocks/' + entry.b, body);
    return true;
  } catch (err) {
    if (err instanceof ApiError_ && (err.extra.status === 400 || err.extra.status === 404)) return false;
    throw err;
  }
}

/* ── Insertion à une position précise ────────────────────────────────────────
 *  Notion propose `position: {type:'after_block', after_block:{id}}` (actuel)
 *  et `after: id` (déprécié). On essaie le premier puis le second, on retient
 *  celui qui marche, et en dernier recours on ajoute en fin de rapport (l'ordre
 *  visuel est alors dégradé, rien n'est perdu). Les identifiants des blocs
 *  créés sont relus dans la liste des enfants plutôt que déduits de la réponse.
 * ──────────────────────────────────────────────────────────────────────────── */
function insertAfter_(parentId, anchorId, blocks, warnings) {
  const cache = CacheService.getScriptCache();
  const known = cache.get('cap_position');
  const modes = known ? [known] : ['position', 'after'];
  let used = null;
  for (let i = 0; i < modes.length && !used; i++) {
    const body = { children: blocks };
    if (modes[i] === 'position') body.position = { type: 'after_block', after_block: { id: anchorId } };
    else body.after = anchorId;
    try {
      notion_('PATCH', '/blocks/' + parentId + '/children', body);
      used = modes[i];
    } catch (err) {
      if (!(err instanceof ApiError_ && err.extra.status === 400)) throw err;
    }
  }
  if (used) {
    cache.put('cap_position', used, SYNC_CACHE_SECONDS);
  } else {
    appendPlain_(parentId, blocks);
    warnings.push({ code: 'POSITION_UNSUPPORTED', message: "Insertion à une position impossible : bloc ajouté en fin de rapport" });
  }

  const kids = listChildren_(parentId);
  let start;
  if (used) {
    let ai = -1;
    for (let i = 0; i < kids.length; i++) if (kids[i].id === anchorId) { ai = i; break; }
    if (ai === -1) throw new ApiError_('STATE_DESYNC', 'Bloc de repère introuvable après insertion');
    start = ai + 1;
  } else {
    start = kids.length - blocks.length;
  }
  const created = kids.slice(start, start + blocks.length);
  const okTypes = created.length === blocks.length && created.every(function (k, i) { return k.type === blocks[i].type; });
  if (!okTypes) throw new ApiError_('STATE_DESYNC', "Les blocs insérés n'ont pas pu être identifiés");
  return created.map(function (k) { return { id: k.id, type: k.type }; });
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Création du rapport, puis ajout des éléments manquants
 * ═══════════════════════════════════════════════════════════════════════════ */

function createReport_(pageId, state, created) {
  const items = renderList_(state);
  const children = [];
  const keys = [];
  children.push(blockParagraph_(metaText_(state)));
  keys.push('@meta');
  items.forEach(function (it) {
    children.push(blockForItem_(it, state));
    keys.push(it.id);
  });
  children.push({
    object: 'block', type: 'toggle',
    toggle: { rich_text: rt_(STATE_TOGGLE_TITLE, { color: 'gray' }) }
  });
  keys.push('@state');

  const callout = {
    object: 'block', type: 'callout',
    callout: {
      rich_text: headerTitle_(state),
      icon: { type: 'emoji', emoji: REPORT_ICON },
      color: 'blue_background',
      children: children.slice(0, NOTION_MAX_CHILDREN)
    }
  };
  const calloutId = appendPlain_(pageId, [callout])[0].id;
  for (let i = NOTION_MAX_CHILDREN; i < children.length; i += NOTION_MAX_CHILDREN) {
    appendPlain_(calloutId, children.slice(i, i + NOTION_MAX_CHILDREN));
  }

  const kids = listChildren_(calloutId);
  if (kids.length !== children.length) {
    throw new ApiError_('STATE_DESYNC', 'Le rapport créé ne contient pas le nombre de blocs attendu');
  }
  state.meta = { callout: calloutId };
  state.blocks = {};
  keys.forEach(function (key, i) {
    if (key === '@meta') state.meta.meta = kids[i].id;
    else if (key === '@state') state.meta.toggle = kids[i].id;
    else { state.blocks[key] = { b: kids[i].id, t: kids[i].type }; created[key] = true; }
  });
  state.meta.code = appendPlain_(state.meta.toggle, [codeBlock_()])[0].id;
  writeState_(pageId, state);     // ids connus : on valide tout de suite l'état
}

function ensureBlocks_(state, created, warnings) {
  const items = renderList_(state);
  let i = 0;
  while (i < items.length) {
    if (state.blocks[items[i].id]) { i++; continue; }
    let j = i;
    while (j < items.length && !state.blocks[items[j].id]) j++;
    const run = items.slice(i, j);
    let anchor = null;
    for (let k = i - 1; k >= 0; k--) {
      if (state.blocks[items[k].id]) { anchor = state.blocks[items[k].id].b; break; }
    }
    if (!anchor) anchor = state.meta.meta;
    const blocks = run.map(function (it) { return blockForItem_(it, state); });
    const ids = insertAfter_(state.meta.callout, anchor, blocks, warnings);
    run.forEach(function (it, n) {
      state.blocks[it.id] = { b: ids[n].id, t: ids[n].type };
      created[it.id] = true;
    });
    i = j;
  }
}

function deleteBlockQuiet_(id) {
  try {
    notion_('DELETE', '/blocks/' + id);
  } catch (err) {
    if (!(err instanceof ApiError_ && (err.extra.status === 400 || err.extra.status === 404))) throw err;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  ROUTE 3 — syncReport
 * ═══════════════════════════════════════════════════════════════════════════ */

function syncReport_(b) {
  const pageId = normId_(b.notionPageId);
  const clientId = clip_(b.clientId, 64);
  if (!clientId) throw new ApiError_('BAD_REQUEST', 'clientId requis');
  const by = cleanName_(b.author);
  if (!by) throw new ApiError_('AUTHOR_REQUIRED', 'Nom et prénom requis');

  const serverNow = Date.now();
  const clientNow = Number(b.clientNow);
  const c = {
    pageId: pageId, clientId: clientId, by: by, serverNow: serverNow,
    offset: isFinite(clientNow) ? serverNow - clientNow : 0,
    baseRev: Number(b.baseRev) || 0,
    ch: b.changes || {},
    schema: cleanSchema_(b.schema),
    reference: b.reference
  };

  assertPageInDatabase_(pageId);

  // Phase A — photos : Drive → Notion. Hors verrou : c'est la partie lente.
  const adds = cleanPhotoAdds_(c.ch.photos && c.ch.photos.add);
  const known = cacheGetState_(pageId);
  c.uploads = {};
  c.photoErrors = [];
  let remaining = 0;
  let sent = 0;
  adds.forEach(function (p) {
    if (known && known.photos[p.mediaId]) return;          // déjà dans Notion
    if (sent >= MAX_PHOTOS_PER_CALL) { remaining++; return; }
    try {
      c.uploads[p.mediaId] = notionUploadFromDrive_(p.driveFileId);
      sent++;
    } catch (err) {
      if (!(err instanceof ApiError_)) throw err;
      c.photoErrors.push({ mediaId: p.mediaId, code: err.code, message: err.message });
    }
  });
  c.photoAdds = adds;

  // Phase B — fusion et écriture, une seule à la fois.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    throw new ApiError_('BUSY', 'Serveur occupé : nouvel essai automatique');
  }
  let out;
  try {
    try {
      out = applyChanges_(c);
    } catch (err) {
      // Le cache peut décrire un rapport que quelqu'un a supprimé ou déplacé à la
      // main dans Notion : on repart de Notion, une seule fois.
      const st = err instanceof ApiError_ && err.code === 'NOTION_ERROR' ? err.extra.status : 0;
      if (st !== 400 && st !== 404) throw err;
      cacheClearState_(pageId);
      out = applyChanges_(c);
    }
  } finally {
    lock.releaseLock();
  }

  // Phase C — nettoyage du transit Drive ; ne fait jamais échouer la synchro.
  out.cleanup = cleanupDrive_(out.driveToClean);
  delete out.driveToClean;
  out.photoErrors = c.photoErrors;
  out.photosRemaining = remaining;
  return out;
}

function applyChanges_(c) {
  const pageId = c.pageId;
  const warnings = [];
  const created = {};

  // — État actuel (cache, sinon Notion). Un état abîmé est reconstruit.
  let state = null;
  try {
    state = loadState_(pageId);
  } catch (err) {
    if (!(err instanceof ApiError_) || (err.code !== 'STATE_MISSING' && err.code !== 'STATE_CORRUPT')) throw err;
    warnings.push({ code: err.code, message: err.message + ' : rapport recréé' });
    findReportBlocks_(pageId).forEach(deleteBlockQuiet_);
    cacheClearState_(pageId);
  }
  const isNew = !state;
  if (isNew) state = emptyState_();
  const reset = isNew && c.baseRev > 0;     // le serveur avait perdu le rapport

  let mutated = isNew;
  const applied = { fields: 0, custom: 0, customRemoved: 0, photos: 0, photosRemoved: 0, status: false };
  const rejected = { fields: [], custom: [], photos: [], status: false, reason: null };
  const overridden = [];
  const changedItems = {};      // id → true : bloc à mettre à jour
  let headerChanged = isNew;
  let lastAt = 0;

  // 1) Schéma
  const ms = mergeSchema_(state.schema, c.schema);
  state.schema = ms.schema;
  ms.relabeled.forEach(function (id) { changedItems[id] = true; });
  if (ms.added.length || ms.relabeled.length) mutated = true;

  // 2) Statut (validation partagée) — plus récent gagne
  const rs = c.ch.status;
  if (rs && (rs.value === 'validated' || rs.value === 'draft') && rs.value !== state.status) {
    const at = atCorr_(rs.at, c);
    if (at > state.statusAt || (at === state.statusAt && c.clientId > (state.statusC || ''))) {
      state.status = rs.value;
      state.statusBy = c.by;
      state.statusAt = at;
      state.statusC = c.clientId;
      applied.status = true;
      mutated = true;
      headerChanged = true;
      lastAt = Math.max(lastAt, at);
    } else {
      rejected.status = true;
    }
  }
  // Gelé = déjà validé AVANT cette requête. Si la requête elle-même valide (ou
  // rouvre), ses saisies sont appliquées : c'est le « valider » du technicien,
  // qui envoie ses dernières modifications avec le changement d'état.
  const frozen = state.status === 'validated' && !applied.status;

  // 3) Champs ajoutés par les techniciens
  const customOps = c.ch.custom || {};
  (customOps.add || []).slice(0, 20).forEach(function (raw) {
    const it = cleanCustom_(raw);
    if (!it) { warnings.push({ code: 'INVALID_CUSTOM', message: 'Champ ajouté invalide' }); return; }
    if (state.custom[it.id]) return;                                   // déjà connu (rejeu)
    if (frozen) { rejected.custom.push(it.id); return; }
    if (activeCustom_(state).length >= MAX_CUSTOM_FIELDS) {
      warnings.push({ code: 'TOO_MANY_CUSTOM', message: 'Trop de champs ajoutés' });
      return;
    }
    const at = atCorr_(raw.at, c);
    const rec = { type: it.type, label: it.label, by: c.by, at: at };
    if (it.options) rec.options = it.options;
    state.custom[it.id] = rec;
    applied.custom++;
    mutated = true;
    lastAt = Math.max(lastAt, at);
  });
  const removedCustom = [];
  (customOps.remove || []).slice(0, 20).forEach(function (raw) {
    const ex = raw && state.custom[raw.id];
    if (!ex || ex.del) return;
    if (frozen) { rejected.custom.push(raw.id); return; }
    const at = atCorr_(raw.at, c);
    ex.del = { by: c.by, at: at };
    removedCustom.push(raw.id);
    applied.customRemoved++;
    mutated = true;
    lastAt = Math.max(lastAt, at);
  });

  // 4) Valeurs des champs — dernière saisie gagnante, champ par champ
  const itemById = {};
  renderList_(state).forEach(function (it) { itemById[it.id] = it; });
  const fieldOps = c.ch.fields || {};
  Object.keys(fieldOps).slice(0, 300).forEach(function (id) {
    const op = fieldOps[id] || {};
    const item = itemById[id];
    if (!item || item.k !== 'f') { warnings.push({ code: 'UNKNOWN_FIELD', id: id }); return; }
    if (item.type === 'image_upload') { warnings.push({ code: 'PHOTO_FIELD_HAS_NO_VALUE', id: id }); return; }
    if (frozen) { rejected.fields.push(id); return; }
    const v = cleanValue_(op.v);
    if (v === undefined) { warnings.push({ code: 'INVALID_VALUE', id: id }); return; }
    const at = atCorr_(op.at, c);
    const ex = state.fields[id];
    const wins = !ex || at > ex.at || (at === ex.at && c.clientId >= ex.c);
    if (wins) {
      if (!ex || !sameValue_(ex.v, v)) {
        state.fields[id] = { v: v, at: at, by: c.by, c: c.clientId };
        changedItems[id] = true;
        applied.fields++;
        mutated = true;
        lastAt = Math.max(lastAt, at);
      }
    } else if (ex.c !== c.clientId && !sameValue_(ex.v, v)) {
      overridden.push({ id: id, mine: v, theirs: { v: ex.v, by: ex.by, at: ex.at } });
    }
  });

  if (lastAt) state.last = { by: c.by, at: lastAt };

  // 5) Écriture dans Notion — d'abord la structure, puis le contenu
  if (isNew) createReport_(pageId, state, created);
  else if (mutated) {
    const before = Object.keys(state.blocks).length;
    ensureBlocks_(state, created, warnings);
    if (Object.keys(state.blocks).length !== before) writeState_(pageId, state);   // ids sûrs avant la suite
  }

  // Éléments supprimés (champs ajoutés retirés)
  removedCustom.forEach(function (id) {
    const e = state.blocks[id];
    if (e) { deleteBlockQuiet_(e.b); delete state.blocks[id]; }
    Object.keys(state.photos).forEach(function (m) {
      if (state.photos[m].f === id && !state.photos[m].del) state.photos[m].del = { by: c.by, at: lastAt || c.serverNow };
    });
  });
  if (removedCustom.length && !activeCustom_(state).length && state.blocks[CUSTOM_SECTION_ID]) {
    deleteBlockQuiet_(state.blocks[CUSTOM_SECTION_ID].b);
    delete state.blocks[CUSTOM_SECTION_ID];
  }

  // Valeurs et libellés modifiés → mise à jour en place
  const stale = [];
  Object.keys(changedItems).forEach(function (id) {
    if (created[id] || !itemById[id]) return;
    if (!updateItemBlock_(state, itemById[id])) stale.push(id);
  });
  if (stale.length) {                       // bloc supprimé à la main dans Notion : on le recrée
    stale.forEach(function (id) {
      if (state.blocks[id]) deleteBlockQuiet_(state.blocks[id].b);
      delete state.blocks[id];
    });
    ensureBlocks_(state, created, warnings);
  }

  // 6) Photos
  (c.ch.photos && c.ch.photos.remove || []).slice(0, 50).forEach(function (raw) {
    const p = raw && state.photos[raw.mediaId];
    if (!p || p.del) return;
    if (frozen) { rejected.photos.push(raw.mediaId); return; }
    deleteBlockQuiet_(p.b);
    p.del = { by: c.by, at: atCorr_(raw.at, c) };
    applied.photosRemoved++;
    mutated = true;
  });
  const driveToClean = [];
  c.photoAdds.forEach(function (p) {
    if (state.photos[p.mediaId]) { driveToClean.push(p.driveFileId); return; }   // déjà là : on libère le transit
    const uploadId = c.uploads[p.mediaId];
    if (!uploadId) return;                                  // en erreur ou reporté : le client renverra
    if (frozen) { rejected.photos.push(p.mediaId); return; }
    const item = itemById[p.componentId];
    const entry = state.blocks[p.componentId];
    if (!item || item.type !== 'image_upload' || !entry) {
      warnings.push({ code: 'UNKNOWN_PHOTO_FIELD', id: p.componentId });
      driveToClean.push(p.driveFileId);
      return;
    }
    const img = appendPlain_(entry.b, [{
      object: 'block', type: 'image',
      image: { type: 'file_upload', file_upload: { id: uploadId }, caption: rt_(item.label) }
    }])[0];
    const at = atCorr_(p.at, c);
    state.photos[p.mediaId] = { f: p.componentId, b: img.id, by: c.by, at: at };
    driveToClean.push(p.driveFileId);
    applied.photos++;
    mutated = true;
    lastAt = Math.max(lastAt, at);
    state.last = { by: c.by, at: Math.max(lastAt, state.last ? state.last.at : 0) };
  });

  // 7) En-tête, révision, état
  if (mutated) {
    if (!isNew) {
      if (headerChanged) notion_('PATCH', '/blocks/' + state.meta.callout, { callout: { rich_text: headerTitle_(state) } });
      notion_('PATCH', '/blocks/' + state.meta.meta, { paragraph: { rich_text: metaText_(state) } });
    }
    state.rev += 1;
    writeState_(pageId, state);
  }
  touchPresence_(pageId, c.clientId, c.by);

  if (rejected.fields.length || rejected.custom.length || rejected.photos.length) rejected.reason = 'VALIDATED';

  return {
    report: publicState_(state, pageEditors_(pageId, c.clientId)),
    unchanged: !mutated,
    serverNow: Date.now(),
    overridden: overridden,
    rejected: rejected,
    reset: reset,
    applied: applied,
    warnings: warnings,
    driveToClean: driveToClean
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Lecture légère — relève des modifications des collègues
 * ═══════════════════════════════════════════════════════════════════════════ */

function getReport_(p) {
  const pageId = normId_(p.pageId);
  const clientId = clip_(p.clientId, 64);
  touchPresence_(pageId, clientId, clip_(p.name, 60));
  const editors = pageEditors_(pageId, clientId);
  const since = p.sinceRev === undefined || p.sinceRev === '' ? NaN : Number(p.sinceRev);

  // Même révision en cache : aucune requête vers Notion.
  const cachedRev = cacheGetRev_(pageId);
  if (cachedRev !== null && isFinite(since) && cachedRev === since) {
    return { unchanged: true, rev: since, editors: editors, serverNow: Date.now() };
  }

  assertPageInDatabase_(pageId);
  const state = loadState_(pageId);
  if (!state) return { unchanged: false, report: null, editors: editors, serverNow: Date.now() };
  if (isFinite(since) && state.rev === since) {
    return { unchanged: true, rev: since, editors: editors, serverNow: Date.now() };
  }
  return { unchanged: false, report: publicState_(state, editors), editors: editors, serverNow: Date.now() };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Test à lancer depuis l'éditeur Apps Script
 * ═══════════════════════════════════════════════════════════════════════════ */

// Vérifie sur VOTRE Notion les capacités dont dépend le rapport en place :
// insertion à une position, mise à jour, enfants d'un paragraphe, suppression.
// Prérequis : propriété de script TEST_PAGE_ID = ID d'une page de test de la base.
// Les blocs de test sont supprimés à la fin.
function testNotionCapabilities() {
  const pageId = normId_(cfg_('TEST_PAGE_ID'));
  const warnings = [];
  const root = appendPlain_(pageId, [{
    object: 'block', type: 'callout',
    callout: {
      rich_text: rt_('TEST capacités — à supprimer'), icon: { type: 'emoji', emoji: '🧪' },
      children: [blockParagraph_(rt_('A')), blockParagraph_(rt_('C'))]
    }
  }])[0].id;
  try {
    const kids = listChildren_(root);
    Logger.log('1. Création callout + 2 enfants : OK (%s enfants)', kids.length);

    const mid = insertAfter_(root, kids[0].id, [blockParagraph_(rt_('B'))], warnings);
    const order = listChildren_(root).map(function (k) { return plain_(k.paragraph.rich_text); }).join('');
    Logger.log('2. Insertion après un bloc : %s (ordre obtenu = %s, attendu ABC) — mode %s',
      order === 'ABC' ? 'OK' : 'ÉCHEC', order, CacheService.getScriptCache().get('cap_position') || 'aucun');
    warnings.forEach(function (w) { Logger.log('   ⚠ %s', w.message); });

    notion_('PATCH', '/blocks/' + mid[0].id, { paragraph: { rich_text: rt_('B (modifié)') } });
    Logger.log('3. Mise à jour d\'un paragraphe en place : OK');

    const todo = appendPlain_(root, [{ object: 'block', type: 'to_do', to_do: { rich_text: rt_('case'), checked: false } }])[0].id;
    notion_('PATCH', '/blocks/' + todo, { to_do: { rich_text: rt_('case'), checked: true } });
    Logger.log('4. Mise à jour d\'une case à cocher : OK');

    appendPlain_(mid[0].id, [blockParagraph_(rt_('enfant'))]);
    Logger.log('5. Enfant sous un paragraphe : OK');

    const toggle = appendPlain_(root, [{ object: 'block', type: 'toggle', toggle: { rich_text: rt_('t') } }])[0].id;
    const code = appendPlain_(toggle, [codeBlock_()])[0].id;
    const long = new Array(4500).join('é€😀');
    const json = JSON.stringify({ t: long }).replace(/[\u007f-￿]/g, function (ch) {
      return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
    });
    const rich = [];
    for (let i = 0; i < json.length; i += NOTION_MAX_TEXT) rich.push({ type: 'text', text: { content: json.slice(i, i + NOTION_MAX_TEXT) } });
    notion_('PATCH', '/blocks/' + code, { code: { rich_text: rich, language: 'json' } });
    const back = plain_(listChildren_(toggle)[0].code.rich_text);
    Logger.log('6. Bloc de données (%s caractères en %s morceaux) relu à l\'identique : %s',
      json.length, rich.length, back === json ? 'OK' : 'ÉCHEC');
  } finally {
    deleteBlockQuiet_(root);
    Logger.log('Blocs de test supprimés.');
  }
}
