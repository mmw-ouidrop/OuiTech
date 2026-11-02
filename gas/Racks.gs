/**
 * ============================================================================
 *  Racks.gs — Racks et casiers KO (base Notion « Casiers et Racks KO CZ »)
 * ============================================================================
 *
 *  Le technicien choisit un site, voit ses racks et casiers KO, et note son diagnostic. Le diagnostic va dans une colonne
 *  texte « Commentaire technicien » ET l'état passe de « KO » à « Diag tech » (RACKS_DIAG_STATE) : l'équipe (profil
 *  « support technique », ou Notion) fait le double contrôle et valide le nouvel état ou non. Une entrée = 4 lignes :
 *
 *      État : Réparé
 *      Date : 29/10/2026 08:22
 *      Tech : Prénom Nom
 *      Commentaire : texte libre (peut être vide)
 *
 *  Les entrées successives sont séparées par une ligne « --- » (la plus récente en haut ; RACKS_COMMENT_MODE=replace
 *  pour ne garder que la dernière).
 *
 *  ROUTES
 *    GET  ?action=racksOverview&sinceRev=…
 *         → { rev, total, sites:[{id,title,casiers,racks,autres,total,diagnosed}] }  ou { unchanged:true, rev }
 *    GET  ?action=racks&site=<pageId de la machine>&sinceRev=…
 *         → { rev, site:{id,title}, states:[{id,label}], items:[{id,title,kind,cause,updated,diag,history}] }
 *           kind : 'casier' | 'rack' | 'autre' (d'après le début du nom) ; diag/history : voir ci-dessus
 *    GET  ?action=racks&site=…&all=1         tous les états (pas seulement KO / Diag tech) ; chaque élément porte son `state`
 *                                             et la réponse `stateOptions` (valeurs possibles de la colonne État)
 *    GET  ?action=racksSearch&q=14&site=<id>&state=<nom|*>&kind=casier|rack
 *         → { items:[{…, siteId, siteTitle}], truncated, stateOptions }   state vide = KO + Diag tech ; « * » = tous
 *    GET  ?action=rackComments&pageId=…     → { comments:[{id,at,by,text}] }   commentaires NOTION de la page
 *    POST { action:"rackDiagnosis", pageId, state, comment, id, name }
 *         → { duplicate:false, diag, history, state }   (id : identifiant unique de l'envoi, rejeu sans effet)
 *    POST { action:"rackSetState", pageId, state, id, name }       profil support : valide / change l'état
 *    POST { action:"rackComment", pageId, text, id, name }         profil support : ajoute un commentaire Notion
 *
 *  PROPRIÉTÉS DE SCRIPT (facultatives)
 *    RACKS_DB_ID          Défaut : 27e37d20ee35806294f7f3bf21b1d545
 *    RACKS_PROP_SITE      Défaut : 🤖 Site        (relation vers la liste des machines)
 *    RACKS_PROP_STATE     Défaut : État           (sélection ou statut)
 *    RACKS_PROP_CAUSE     Défaut : Cause          (multi-sélection, facultative)
 *    RACKS_PROP_COMMENT   Défaut : Commentaire technicien   (colonne TEXTE à créer dans la base)
 *    RACKS_KO_STATES      états « à traiter », séparés par « | ». Défaut : KO|Diag tech
 *    RACKS_DIAG_STATE     état écrit après un diagnostic technicien. Défaut : Diag tech (une Sélection le crée toute seule ;
 *                         une colonne de type Statut doit déjà avoir cette valeur)
 *    RACKS_COMMENT_MODE   append (défaut : on garde l'historique) | replace
 *
 *  L'intégration Notion doit être connectée à la base ET à la liste des machines (pour le nom des sites), et avoir les
 *  capacités « Read comments » et « Insert comments » pour lire / écrire les commentaires des pages.
 * ============================================================================
 */

