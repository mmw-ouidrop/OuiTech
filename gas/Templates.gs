/**
 * ============================================================================
 *  Templates.gs — Éditeur de template des CR d'intervention (profil « support »)
 * ============================================================================
 *
 *  Le support prépare depuis la PWA ce qu'il écrivait à la main dans Notion : le contenu de la page de la mission
 *  (intertitres, consignes, cases à cocher, champs de saisie, photos à prendre, blocs HTML).
 *
 *  ROUTES (profil support uniquement)
 *    GET  ?action=templateGet&id=FI-252
 *         → { pageId, reference, title, url, parentId, container, outside, items:[…] }
 *    POST { action:"templateSave", id:"FI-252", items:[…] }
 *         → même réponse que templateGet + { saved:{ created, updated, deleted, moved }, warnings:[…] }
 *
 *  ÉLÉMENTS (`items`, dans l'ordre d'affichage). Chacun porte `ref` (id du bloc Notion ; absent pour un nouvel élément).
 *    { t:'section', level:1|2|3, text }
 *    { t:'text', style:'paragraph'|'bulleted_list'|'numbered_list'|'quote'|'callout', text, rich? }
 *    { t:'todo', text }                                     case à cocher native de Notion
 *    { t:'field', type, id, label, options?, required?, placeholder?, unit? }      bloc de code json
 *    { t:'divider' }   { t:'html', html }
 *    { t:'locked', label, preview }                         image, vidéo, PDF, tableau… : se gère dans Notion, jamais modifié ici
 *  `fixed:true` : le bloc contient des sous-blocs ; son texte se modifie, mais il n'est jamais recréé (donc pas déplacé).
 *
 *  PRINCIPE D'ÉCRITURE : on ne touche qu'à ce qui change. Un bloc inchangé n'est pas réécrit (sa mise en forme Notion est
 *  conservée) ; un bloc modifié est mis à jour en place ; un bloc déplacé est recréé à sa nouvelle place ; un bloc retiré est
 *  supprimé. Les blocs « locked » ne sont jamais recréés. Le rapport et ses données ne sont jamais touchés.
 *  Si la page n'a encore aucun contenu, un toggle « Template CR intervention » est créé pour le ranger.
 * ============================================================================
 */

const TPL_NEW_CONTAINER_TITLE = 'Template CR intervention';
const TPL_TEXT_TYPES = { paragraph: 'paragraph', bulleted_list: 'bulleted_list_item', numbered_list: 'numbered_list_item', quote: 'quote', callout: 'callout' };
const TPL_FIELD_KEYS = ['type', 'id', 'label', 'options', 'required', 'placeholder', 'unit'];
const TPL_LOCK_LABELS = {
  image: 'Image', video: 'Vidéo', pdf: 'PDF', file: 'Fichier', audio: 'Audio', embed: 'Lien intégré', bookmark: 'Marque-page',
  link_preview: 'Lien', table: 'Tableau', toggle: 'Bloc déroulant', column_list: 'Colonnes', column: 'Colonne',
  synced_block: 'Bloc synchronisé', child_page: 'Sous-page', child_database: 'Base de données', equation: 'Équation', code: 'Code'
};

/* ───────────────────────────── Lecture ───────────────────────────── */

function tplHasStyle_(rich) {
  return (rich || []).some(function (r) {
    const a = r.annotations || {};
    return !!(a.bold || a.italic || a.underline || a.strikethrough || a.code || (a.color && a.color !== 'default') || r.href);
  });
}

function tplCanon_(v) {
  if (Array.isArray(v)) return '[' + v.map(tplCanon_).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + tplCanon_(v[k]); }).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

function tplParseField_(text) {
  try {
    const o = JSON.parse(text);
    if (o && typeof o === 'object' && !Array.isArray(o) && typeof o.type === 'string' && typeof o.id === 'string' &&
        COMPONENT_TYPES.indexOf(o.type) > -1) return o;
  } catch (err) { /* bloc non éditable ici */ }
  return null;
}

