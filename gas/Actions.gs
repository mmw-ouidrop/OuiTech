/**
 * ACTIONS À RÉALISER — pages Notion liées à la fiche d'intervention (colonne relation « Actions prévues »).
 *
 *  · getIntervention joint la liste des actions (titre, type, durée, description, outillage, fichiers, éléments liés).
 *  · Le technicien attribue un état et/ou écrit un commentaire : la route POST `actionComment` les dépose dans
 *    les COMMENTAIRES de la page Action (rien d'autre n'est modifié dans l'action).
 *
 *  Propriétés de script (toutes facultatives, valeurs par défaut ci-dessous) :
 *    ACTIONS_PROP_NAME     Relation de la fiche            Défaut : Actions prévues
 *    ACTIONS_PROP_TYPE     Type                            Défaut : Type
 *    ACTIONS_PROP_STATUS   Statut (lecture seule)          Défaut : Status
 *    ACTIONS_PROP_TIME     Durée                           Défaut : Temps nécessaire
 *    ACTIONS_PROP_DESC     Description                     Défaut : Description
 *    ACTIONS_PROP_TOOLS    Outillage                       Défaut : Matériel ou outillage spécifique
 *    ACTIONS_PROPS_FILES   Colonnes fichiers (liste)       Défaut : Datasheet / Plans, Méthodes
 *    ACTIONS_PROPS_LINKS   Relations affichées (liste)     Défaut : Casiers et Racks KO, Tickets
 *
 *  L'intégration Notion doit avoir les capacités « Read comments » et « Insert comments ».
 */

const ACTIONS_MAX = 20;
const ACTION_COMMENT_MAX = 1500;
const ACTION_STATES = {
  todo:    'À faire',
  doing:   'En cours',
  done:    'Terminée',
  blocked: 'Impossible'
};

// « [Prénom Nom] État : Terminée · FI-313\ntexte » ou « [Prénom Nom] Commentaire · FI-313\ntexte » (voir postActionComment_).
function parseActionComment_(text) {
  const m = String(text || '').replace(/\r/g, '').match(/^\[([^\]]{1,80})\]\s*(?:État\s*:\s*([^\n·]+?)|Commentaire)\s*(?:·\s*([^\n]+?))?\s*(?:\n([\s\S]*))?$/);
  if (!m) return null;
  let state = '';
  if (m[2]) {
    const label = propKey_(m[2]);
    Object.keys(ACTION_STATES).forEach(function (k) { if (propKey_(ACTION_STATES[k]) === label) state = k; });
    if (!state) return null;
  }
  return { by: m[1].trim(), state: state, ref: (m[3] || '').trim(), text: (m[4] || '').trim() };
}