const RACKS_DB_DEFAULT = '27e37d20ee35806294f7f3bf21b1d545';
const RACK_SEPARATOR = '\n---\n';
const RACK_COMMENT_MAX = 1000;
const RACK_STATES = [
  { id: 'repaired', label: 'Réparé' },
  { id: 'unrepairable', label: 'Non réparable' },
  { id: 'left_as_is', label: 'Laissé en l’état' },
  { id: 'watch', label: 'À surveiller' }
];

function racksCfg_() {
  return {
    db: String(cfg_('RACKS_DB_ID', RACKS_DB_DEFAULT)).replace(/-/g, ''),
    site: cfg_('RACKS_PROP_SITE', '🤖 Site'),
    state: cfg_('RACKS_PROP_STATE', 'État'),
    cause: cfg_('RACKS_PROP_CAUSE', 'Cause'),
    comment: cfg_('RACKS_PROP_COMMENT', 'Commentaire technicien'),
    koStates: nameList_('RACKS_KO_STATES', ['KO', 'Diag tech']),
    diagState: cfg_('RACKS_DIAG_STATE', 'Diag tech'),
    replace: String(cfg_('RACKS_COMMENT_MODE', 'append')).toLowerCase() === 'replace'
  };
}

function assertRackPage_(page, c) {
  const parent = page && page.parent;
  if (!parent || plainId_(parent.database_id) !== c.db || page.archived) throw new ApiError_('NOT_FOUND', 'Rack ou casier introuvable');
}

// Schéma de la base (type de la colonne État, valeurs possibles, nom de la colonne titre), lu une fois puis gardé 6 h.
function racksSchema_(c) {
  const cache = CacheService.getScriptCache();
  const key = 'racks:schema:' + c.db + ':' + c.state;
  const hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (err) { /* relu ci-dessous */ } }
  const db = notion_('GET', '/databases/' + c.db);
  const props = db.properties || {};
  const p = props[c.state];
  if (!p) throw new ApiError_('CONFIG_INVALID', 'Colonne « ' + c.state + ' » introuvable dans la base des racks (RACKS_PROP_STATE).');
  if (p.type !== 'select' && p.type !== 'status') throw new ApiError_('CONFIG_INVALID', 'La colonne « ' + c.state + ' » doit être de type Sélection ou Statut.');
  const titleName = Object.keys(props).filter(function (n) { return props[n].type === 'title'; })[0] || 'Name';
  const options = ((p[p.type] || {}).options || []).map(function (o) { return o.name; });
  const schema = { type: p.type, options: options, title: titleName };
  cache.put(key, JSON.stringify(schema), SYNC_CACHE_SECONDS);
  return schema;
}

function stateFilter_(c, schema, names) {
  const one = function (v) { const f = { property: c.state }; f[schema.type] = { equals: v }; return f; };
  return names.length === 1 ? one(names[0]) : { or: names.map(one) };
}

// États proposés au support : ceux de la colonne, plus l'état « Diag tech » et les états « à traiter » même s'ils n'existent pas encore.
function stateOptions_(c, schema) {
  const out = schema.options.slice();
  c.koStates.concat([c.diagState]).forEach(function (n) { if (out.indexOf(n) === -1) out.push(n); });
  return out;
}

function stateProp_(schema, name) {
  const v = {};
  v[schema.type] = { name: name };
  return v;
}

function queryRacks_(c, filter, maxPages) {
  const pages = [];
  let cursor = null;
  for (let n = 0; n < (maxPages || METHODS_MAX_PAGES); n++) {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const res = notion_('POST', '/databases/' + c.db + '/query', body);
    (res.results || []).forEach(function (p) { if (!p.archived) pages.push(p); });
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return pages;
}

function rackKind_(title) {
  const t = normText_(title);
  if (/^rack\b/.test(t)) return 'rack';
  if (/^casier\b/.test(t)) return 'casier';
  return 'autre';
}

// « Casier 10-2 » < « Casier 14-2 » < « Casier 110 » : tri par nombres, pas par lettres.
function naturalCompare_(a, b) {
  const pa = String(a).match(/\d+|\D+/g) || [];
  const pb = String(b).match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (/^\d/.test(x) && /^\d/.test(y)) { if (Number(x) !== Number(y)) return Number(x) - Number(y); }
    else if (x !== y) return x.localeCompare(y, 'fr');
  }
  return pa.length - pb.length;
}

