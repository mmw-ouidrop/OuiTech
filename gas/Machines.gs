/**
 * ============================================================================
 *  Machines.gs — Liste des machines (base Notion « Liste des machines »)
 * ============================================================================
 *
 *  Lecture seule, mêmes principes que Methods.gs (réutilise ses fonctions).
 *
 *    GET ?action=machines&sinceRev=…&session=…
 *        → { unchanged:true, rev } ou
 *          { rev, items:[ { id, title, city, address, region, status, active, type, project, updated } ] }
 *
 *    GET ?action=machine&id=<pageId>&sinceEdited=…&session=…
 *        → { unchanged:true } ou la fiche :
 *          { id, title, status, active, type, project, address, mapAddress, keybox,
 *            wifi:{ raw, ssid, password }|null, connections:[…], options:[…], parts, notes,
 *            target, since, region, client, photos:[{key,name}],
 *            extras:[{label,value}],      colonnes non prévues ci-dessus, affichées telles quelles
 *            nodes:[…], updated, warnings }   corps de la page (même format que les méthodes)
 *
 *    GET ?action=machineMedia&page=<pageId>&key=<clé>&mode=data|url&session=…
 *        → comme methodMedia (photos du site, ≤ 6 Mo en base64, sinon lien frais)
 *
 *  Les relations Notion (région, client) ne donnent que des identifiants : leurs titres sont lus
 *  une fois puis gardés 6 h. Les relations « Actions » (très longues) sont ignorées.
 *
 *  PROPRIÉTÉS DE SCRIPT (toutes facultatives)
 *    MACHINES_DB_ID          Défaut : 26b37d20ee3580f3b76dc45d5073b74c
 *    MACHINES_PROP_<NOM>     nom de la colonne, <NOM> parmi : ADDRESS (Adresse du site), MAP (Adresse du site (Carte)),
 *                            KEYBOX (Code boite à clé), WIFI (Wi-Fi), STATUS (État Machine), ACTIVE (En exploitation),
 *                            TYPE (Type), PROJECT (N°Projet), CONNECTION (Connexion machine), OPTIONS (Options machine),
 *                            PARTS (Colis Pièces de maintenance), NOTES (Autres informations du site),
 *                            TARGET (Objectif commande / jour), SINCE (Date de mise en service),
 *                            REGION (Régions de stock), CLIENT (Clients), PHOTOS (Photo site)
 *    MACHINES_HIDDEN_PROPERTIES  colonnes jamais publiées, séparées par « | ».
 *                            Défaut : 🎟️ Actions Droppers 1|Liste des projets|Date Création
 *    MACHINES_ACTIVE_YES     valeurs « en exploitation », séparées par « | ». Défaut : OUI|Oui|Yes|true
 *
 *  L'intégration Notion doit être connectée à la base (⋯ ▸ Connexions).
 *  Les codes d'accès (boîte à clés, Wi-Fi) ne sont servis qu'à une session valide (technicien ou support).
 * ============================================================================
 */

const MACHINES_DB_DEFAULT = '26b37d20ee3580f3b76dc45d5073b74c';
const MACHINES_PROPS = {
  ADDRESS: 'Adresse du site', MAP: 'Adresse du site (Carte)', KEYBOX: 'Code boite à clé', WIFI: 'Wi-Fi',
  STATUS: 'État Machine', ACTIVE: 'En exploitation', TYPE: 'Type', PROJECT: 'N°Projet',
  CONNECTION: 'Connexion machine', OPTIONS: 'Options machine', PARTS: 'Colis Pièces de maintenance',
  NOTES: 'Autres informations du site', TARGET: 'Objectif commande / jour', SINCE: 'Date de mise en service',
  REGION: 'Régions de stock', CLIENT: 'Clients', PHOTOS: 'Photo site'
};
const MACHINES_HIDDEN_DEFAULT = ['🎟️ Actions Droppers 1', 'Liste des projets', 'Date Création'];
const MACHINES_RELATION_TTL = 21600;
const MACHINES_MAX_RELATIONS = 40;