// Historique d'une action : commentaires déposés par l'application (tous techniciens), du plus ancien au plus récent.
function readActionEntries_(actionId, reference) {
  const out = [];
  let cursor = null;
  for (let n = 0; n < 3; n++) {
    let res;
    try {
      res = notion_('GET', '/comments?block_id=' + actionId + '&page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
    } catch (err) {
      throw commentsForbidden_(err);
    }
    (res.results || []).forEach(function (cm) {
      const e = parseActionComment_(plain_(cm.rich_text));
      if (!e) return;
      if (e.ref && reference && propKey_(e.ref) !== propKey_(reference)) return;
      out.push({ id: cm.id, by: e.by, state: e.state, text: e.text, at: new Date(cm.created_time).getTime() || 0 });
    });
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  out.sort(function (a, b) { return a.at - b.at; });
  return out.slice(-50);
}

function actionsCfg_() {
  return {
    rel:    cfg_('ACTIONS_PROP_NAME', 'Actions prévues'),
    type:   cfg_('ACTIONS_PROP_TYPE', 'Type'),
    status: cfg_('ACTIONS_PROP_STATUS', 'Status'),
    time:   cfg_('ACTIONS_PROP_TIME', 'Temps nécessaire'),
    desc:   cfg_('ACTIONS_PROP_DESC', 'Description'),
    tools:  cfg_('ACTIONS_PROP_TOOLS', 'Matériel ou outillage spécifique'),
    files:  nameList_('ACTIONS_PROPS_FILES', ['Datasheet / Plans', 'Méthodes']),
    links:  nameList_('ACTIONS_PROPS_LINKS', ['Casiers et Racks KO', 'Tickets'])
  };
}

// Colonne retrouvée sans tenir compte de la casse, des accents ni d'un emoji devant le nom (« ☠️ Casiers et Racks KO »).
function findProp_(page, wanted) {
  const want = propKey_(wanted);
  const names = Object.keys(page.properties || {});
  for (let i = 0; i < names.length; i++) {
    if (propKey_(names[i]) === want) return names[i];
  }
  const tail = function (n) { return propKey_(n).replace(/^[^a-z0-9]+/, ''); };
  for (let j = 0; j < names.length; j++) {
    if (tail(names[j]) === tail(wanted)) return names[j];
  }
  return null;
}

function relationIdsOf_(page, cfg) {
  const name = findProp_(page, cfg.rel);
  const prop = name ? page.properties[name] : null;
  return prop && prop.type === 'relation' ? (prop.relation || []).map(function (r) { return plainId_(r.id); }) : [];
}

function readActionPage_(ap, cfg, budget, entries) {
  const text = function (wanted) {
    const n = findProp_(ap, wanted);
    return n ? textOfProp_(ap.properties[n]) : '';
  };
  const files = [];
  const fileProps = [];
  cfg.files.forEach(function (w) {
    const n = findProp_(ap, w);
    if (!n || ap.properties[n].type !== 'files') return;
    fileProps.push(n);
    propertyFiles_(n, ap.properties[n]).forEach(function (f) { files.push(f); });
  });
  const links = [];
  cfg.links.forEach(function (w) {
    const n = findProp_(ap, w);
    if (!n || ap.properties[n].type !== 'relation') return;
    const items = relationTitles_(ap.properties[n], budget);
    const total = (ap.properties[n].relation || []).length;
    if (total) links.push({ label: n.replace(/^[^A-Za-z0-9À-ÿ]+/, '').trim(), items: items, total: total });
  });
  return {
    id: plainId_(ap.id),
    title: titleOfPage_(ap) || 'Action',
    type: text(cfg.type),
    status: text(cfg.status),
    time: text(cfg.time),
    description: text(cfg.desc),
    tools: text(cfg.tools),
    files: files,
    links: links,
    entries: entries || [],
    url: ap.url || ''
  };
}

// Actions liées à la page de mission. Une action illisible (page non partagée avec l'intégration) est signalée, pas bloquante.
function readActions_(page, warnings) {
  const cfg = actionsCfg_();
  const ids = relationIdsOf_(page, cfg).slice(0, ACTIONS_MAX);
  const budget = { left: 40 };
  const reference = referenceOf_(page, '');
  const out = [];
  let commentsWarned = false;
  ids.forEach(function (id) {
    try {
      const ap = notion_('GET', '/pages/' + id);
      if (ap.archived || ap.in_trash) return;
      let entries = [];
      try {
        entries = readActionEntries_(plainId_(ap.id), reference);
      } catch (err) {
        if (!(err instanceof ApiError_)) throw err;
        if (!commentsWarned) warnings.push({ code: 'ACTION_COMMENTS_UNREADABLE', message: err.message });
        commentsWarned = true;
      }
      out.push(readActionPage_(ap, cfg, budget, entries));
    } catch (err) {
      if (!(err instanceof ApiError_)) throw err;
      warnings.push({ code: 'ACTION_UNREADABLE', message: 'Une action liée n’a pas pu être lue (' + err.message + ')' });
    }
  });
  return out;
}

// Mission valide + action bien liée à cette mission (on ne commente pas n'importe quelle page).
function assertActionOfMission_(missionId, actionId) {
  assertPageInDatabase_(missionId);
  const mission = notion_('GET', '/pages/' + missionId);
  if (relationIdsOf_(mission, actionsCfg_()).indexOf(actionId) === -1) {
    throw new ApiError_('FORBIDDEN', 'Cette action n’est pas liée à cette fiche d’intervention');
  }
}

function postActionComment_(body) {
  const missionId = methodPageId_(body.missionId);
  const actionId = methodPageId_(body.pageId);
  const by = cleanName_(body.name);
  if (!by) throw new ApiError_('AUTHOR_REQUIRED', 'Indiquez votre nom (Réglages) avant de commenter.');
  const state = String(body.state || '').trim();
  if (state && !ACTION_STATES[state]) throw new ApiError_('BAD_REQUEST', 'État inconnu : « ' + state + ' ».');
  const text = String(body.text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!state && !text) throw new ApiError_('BAD_REQUEST', 'Choisissez un état ou écrivez un commentaire.');
  if (text.length > ACTION_COMMENT_MAX) throw new ApiError_('BAD_REQUEST', 'Commentaire trop long (' + ACTION_COMMENT_MAX + ' caractères au plus).');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const cache = CacheService.getScriptCache();
    const dedupe = body.id ? 'w:' + String(body.id).slice(0, 64) : '';
    if (dedupe && cache.get(dedupe)) return { duplicate: true };
    assertActionOfMission_(missionId, actionId);
    const ref = String(body.reference || '').replace(/[^\w\- ]/g, '').slice(0, 40);
    let msg = '[' + by + '] ' + (state ? 'État : ' + ACTION_STATES[state] : 'Commentaire');
    if (ref) msg += ' · ' + ref;
    if (text) msg += '\n' + text;
    createNotionComment_(actionId, msg);
    if (dedupe) cache.put(dedupe, '1', SYNC_CACHE_SECONDS);
    // La colonne « Compte rendu » de la fiche reprend aussitôt l'état et le commentaire (jamais bloquant).
    let st = null;
    try { st = loadState_(missionId); } catch (err) { st = emptyState_(); }
    writePageSummarySafe_(missionId, st, { forceActions: true, reference: ref });
    return { duplicate: false, state: state, label: state ? ACTION_STATES[state] : '' };
  } finally {
    lock.releaseLock();
  }
}

// Actions seules (état et commentaires de tous les techniciens), pour rafraîchir l'écran sans relire tout le template.
function getActions_(p) {
  const page = findPageByReference_(p.id);
  const warnings = [];
  return { actions: readActions_(page, warnings), warnings: warnings };
}
