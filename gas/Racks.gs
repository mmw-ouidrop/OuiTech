/**
 * ============================================================================
 *  Racks.gs — Racks et casiers KO (base Notion « Casiers et Racks KO CZ »)
 * ============================================================================
 *
 *  Le technicien choisit un site, voit ses racks et casiers KO, et note son diagnostic. Le diagnostic n'est PAS
 *  écrit dans la colonne « État » : il va dans une colonne texte « Commentaire technicien », pour que l'équipe
 *  le vérifie avant toute remise en service. Une entrée = 4 lignes :
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
 *    POST { action:"rackDiagnosis", pageId, state, comment, id, name }
 *         → { duplicate:false, diag, history }   (id : identifiant unique de l'envoi, rejeu sans effet)
 *
 *  PROPRIÉTÉS DE SCRIPT (facultatives)
 *    RACKS_DB_ID          Défaut : 27e37d20ee35806294f7f3bf21b1d545
 *    RACKS_PROP_SITE      Défaut : 🤖 Site        (relation vers la liste des machines)
 *    RACKS_PROP_STATE     Défaut : État           (sélection ou statut)
 *    RACKS_PROP_CAUSE     Défaut : Cause          (multi-sélection, facultative)
 *    RACKS_PROP_COMMENT   Défaut : Commentaire technicien   (colonne TEXTE à créer dans la base)
 *    RACKS_KO_STATES      états affichés, séparés par « | ». Défaut : KO
 *    RACKS_COMMENT_MODE   append (défaut : on garde l'historique) | replace
 *
 *  L'intégration Notion doit être connectée à la base ET à la liste des machines (pour le nom des sites).
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
    koStates: nameList_('RACKS_KO_STATES', ['KO']),
    replace: String(cfg_('RACKS_COMMENT_MODE', 'append')).toLowerCase() === 'replace'
  };
}

function assertRackPage_(page, c) {
  const parent = page && page.parent;
  if (!parent || plainId_(parent.database_id) !== c.db || page.archived) throw new ApiError_('NOT_FOUND', 'Rack ou casier introuvable');
}

// Filtre « État = KO » adapté au type réel de la colonne (sélection ou statut), lu une fois puis gardé 6 h.
function koFilter_(c) {
  const cache = CacheService.getScriptCache();
  const key = 'racks:stype:' + c.db + ':' + c.state;
  let type = cache.get(key);
  if (!type) {
    const db = notion_('GET', '/databases/' + c.db);
    const p = (db.properties || {})[c.state];
    if (!p) throw new ApiError_('CONFIG_INVALID', 'Colonne « ' + c.state + ' » introuvable dans la base des racks (RACKS_PROP_STATE).');
    if (p.type !== 'select' && p.type !== 'status') throw new ApiError_('CONFIG_INVALID', 'La colonne « ' + c.state + ' » doit être de type Sélection ou Statut.');
    type = p.type;
    cache.put(key, type, SYNC_CACHE_SECONDS);
  }
  const one = function (v) { const f = { property: c.state }; f[type] = { equals: v }; return f; };
  return c.koStates.length === 1 ? one(c.koStates[0]) : { or: c.koStates.map(one) };
}

function queryRacks_(c, filter) {
  const pages = [];
  let cursor = null;
  for (let n = 0; n < METHODS_MAX_PAGES; n++) {
    const body = { page_size: 100, filter: filter };
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

function rackItem_(page, c) {
  const title = titleOfPage_(page);
  const history = parseDiagnoses_(plain_((propOf_(page, c.comment) || { rich_text: [] }).rich_text));
  return {
    id: plainId_(page.id),
    title: title,
    kind: rackKind_(title),
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
    const pages = queryRacks_(c, koFilter_(c));
    const bySite = {};
    pages.forEach(function (page) {
      const ids = relationIds_(propOf_(page, c.site));
      const sites = ids.length ? ids : [''];
      const kind = rackKind_(titleOfPage_(page));
      const diagnosed = parseDiagnoses_(plain_((propOf_(page, c.comment) || { rich_text: [] }).rich_text)).length > 0;
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
  const site = p.site === 'none' ? 'none' : methodPageId_(p.site);
  const filters = [koFilter_(c)];
  filters.push(site === 'none' ? { property: c.site, relation: { is_empty: true } } : { property: c.site, relation: { contains: site } });
  const pages = queryRacks_(c, { and: filters });
  const items = pages.map(function (page) { return rackItem_(page, c); })
    .sort(function (a, b) { return naturalCompare_(a.title, b.title); });
  const title = site === 'none' ? 'Sans site' : relationTitle_(site) || 'Site';
  const rev = hash_(items.map(function (i) { return i.id + '|' + i.updated + '|' + i.title; }).join('\n'));
  if (p.sinceRev && p.sinceRev === rev) return { unchanged: true, rev: rev };
  return { rev: rev, site: { id: site, title: title }, states: RACK_STATES, items: items };
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
  const block = 'État : ' + st.label + '\nDate : ' + stamp_() + '\nTech : ' + by + '\nCommentaire : ' + comment;
  const r = appendToTextProp_(pageId, c.comment, block, {
    separator: RACK_SEPARATOR, atStart: true, replace: c.replace, dedupeId: String(body.id || '').slice(0, 64),
    check: function (page) { assertRackPage_(page, c); }
  });
  if (r.duplicate) return { duplicate: true };
  CacheService.getScriptCache().remove('racks:overview');
  const all = parseDiagnoses_(r.text);
  return { duplicate: false, diag: all[0] || null, history: all.slice(1, 10) };
}

// À lancer dans l'éditeur Apps Script : vérifie l'accès à la base, la colonne de commentaire et les sites.
function testRacks() {
  const c = racksCfg_();
  const o = getRacksOverview_({});
  Logger.log('%s rack(s)/casier(s) KO sur %s site(s)', o.total, o.sites.length);
  o.sites.slice(0, 20).forEach(function (s) { Logger.log('  %s : %s casier(s), %s rack(s), %s diagnostiqué(s)', s.title, s.casiers, s.racks, s.diagnosed); });
  const first = queryRacks_(c, koFilter_(c))[0];
  if (first) {
    const has = propOf_(first, c.comment);
    Logger.log(has && has.type === 'rich_text'
      ? 'Colonne « ' + c.comment + ' » : OK'
      : 'ATTENTION : la colonne « ' + c.comment + ' » (type Texte) n’existe pas : créez-la dans la base Notion.');
  }
}