function machinesCfg_() {
  const c = { db: String(cfg_('MACHINES_DB_ID', MACHINES_DB_DEFAULT)).replace(/-/g, '') };
  Object.keys(MACHINES_PROPS).forEach(function (k) { c[k] = cfg_('MACHINES_PROP_' + k, MACHINES_PROPS[k]); });
  c.hidden = nameList_('MACHINES_HIDDEN_PROPERTIES', MACHINES_HIDDEN_DEFAULT);
  c.activeYes = nameList_('MACHINES_ACTIVE_YES', ['OUI', 'Oui', 'Yes', 'true']);
  return c;
}

function assertMachinePage_(page, c) {
  const parent = page && page.parent;
  if (!parent || plainId_(parent.database_id) !== c.db || page.archived) throw new ApiError_('NOT_FOUND', 'Machine introuvable');
}

// Titre d'une page liée (région, client), gardé 6 h. Page non partagée avec l'intégration : texte vide.
function relationTitle_(id) {
  const cache = CacheService.getScriptCache();
  const key = 'rel:' + plainId_(id);
  const hit = cache.get(key);
  if (hit !== null && hit !== undefined) return hit;
  let title = '';
  try {
    title = titleOfPage_(notion_('GET', '/pages/' + plainId_(id)));
  } catch (err) {
    if (!(err instanceof ApiError_)) throw err;
  }
  cache.put(key, title, MACHINES_RELATION_TTL);
  return title;
}

function relationTitles_(prop, budget) {
  if (!prop || prop.type !== 'relation') return [];
  const out = [];
  (prop.relation || []).slice(0, 5).forEach(function (r) {
    if (budget.left <= 0) return;
    budget.left--;
    const t = relationTitle_(r.id);
    if (t) out.push(t);
  });
  return out;
}

function isActive_(prop, c) {
  if (!prop) return null;
  if (prop.type === 'checkbox') return !!prop.checkbox;
  const v = choiceNames_(prop)[0] || textOfProp_(prop);
  if (!v) return null;
  return c.activeYes.indexOf(v) > -1;
}

function cityOf_(address) {
  const m = String(address || '').match(/\b\d{5}\s+([^,]+)/);
  return m ? m[1].trim() : '';
}

// « SSID : bolt_7e48d4 \n MDP : … » → { raw, ssid, password } ; texte libre : seulement raw.
function parseWifi_(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const ssid = raw.match(/(?:ssid|r[ée]seau|nom)\s*[:=]\s*([^\n\r]+)/i);
  const pwd = raw.match(/(?:mdp|mot de passe|password|pass|cl[ée])\s*[:=]\s*([^\n\r]+)/i);
  return { raw: raw, ssid: ssid ? ssid[1].trim() : '', password: pwd ? pwd[1].trim() : '' };
}

function getMachines_(p) {
  const c = machinesCfg_();
  const cache = CacheService.getScriptCache();
  let list = null;
  const cached = cache.get('machines:list');
  if (cached) {
    try { list = JSON.parse(cached); } catch (err) { list = null; }
  }
  if (!list) {
    const items = [];
    const budget = { left: MACHINES_MAX_RELATIONS };
    let cursor = null;
    for (let n = 0; n < METHODS_MAX_PAGES; n++) {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = notion_('POST', '/databases/' + c.db + '/query', body);
      (res.results || []).forEach(function (page) {
        if (page.archived) return;
        const title = titleOfPage_(page);
        if (!title) return;
        const address = textOfProp_(propOf_(page, c.ADDRESS));
        items.push({
          id: plainId_(page.id),
          title: title,
          address: address,
          city: cityOf_(textOfProp_(propOf_(page, c.MAP)) || address),
          region: relationTitles_(propOf_(page, c.REGION), budget)[0] || '',
          status: choiceNames_(propOf_(page, c.STATUS))[0] || '',
          active: isActive_(propOf_(page, c.ACTIVE), c),
          type: choiceNames_(propOf_(page, c.TYPE))[0] || '',
          project: textOfProp_(propOf_(page, c.PROJECT)),
          updated: page.last_edited_time || ''
        });
      });
      if (!res.has_more) break;
      cursor = res.next_cursor;
    }
    items.sort(function (a, b) { return a.title.localeCompare(b.title, 'fr'); });
    list = { rev: hash_(items.map(function (i) { return [i.id, i.updated, i.title, i.region, i.status, i.active].join('|'); }).join('\n')), items: items };
    const text = JSON.stringify(list);
    if (text.length < 90000) cache.put('machines:list', text, METHODS_LIST_CACHE_SECONDS);
  }
  if (p && p.sinceRev && p.sinceRev === list.rev) return { unchanged: true, rev: list.rev };
  return list;
}