function tplLocked_(b, label, preview) {
  return { t: 'locked', ref: plainId_(b.id), label: label, preview: shorten_(preview || '', 120) };
}

function tplItemOf_(b) {
  const t = b.type;
  const d = b[t] || {};
  const ref = plainId_(b.id);
  const fixed = !!b.has_children;
  const text = plain_(d.rich_text);
  if (/^heading_[123]$/.test(t)) {
    return { t: 'section', ref: ref, level: Number(t.slice(-1)), text: text, fixed: fixed || d.is_toggleable === true };
  }
  for (const style in TPL_TEXT_TYPES) {
    if (TPL_TEXT_TYPES[style] === t) return { t: 'text', ref: ref, style: style, text: text, rich: tplHasStyle_(d.rich_text), fixed: fixed };
  }
  if (t === 'to_do') return { t: 'todo', ref: ref, text: text, fixed: fixed };
  if (t === 'divider') return { t: 'divider', ref: ref };
  if (t === 'code' && d.language === 'html') return { t: 'html', ref: ref, html: text };
  if (t === 'code' && d.language === 'json') {
    const o = tplParseField_(text);
    if (!o) return tplLocked_(b, 'Champs (JSON)', text);
    return { t: 'field', ref: ref, type: o.type, id: o.id, label: o.label === undefined ? '' : String(o.label),
      options: Array.isArray(o.options) ? o.options.map(String) : undefined, required: o.required === true,
      placeholder: typeof o.placeholder === 'string' ? o.placeholder : '', unit: typeof o.unit === 'string' ? o.unit : '' };
  }
  const cap = d.caption ? plain_(d.caption) : '';
  const url = d.url || (d.external && d.external.url) || '';
  return tplLocked_(b, TPL_LOCK_LABELS[t] || 'Bloc Notion', text || cap || d.name || url);
}

// Où se trouve le template : toggle « Template … » s'il existe, sinon le contenu de la page elle-même.
function tplContext_(page) {
  const top = listChildren_(page.id);
  const container = top.filter(isTemplateContainer_)[0] || null;
  const isReportPart = function (b) { return isReportBlock_(b) || isStateBlock_(b) || isLegacyReportBlock_(b); };
  const content = top.filter(function (b) { return !isReportPart(b); });
  const parentId = container ? container.id : page.id;
  const current = container ? listChildren_(container.id) : content;
  const outside = container ? content.filter(function (b) { return b.id !== container.id; }).length : 0;
  return { page: page, container: container, parentId: parentId, current: current, outside: outside };
}

function tplView_(page, ctx) {
  return {
    pageId: plainId_(page.id), reference: referenceOf_(page, ''), title: titleOfPage_(page), url: page.url || '',
    parentId: plainId_(ctx.parentId), container: !!ctx.container, outside: ctx.outside,
    items: ctx.current.map(tplItemOf_)
  };
}

function getTemplate_(p) {
  const page = findPageByReference_(p.id);
  return tplView_(page, tplContext_(page));
}

/* ───────────────────────────── Validation ───────────────────────────── */

function tplFail_(n, message) {
  throw new ApiError_('BAD_REQUEST', 'Élément ' + (n + 1) + ' : ' + message);
}

function tplText_(v, max) {
  return String(v == null ? '' : v).replace(/\r/g, '').slice(0, max);
}