function parseDiagBlock_(block) {
  const out = { state: '', at: '', by: '', comment: '' };
  const lines = block.replace(/\r/g, '').split('\n');
  let inComment = false;
  const comment = [];
  lines.forEach(function (line) {
    let m;
    if (inComment) { comment.push(line); return; }
    if ((m = line.match(/^État\s*:\s*(.*)$/))) out.state = m[1].trim();
    else if ((m = line.match(/^Date\s*:\s*(.*)$/))) out.at = m[1].trim();
    else if ((m = line.match(/^Tech\s*:\s*(.*)$/))) out.by = m[1].trim();
    else if ((m = line.match(/^Commentaire\s*:\s*(.*)$/))) { inComment = true; comment.push(m[1]); }
  });
  out.comment = comment.join('\n').trim();
  return out.state || out.comment ? out : null;
}

function parseDiagnoses_(text) {
  return String(text || '').split(/\n-{3,}\n/).map(parseDiagBlock_).filter(Boolean);
}

function mkProps_(name, value) { const o = {}; o[name] = value; return o; }

function rackItem_(page, c) {
  const title = titleOfPage_(page);
  const history = parseDiagnoses_(plain_((propOf_(page, c.comment) || { rich_text: [] }).rich_text));
  return {
    id: plainId_(page.id),
    title: title,
    kind: rackKind_(title),
    state: choiceNames_(propOf_(page, c.state))[0] || '',
    cause: choiceNames_(propOf_(page, c.cause)),
    updated: page.last_edited_time || '',
    diag: history[0] || null,
    history: history.slice(1, 10)
  };
}

function relationIds_(prop) {
  return prop && prop.type === 'relation' ? (prop.relation || []).map(function (r) { return plainId_(r.id); }) : [];
}

function getRacksOverview_(p) {
  const c = racksCfg_();
  const cache = CacheService.getScriptCache();
  let data = null;
  const cached = cache.get('racks:overview');
  if (cached) { try { data = JSON.parse(cached); } catch (err) { data = null; } }
  if (!data) {
    const schema = racksSchema_(c);
    const pages = queryRacks_(c, stateFilter_(c, schema, c.koStates));
    const bySite = {};
    pages.forEach(function (page) {
      const ids = relationIds_(propOf_(page, c.site));
      const sites = ids.length ? ids : [''];
      const kind = rackKind_(titleOfPage_(page));
      const diagnosed = choiceNames_(propOf_(page, c.state))[0] === c.diagState ||
        parseDiagnoses_(plain_((propOf_(page, c.comment) || { rich_text: [] }).rich_text)).length > 0;
      sites.forEach(function (sid) {
        const s = bySite[sid] || (bySite[sid] = { id: sid, casiers: 0, racks: 0, autres: 0, total: 0, diagnosed: 0 });
        s[kind === 'casier' ? 'casiers' : kind === 'rack' ? 'racks' : 'autres']++;
        s.total++;
        if (diagnosed) s.diagnosed++;
      });
    });
    const budget = { left: MACHINES_MAX_RELATIONS + 40 };
    const sites = Object.keys(bySite).map(function (sid) {
      const s = bySite[sid];
      s.title = sid ? (budget.left-- > 0 ? relationTitle_(sid) : '') || 'Site inconnu' : 'Sans site';
      return s;
    }).sort(function (a, b) { return a.title.localeCompare(b.title, 'fr'); });
    data = { rev: hash_(sites.map(function (s) { return [s.id, s.title, s.casiers, s.racks, s.autres, s.diagnosed].join('|'); }).join('\n')), total: pages.length, sites: sites };
    const text = JSON.stringify(data);
    if (text.length < 90000) cache.put('racks:overview', text, METHODS_LIST_CACHE_SECONDS);
  }
  if (p && p.sinceRev && p.sinceRev === data.rev) return { unchanged: true, rev: data.rev };
  return data;
}

