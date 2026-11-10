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

function readActionPage_(ap, cfg, budget) {
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
    url: ap.url || ''
  };
}

// Actions liées à la page de mission. Une action illisible (page non partagée avec l'intégration) est signalée, pas bloquante.
function readActions_(page, warnings) {
  const cfg = actionsCfg_();
  const ids = relationIdsOf_(page, cfg).slice(0, ACTIONS_MAX);
  const budget = { left: 40 };
  const out = [];
  ids.forEach(function (id) {
    try {
      const ap = notion_('GET', '/pages/' + id);
      if (ap.archived || ap.in_trash) return;
      out.push(readActionPage_(ap, cfg, budget));
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
    return { duplicate: false, state: state, label: state ? ACTION_STATES[state] : '' };
  } finally {
    lock.releaseLock();
  }
}