function tplCleanItems_(raw, ctx) {
  if (!Array.isArray(raw)) throw new ApiError_('BAD_REQUEST', 'Liste d’éléments manquante');
  if (raw.length > MAX_SCHEMA_ITEMS) throw new ApiError_('BAD_REQUEST', 'Trop d’éléments (' + MAX_SCHEMA_ITEMS + ' au plus)');
  const known = {};
  ctx.current.forEach(function (b) { known[plainId_(b.id)] = b; });
  const ids = {};
  // identifiants des champs que cet éditeur ne modifie pas (blocs JSON verrouillés)
  ctx.current.forEach(function (b) {
    if (b.type !== 'code' || (b.code || {}).language !== 'json' || tplParseField_(plain_(b.code.rich_text))) return;
    try {
      [].concat(JSON.parse(plain_(b.code.rich_text))).forEach(function (o) { if (o && o.id) ids[String(o.id)] = 'verrou'; });
    } catch (err) { /* JSON invalide : aucun id */ }
  });
  const seenRef = {};
  return raw.map(function (it, n) {
    if (!it || typeof it !== 'object') tplFail_(n, 'élément invalide');
    const out = { t: String(it.t || '') };
    if (it.ref) {
      out.ref = plainId_(it.ref);
      if (!known[out.ref]) throw new ApiError_('TEMPLATE_CHANGED', 'Le template a été modifié dans Notion depuis son ouverture : rechargez-le avant d’enregistrer.');
      if (seenRef[out.ref]) tplFail_(n, 'bloc utilisé deux fois');
      seenRef[out.ref] = true;
    }
    switch (out.t) {
      case 'section':
        out.level = it.level === 1 || it.level === 3 ? it.level : 2;
        out.text = tplText_(it.text, MAX_LABEL).trim();
        if (!out.text) tplFail_(n, 'le titre de section est vide');
        break;
      case 'text':
        if (!TPL_TEXT_TYPES[it.style]) tplFail_(n, 'type de texte inconnu');
        out.style = it.style;
        out.text = tplText_(it.text, 4000);
        if (!out.text.trim()) tplFail_(n, 'le texte est vide');
        break;
      case 'todo':
        out.text = tplText_(it.text, MAX_LABEL).trim();
        if (!out.text) tplFail_(n, 'la case à cocher n’a pas de texte');
        break;
      case 'field': {
        if (COMPONENT_TYPES.indexOf(it.type) === -1) tplFail_(n, 'type de champ inconnu');
        out.type = it.type;
        out.id = String(it.id || '');
        if (!COMPONENT_ID_RE.test(out.id)) tplFail_(n, 'identifiant « ' + out.id + ' » invalide (lettres, chiffres, _ et - ; 64 caractères au plus)');
        if (RESERVED_ID_RE.test(out.id)) tplFail_(n, 'identifiant « ' + out.id + ' » réservé (u_, todo_, S:)');
        if (ids[out.id]) tplFail_(n, 'identifiant « ' + out.id + ' » déjà utilisé');
        ids[out.id] = true;
        out.label = tplText_(it.label, MAX_LABEL).trim();
        if (!out.label) tplFail_(n, 'le champ n’a pas de libellé');
        if (CHOICE_TYPES.indexOf(out.type) > -1) {
          const seen = {};
          out.options = (Array.isArray(it.options) ? it.options : []).map(function (o) { return tplText_(o, 80).trim(); })
            .filter(function (o) { if (!o || seen[o]) return false; seen[o] = true; return true; });
          if (out.options.length < 2 || out.options.length > 20) tplFail_(n, 'un choix demande de 2 à 20 options');
        }
        out.required = it.required === true;
        out.placeholder = tplText_(it.placeholder, 100).trim();
        out.unit = tplText_(it.unit, 20).trim();
        break;
      }
      case 'divider':
        break;
      case 'html':
        out.html = tplText_(it.html, MAX_TEMPLATE_HTML);
        if (!out.html.trim()) tplFail_(n, 'le bloc HTML est vide');
        break;
      case 'locked':
        if (!out.ref) tplFail_(n, 'ce bloc ne peut pas être créé ici');
        break;
      default:
        tplFail_(n, 'type d’élément inconnu');
    }
    return out;
  });
}

/* ───────────────────────────── Blocs Notion ───────────────────────────── */

function tplFieldJson_(it, original) {
  const o = {};
  Object.keys(original || {}).forEach(function (k) { if (TPL_FIELD_KEYS.indexOf(k) === -1) o[k] = original[k]; });   // clés propres au responsable, conservées
  o.type = it.type;
  o.id = it.id;
  o.label = it.label;
  if (it.options) o.options = it.options;
  if (it.required) o.required = true;
  if (it.placeholder && (it.type === 'text' || it.type === 'textarea' || it.type === 'number')) o.placeholder = it.placeholder;
  if (it.unit && it.type === 'number') o.unit = it.unit;
  return o;
}