function getRacks_(p) {
  const c = racksCfg_();
  const schema = racksSchema_(c);
  const site = p.site === 'none' ? 'none' : methodPageId_(p.site);
  const all = p.all === '1' || p.all === 'true';
  const filters = [];
  if (!all) filters.push(stateFilter_(c, schema, c.koStates));
  filters.push(site === 'none' ? { property: c.site, relation: { is_empty: true } } : { property: c.site, relation: { contains: site } });
  const pages = queryRacks_(c, filters.length === 1 ? filters[0] : { and: filters });
  const items = pages.map(function (page) { return rackItem_(page, c); })
    .sort(function (a, b) { return naturalCompare_(a.title, b.title); });
  const title = site === 'none' ? 'Sans site' : relationTitle_(site) || 'Site';
  const rev = hash_((all ? 'all' : 'ko') + '\n' + items.map(function (i) { return i.id + '|' + i.updated + '|' + i.title + '|' + i.state; }).join('\n'));
  if (p.sinceRev && p.sinceRev === rev) return { unchanged: true, rev: rev };
  return { rev: rev, all: all, site: { id: site, title: title }, states: RACK_STATES, stateOptions: stateOptions_(c, schema), diagState: c.diagState, koStates: c.koStates, items: items };
}

// Recherche d'un rack / casier par son numéro (ou son nom), avec filtres : site, état, type.
function searchRacks_(p) {
  const c = racksCfg_();
  const schema = racksSchema_(c);
  const q = String(p.q || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const kind = p.kind === 'casier' || p.kind === 'rack' ? p.kind : '';
  const filters = [];
  if (q) filters.push({ property: schema.title, title: { contains: q } });
  if (p.site) filters.push(p.site === 'none' ? { property: c.site, relation: { is_empty: true } } : { property: c.site, relation: { contains: methodPageId_(p.site) } });
  const st = String(p.state || '');
  if (st === '' ) filters.push(stateFilter_(c, schema, c.koStates));
  else if (st !== '*') filters.push(stateFilter_(c, schema, [st]));
  if (!q && !p.site && st === '*' && !kind) throw new ApiError_('BAD_REQUEST', 'Indiquez un numéro ou choisissez au moins un filtre.');
  const pages = queryRacks_(c, filters.length === 0 ? null : filters.length === 1 ? filters[0] : { and: filters }, 2);
  const budget = { left: 40 };
  let items = pages.map(function (page) {
    const it = rackItem_(page, c);
    const ids = relationIds_(propOf_(page, c.site));
    it.siteId = ids[0] || '';
    it.siteTitle = ids.length ? (budget.left-- > 0 ? relationTitle_(ids[0]) : '') || 'Site' : 'Sans site';
    return it;
  }).filter(function (it) { return !kind || it.kind === kind; });
  // Le numéro exact d'abord (« 14 » avant « 114 » et « 1141 »), puis l'ordre naturel.
  const digits = q.match(/\d+/g) || [];
  const rank = function (it) { const t = it.title.match(/\d+/g) || []; return digits.length && digits.every(function (d, i) { return t[i] === d; }) ? 0 : 1; };
  items.sort(function (a, b) { return rank(a) - rank(b) || naturalCompare_(a.title, b.title); });
  const truncated = items.length > 100 || pages.length >= 200;
  items = items.slice(0, 100);
  return { items: items, truncated: truncated, stateOptions: stateOptions_(c, schema), diagState: c.diagState, koStates: c.koStates, states: RACK_STATES };
}

function postRackDiagnosis_(body) {
  const c = racksCfg_();
  const pageId = methodPageId_(body.pageId);
  const by = cleanName_(body.name);
  if (!by) throw new ApiError_('AUTHOR_REQUIRED', 'Indiquez votre nom (Réglages) avant d’enregistrer un diagnostic.');
  const st = RACK_STATES.filter(function (s) { return s.id === body.state; })[0];
  if (!st) throw new ApiError_('BAD_REQUEST', 'État de diagnostic inconnu.');
  const comment = String(body.comment || '').replace(/\r/g, '').replace(/^-{3,}$/gm, '—').replace(/\n{3,}/g, '\n\n').trim();
  if (comment.length > RACK_COMMENT_MAX) throw new ApiError_('BAD_REQUEST', 'Commentaire trop long (' + RACK_COMMENT_MAX + ' caractères au plus).');
  const schema = racksSchema_(c);
  const block = 'État : ' + st.label + '\nDate : ' + stamp_() + '\nTech : ' + by + '\nCommentaire : ' + comment;
  const r = appendToTextProp_(pageId, c.comment, block, {
    separator: RACK_SEPARATOR, atStart: true, replace: c.replace, dedupeId: String(body.id || '').slice(0, 64),
    check: function (page) {
      assertRackPage_(page, c);
      // Seul un élément « à traiter » passe en « Diag tech » ; un élément déjà remis en service garde son état.
      if (schema.type === 'status' && schema.options.indexOf(c.diagState) === -1 && c.koStates.indexOf(choiceNames_(propOf_(page, c.state))[0] || '') > -1) {
        throw new ApiError_('CONFIG_INVALID', 'La colonne « ' + c.state + ' » (Statut) n’a pas la valeur « ' + c.diagState + ' » : ajoutez-la dans Notion.');
      }
    },
    extra: function (page) {
      const now = choiceNames_(propOf_(page, c.state))[0] || '';
      return c.koStates.indexOf(now) > -1 && now !== c.diagState ? mkProps_(c.state, stateProp_(schema, c.diagState)) : {};
    }
  });
  if (r.duplicate) return { duplicate: true };
  CacheService.getScriptCache().remove('racks:overview');
  const all = parseDiagnoses_(r.text);
  const nowState = choiceNames_(propOf_(r.page, c.state))[0] || '';
  return { duplicate: false, diag: all[0] || null, history: all.slice(1, 10),
    state: c.koStates.indexOf(nowState) > -1 ? c.diagState : nowState };
}

/* ──────────────── Commentaires Notion de la page + validation (support) ──────────────── */

function commentsForbidden_(err) {
  if (err instanceof ApiError_ && err.code === 'NOTION_FORBIDDEN') {
    return new ApiError_('COMMENTS_FORBIDDEN', 'Notion refuse l’accès aux commentaires : dans notion.so/my-integrations, donnez à l’intégration les capacités « Read comments » et « Insert comments », puis réessayez.');
  }
  return err;
}

function userName_(id) {
  if (!id) return '';
  const cache = CacheService.getScriptCache();
  const key = 'user:' + id;
  const hit = cache.get(key);
  if (hit !== null && hit !== undefined) return hit;
  let name = '';
  try { name = (notion_('GET', '/users/' + id) || {}).name || ''; } catch (err) { if (!(err instanceof ApiError_)) throw err; }
  cache.put(key, name, MACHINES_RELATION_TTL);
  return name;
}

function fmtIso_(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm');
}

// Commentaires écrits dans Notion sur la page (c'est là que l'équipe note ses diagnostics). Les commentaires publiés par
// l'application portent « [Prénom Nom] » en tête ; les autres sont attribués à leur auteur Notion (si l'intégration peut lire les utilisateurs).
function getRackComments_(p) {
  const c = racksCfg_();
  const pageId = methodPageId_(p.pageId);
  assertRackPage_(notion_('GET', '/pages/' + pageId), c);
  const out = [];
  try {
    let cursor = null;
    for (let n = 0; n < 3; n++) {
      const res = notion_('GET', '/comments?block_id=' + pageId + '&page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
      (res.results || []).forEach(function (cm) {
        const text = plain_(cm.rich_text);
        const m = text.match(/^\[([^\]]{1,80})\]\s*([\s\S]*)$/);
        out.push({
          id: cm.id,
          at: fmtIso_(cm.created_time),
          by: m ? m[1] : userName_(cm.created_by && cm.created_by.id) || 'Notion',
          text: m ? m[2] : text
        });
      });
      if (!res.has_more) break;
      cursor = res.next_cursor;
    }
  } catch (err) {
    throw commentsForbidden_(err);
  }
  return { comments: out };
}

function createNotionComment_(pageId, text) {
  try {
    notion_('POST', '/comments', { parent: { page_id: pageId }, rich_text: richChunks_(text) });
  } catch (err) {
    throw commentsForbidden_(err);
  }
}

function postRackComment_(body) {
  const c = racksCfg_();
  const pageId = methodPageId_(body.pageId);
  const by = cleanName_(body.name);
  if (!by) throw new ApiError_('AUTHOR_REQUIRED', 'Indiquez votre nom (Réglages) avant de commenter.');
  const text = String(body.text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new ApiError_('BAD_REQUEST', 'Le commentaire est vide.');
  if (text.length > RACK_COMMENT_MAX) throw new ApiError_('BAD_REQUEST', 'Commentaire trop long (' + RACK_COMMENT_MAX + ' caractères au plus).');
  const cache = CacheService.getScriptCache();
  const dedupe = body.id ? 'w:' + String(body.id).slice(0, 64) : '';
  if (dedupe && cache.get(dedupe)) return { duplicate: true };
  assertRackPage_(notion_('GET', '/pages/' + pageId), c);
  createNotionComment_(pageId, '[' + by + '] ' + text);
  if (dedupe) cache.put(dedupe, '1', SYNC_CACHE_SECONDS);
  const res = getRackComments_({ pageId: pageId });
  res.duplicate = false;
  return res;
}

// Profil support : valide (ou change) l'état d'un rack / casier. Trace dans les commentaires Notion si l'intégration le permet.
function postRackState_(body) {
  const c = racksCfg_();
  const schema = racksSchema_(c);
  const pageId = methodPageId_(body.pageId);
  const by = cleanName_(body.name);
  if (!by) throw new ApiError_('AUTHOR_REQUIRED', 'Indiquez votre nom (Réglages) avant de changer un état.');
  const state = String(body.state || '').trim();
  if (stateOptions_(c, schema).indexOf(state) === -1) throw new ApiError_('BAD_REQUEST', 'État inconnu : « ' + state + ' ».');
  const cache = CacheService.getScriptCache();
  const dedupe = body.id ? 'w:' + String(body.id).slice(0, 64) : '';
  if (dedupe && cache.get(dedupe)) return { duplicate: true };
  const page = notion_('GET', '/pages/' + pageId);
  assertRackPage_(page, c);
  const before = choiceNames_(propOf_(page, c.state))[0] || '';
  if (before !== state) {
    notion_('PATCH', '/pages/' + pageId, { properties: mkProps_(c.state, stateProp_(schema, state)) });
    try { createNotionComment_(pageId, '[' + by + '] État : ' + (before || '—') + ' → ' + state); } catch (err) { /* trace facultative */ }
  }
  if (dedupe) cache.put(dedupe, '1', SYNC_CACHE_SECONDS);
  cache.remove('racks:overview');
  return { duplicate: false, state: state, before: before };
}

// À lancer dans l'éditeur Apps Script : vérifie l'accès à la base, la colonne de commentaire et les sites.
function testRacks() {
  const c = racksCfg_();
  const o = getRacksOverview_({});
  Logger.log('%s rack(s)/casier(s) KO sur %s site(s)', o.total, o.sites.length);
  o.sites.slice(0, 20).forEach(function (s) { Logger.log('  %s : %s casier(s), %s rack(s), %s diagnostiqué(s)', s.title, s.casiers, s.racks, s.diagnosed); });
  const first = queryRacks_(c, stateFilter_(c, racksSchema_(c), c.koStates), 1)[0];
  if (first) {
    const has = propOf_(first, c.comment);
    Logger.log(has && has.type === 'rich_text'
      ? 'Colonne « ' + c.comment + ' » : OK'
      : 'ATTENTION : la colonne « ' + c.comment + ' » (type Texte) n’existe pas : créez-la dans la base Notion.');
  }
}