function getMachine_(p) {
  const c = machinesCfg_();
  const pageId = methodPageId_(p.id);
  const page = notion_('GET', '/pages/' + pageId);
  assertMachinePage_(page, c);
  if (p.sinceEdited && p.sinceEdited === page.last_edited_time) return { unchanged: true, updated: page.last_edited_time };

  const budget = { calls: 0, truncated: false };
  const nodes = convertMethodBlocks_(fetchMethodBlocks_(pageId, 0, budget));
  const rel = { left: MACHINES_MAX_RELATIONS };
  const text = function (k) { return textOfProp_(propOf_(page, c[k])); };
  const list = function (k) { return choiceNames_(propOf_(page, c[k])); };

  // Colonnes non prévues : affichées telles quelles (une nouvelle colonne apparaît sans toucher au code).
  const known = Object.keys(MACHINES_PROPS).map(function (k) { return c[k]; });
  const extras = [];
  Object.keys(page.properties || {}).forEach(function (name) {
    const prop = page.properties[name];
    if (prop.type === 'title' || known.indexOf(name) > -1 || c.hidden.indexOf(name) > -1) return;
    if (prop.type === 'relation' || prop.type === 'rollup' || prop.type === 'files') return;
    const v = textOfProp_(prop);
    if (v) extras.push({ label: name, value: v });
  });

  const photos = filesOfProp_(propOf_(page, c.PHOTOS)).map(function (f, i) {
    return { key: 'p:' + c.PHOTOS + ':' + i, name: f.name || '' };
  });
  const warnings = [];
  if (budget.truncated) warnings.push({ code: 'TRUNCATED', message: 'Page très longue : la fin n’est pas affichée' });

  return {
    id: pageId,
    title: titleOfPage_(page),
    status: list('STATUS')[0] || '',
    active: isActive_(propOf_(page, c.ACTIVE), c),
    type: list('TYPE')[0] || '',
    project: text('PROJECT'),
    address: text('ADDRESS'),
    mapAddress: text('MAP'),
    keybox: text('KEYBOX'),
    wifi: parseWifi_(text('WIFI')),
    connections: list('CONNECTION'),
    options: list('OPTIONS'),
    parts: text('PARTS'),
    notes: text('NOTES'),
    target: text('TARGET'),
    since: text('SINCE'),
    region: relationTitles_(propOf_(page, c.REGION), rel).join(', '),
    client: relationTitles_(propOf_(page, c.CLIENT), rel).join(', '),
    photos: photos,
    extras: extras,
    nodes: nodes,
    updated: page.last_edited_time || '',
    warnings: warnings
  };
}

function getMachineMedia_(p) {
  const c = machinesCfg_();
  const pageId = methodPageId_(p.page);
  const page = notion_('GET', '/pages/' + pageId);
  assertMachinePage_(page, c);
  return deliverMedia_(mediaSource_(page, p.key, [c.PHOTOS]), p.mode);
}

// À lancer dans l'éditeur Apps Script : vérifie l'accès à la base et résume ce qui sera publié.
function testMachines() {
  const list = getMachines_({});
  Logger.log('%s machine(s) publiée(s)', list.items.length);
  const active = list.items.filter(function (i) { return i.active === true; }).length;
  Logger.log('  %s en exploitation, %s sans région', active, list.items.filter(function (i) { return !i.region; }).length);
  if (list.items.length) {
    const m = getMachine_({ id: list.items[0].id });
    Logger.log('Exemple « %s » : adresse %s, boîte à clés %s, Wi-Fi %s, %s photo(s), %s colonne(s) en plus',
      m.title, m.address ? 'oui' : 'non', m.keybox ? 'oui' : 'non', m.wifi ? 'oui' : 'non', m.photos.length, m.extras.length);
  }
}