// → { type, data } : corps du bloc (création) ; `data` sert aussi aux mises à jour.
function tplBlockSpec_(it, original) {
  switch (it.t) {
    case 'section': return { type: 'heading_' + it.level, data: { rich_text: rt_(it.text) } };
    case 'text': {
      const spec = { type: TPL_TEXT_TYPES[it.style], data: { rich_text: rt_(it.text) } };
      if (it.style === 'callout') spec.data.icon = { type: 'emoji', emoji: '💡' };
      return spec;
    }
    case 'todo': return { type: 'to_do', data: { rich_text: rt_(it.text), checked: false } };
    case 'divider': return { type: 'divider', data: {} };
    case 'html': return { type: 'code', data: { language: 'html', rich_text: rt_(it.html) } };
    default: return { type: 'code', data: { language: 'json', rich_text: rt_(JSON.stringify(tplFieldJson_(it, original), null, 2)) } };
  }
}

function tplBlockOf_(spec) {
  const b = { object: 'block', type: spec.type };
  b[spec.type] = spec.data;
  return b;
}

// Le bloc existant correspond-il déjà à l'élément (même type, même contenu) ? → { same, patchable }
function tplCompare_(it, cur) {
  const spec = tplBlockSpec_(it, tplOriginalField_(cur));
  const d = cur[cur.type] || {};
  const patchable = spec.type === cur.type && (cur.type !== 'code' || d.language === spec.data.language);
  if (!patchable) return { same: false, patchable: false, spec: spec };
  let same;
  if (it.t === 'field') same = tplCanon_(tplFieldJson_(it, tplOriginalField_(cur))) === tplCanon_(tplParseField_(plain_(d.rich_text)));
  else if (it.t === 'divider') same = true;
  else same = plain_(d.rich_text) === (it.t === 'html' ? it.html : it.text);
  return { same: same, patchable: true, spec: spec };
}

function tplOriginalField_(cur) {
  return cur.type === 'code' && (cur.code || {}).language === 'json' ? tplParseField_(plain_(cur.code.rich_text)) : null;
}

/* ───────────────────────────── Insertion au début ───────────────────────────── */

// Insère après `anchorId` ; sans repère, au début du bloc parent. Renvoie les blocs créés [{id,type}] dans l'ordre.
function tplInsert_(parentId, anchorId, blocks, warnings) {
  const out = [];
  let anchor = anchorId;
  for (let i = 0; i < blocks.length; i += NOTION_MAX_CHILDREN) {
    const chunk = blocks.slice(i, i + NOTION_MAX_CHILDREN);
    let made;
    if (anchor) {
      made = insertAfter_(parentId, anchor, chunk, warnings);
    } else {
      let used = false;
      try {
        notion_('PATCH', '/blocks/' + parentId + '/children', { children: chunk, position: { type: 'start' } });
        used = true;
      } catch (err) {
        if (!(err instanceof ApiError_ && err.extra.status === 400)) throw err;
        appendPlain_(parentId, chunk);
        warnings.push({ code: 'POSITION_UNSUPPORTED', message: 'Insertion au début impossible : bloc ajouté à la fin' });
      }
      const kids = listChildren_(parentId);
      const start = used ? 0 : kids.length - chunk.length;
      made = kids.slice(start, start + chunk.length).map(function (k) { return { id: k.id, type: k.type }; });
      if (made.length !== chunk.length || !made.every(function (k, j) { return k.type === chunk[j].type; })) {
        throw new ApiError_('STATE_DESYNC', 'Les blocs insérés n’ont pas pu être identifiés');
      }
    }
    made.forEach(function (m) { out.push(m); });
    anchor = made[made.length - 1].id;
  }
  return out;
}

/* ───────────────────────────── Écriture ───────────────────────────── */

function saveTemplate_(body) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) { throw new ApiError_('BUSY', 'Serveur occupé : réessayez dans un instant'); }
  try {
    return tplSaveLocked_(body);
  } finally {
    lock.releaseLock();
  }
}

function tplSaveLocked_(body) {
  const page = findPageByReference_(body.id);
  assertPageInDatabase_(plainId_(page.id));
  let ctx = tplContext_(page);
  const items = tplCleanItems_(body.items, ctx);
  const warnings = [];
  const stats = { created: 0, updated: 0, deleted: 0, moved: 0 };

  // Page sans aucun contenu : on crée le toggle « Template » qui accueillera le formulaire.
  if (!ctx.container && !ctx.current.length && items.length) {
    const made = tplInsert_(page.id, null, [{ object: 'block', type: 'toggle', toggle: { rich_text: rt_(TPL_NEW_CONTAINER_TITLE, { bold: true }) } }], warnings);
    ctx = { page: page, container: { id: made[0].id }, parentId: made[0].id, current: [], outside: 0 };
  }

  const index = {};
  const byRef = {};
  ctx.current.forEach(function (b, i) { index[plainId_(b.id)] = i; byRef[plainId_(b.id)] = b; });

  let lastKept = -1;
  let prevId = null;            // dernier bloc en place (conservé ou créé)
  let run = [];                 // blocs à créer à la suite
  const dropped = [];           // anciens blocs remplacés (supprimés après création)
  const keptRefs = {};

  const flush = function () {
    if (!run.length) return;
    const made = tplInsert_(ctx.parentId, prevId, run.map(function (r) { return tplBlockOf_(r.spec); }), warnings);
    prevId = made[made.length - 1].id;
    stats.created += run.length;
    run = [];
  };

  items.forEach(function (it) {
    const cur = it.ref ? byRef[it.ref] : null;
    if (it.t === 'locked' || (cur && cur.has_children)) {
      // jamais recréé : reste où il est, seul son texte peut changer (bloc avec sous-blocs)
      flush();
      if (cur && it.t !== 'locked') {
        const cmp = tplCompare_(it, cur);
        if (cmp.patchable && !cmp.same) {
          const patch = {}; patch[cur.type] = cmp.spec.data;
          if (cur.type === 'to_do') patch.to_do.checked = !!(cur.to_do || {}).checked;
          notion_('PATCH', '/blocks/' + cur.id, patch);
          stats.updated++;
        } else if (!cmp.patchable) {
          warnings.push({ code: 'TYPE_LOCKED', message: 'Un bloc qui contient des sous-blocs ne peut pas changer de type : modifiez-le dans Notion.' });
        }
      }
      keptRefs[it.ref] = true;
      lastKept = Math.max(lastKept, index[it.ref]);
      prevId = cur.id;
      return;
    }
    if (cur && index[it.ref] > lastKept) {
      const cmp = tplCompare_(it, cur);
      if (cmp.patchable) {
        flush();
        if (!cmp.same) {
          const patch = {}; patch[cur.type] = cmp.spec.data;
          if (cur.type === 'to_do') patch.to_do.checked = !!(cur.to_do || {}).checked;
          notion_('PATCH', '/blocks/' + cur.id, patch);
          stats.updated++;
        }
        keptRefs[it.ref] = true;
        lastKept = index[it.ref];
        prevId = cur.id;
        return;
      }
    }
    // nouveau, déplacé ou changé de type : recréé à sa place
    if (cur) { dropped.push(cur.id); stats.moved++; keptRefs[it.ref] = true; }
    run.push({ spec: tplBlockSpec_(it, cur ? tplOriginalField_(cur) : null) });
  });
  flush();

  dropped.forEach(deleteBlockQuiet_);
  ctx.current.forEach(function (b) {
    if (keptRefs[plainId_(b.id)]) return;
    deleteBlockQuiet_(b.id);
    stats.deleted++;
  });
  stats.created -= stats.moved;

  const fresh = tplView_(page, tplContext_(page));
  fresh.saved = stats;
  fresh.warnings = warnings;
  return fresh;
}
