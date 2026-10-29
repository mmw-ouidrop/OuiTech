/**
 * ============================================================================
 *  Code.gs — Middleware Notion ↔ Google Drive pour la PWA « Interventions »
 * ============================================================================
 *
 *  CONFIGURATION — Paramètres du projet ▸ Propriétés du script :
 *    NOTION_TOKEN        Secret de l'intégration Notion
 *    NOTION_DB_ID        ID de la base Notion « Interventions »
 *    DRIVE_FOLDER_ID     ID du dossier Drive racine (zone de transit des photos).
 *                        Aucun partage public n'est nécessaire : les photos y
 *                        séjournent le temps de la synchro, puis Notion les
 *                        héberge et le script les met à la corbeille.
 *    PASSWORD_TECH       Mot de passe du niveau « technicien » (12 caractères ou plus)
 *    PASSWORD_SUPPORT    Mot de passe du niveau « support » (optionnel ; ⊇ technicien)
 *    SESSION_DAYS        (optionnel) Durée d'une connexion en jours. Défaut : 30
 *    SESSION_EPOCH       (optionnel) Augmenter (1 → 2) pour déconnecter tous les appareils
 *                        (SESSION_SECRET, clé de signature, est créée automatiquement ; voir Auth.gs)
 *    REF_PROPERTY_NAME   (optionnel) Colonne portant l'ID court. Défaut : "ID"
 *    REF_PROPERTY_TYPE   (optionnel) unique_id | title | rich_text | formula.
 *                        Défaut : "unique_id"
 *
 *  PRÉREQUIS NOTION : l'intégration doit être « connectée » à la base
 *  (⋯ ▸ Connexions) pour pouvoir lire et écrire les pages.
 *
 *  DÉPLOIEMENT : Déployer ▸ Nouveau déploiement ▸ Application Web
 *    Exécuter en tant que : Moi  |  Qui a accès : Tout le monde
 *  Après chaque modification du code : Gérer les déploiements ▸ Modifier ▸
 *  Nouvelle version (l'URL /exec reste la même).
 *
 *  CORS : GAS ne répond pas aux requêtes OPTIONS (preflight). La PWA doit donc
 *  envoyer ses POST avec  Content-Type: text/plain;charset=utf-8  (le corps
 *  reste du JSON) et suivre les redirections (fetch le fait par défaut).
 *
 *  FORMAT DES RÉPONSES (toujours HTTP 200, GAS ne permet pas d'autre code) :
 *    succès : { "ok": true,  "data": { ... } }
 *    erreur : { "ok": false, "error": { "code": "...", "message": "..." } }
 *
 *  FICHIERS DU PROJET (même projet Apps Script, portée globale commune)
 *    Code.gs         point d'entrée, client Notion, lecture de la mission
 *                    (route 1), upload Drive (route 2), utilitaires
 *    Report.gs       rapport partagé : état, fusion champ par champ, écriture
 *                    incrémentale dans Notion (route 3) — le contrat complet
 *                    des requêtes/réponses est décrit en tête de ce fichier
 *    Auth.gs         connexion par mot de passe (2 niveaux), sessions signées
 *    Methods.gs      fiches méthodes (lecture seule) : liste, fiche, médias
 *    Machines.gs     liste des machines (lecture seule) : liste, fiche, photos
 *    Racks.gs        racks et casiers KO : vue d'ensemble, liste par site, diagnostic du technicien
 *    appsscript.json manifeste
 *
 *  ROUTES
 *    GET  ?action=ping                       (sans session)
 *    POST { action:"login", password, firstName, lastName, clientId }   → session (voir Auth.gs)
 *    GET  ?action=session&session=…          → niveau et validité de la session
 *    GET  ?action=getIntervention&id=FI-252&session=...
 *           → mission + template (templateBlocks, schema) + état du rapport
 *    GET  ?action=getReport&pageId=…&sinceRev=N&clientId=…&name=…&session=…
 *           → { unchanged:true } ou l'état du rapport (relève des collègues)
 *    GET  ?action=methods | method | methodMedia   → fiches méthodes (voir Methods.gs)
 *    GET  ?action=machines | machine | machineMedia → liste des machines (voir Machines.gs)
 *    GET  ?action=racksOverview | racks&site=<pageId>  → racks et casiers KO (voir Racks.gs)
 *    POST { action:"methodComment" | "rackDiagnosis", … } → commentaire de méthode / diagnostic (voir Methods.gs, Racks.gs)
 *    POST { action:"uploadMedia", session, fileData, fileName, mimeType,
 *           mediaId?, reference? }                 → { fileId, ... }
 *    POST { action:"syncReport", … }               → voir Report.gs
 *
 *  FLUX PHOTOS
 *    1. PWA  → uploadMedia  : la photo arrive dans Drive, sous-dossier
 *                             <racine>/<reference>/ (transit), on récupère fileId
 *    2. PWA  → syncReport   : changes.photos.add référence la photo par fileId
 *    3. GAS  : envoie la photo à Notion (API « File Upload », hébergement
 *              permanent par Notion), l'attache sous son champ, puis met à la
 *              corbeille le fichier de transit et le sous-dossier devenu vide.
 *
 *  VERSION DE L'API NOTION : voir NOTION_VERSION ci-dessous.
 * ============================================================================
 */

/* ─────────────────────────────── Constantes ─────────────────────────────── */

const NOTION_API = 'https://api.notion.com/v1';

// Version de l'API Notion, envoyée dans l'en-tête « Notion-Version ».
// Où la trouver : https://developers.notion.com/reference/versioning
// (au 20/10/2026 la plus récente est 2026-03-11 ; Notion annonce ne pas prévoir
// de retirer les anciennes). On reste volontairement sur 2022-06-28 : les
// versions ≥ 2025-09-03 remplacent la requête de base « /databases/{id}/query »
// par des « data sources » (/data_sources/{id}/query), ce qui changerait
// findPageByReference_. Les nouveaux endpoints (File Upload) sont utilisables
// sans changer de version. Pour migrer : lire le guide « Upgrading to 2025-09-03 ».
const NOTION_VERSION = '2022-06-28';
const TZ = 'Europe/Paris';

// Structure de la page Notion : trois toggles frères, dans cet ordre.
//   ▸ Template CR intervention                        (écrit par le responsable ; tout titre commençant par « Template »)
//   ▸ CR intervention — En cours | Validé             (le rapport : un toggle dont le titre commence par ce texte)
//   ▸ Données de synchronisation (ne pas modifier)    (l'état JSON, voir Report.gs)
// getIntervention ignore le rapport et les données (ce n'est pas du template) mais continue de lire ce
// qui les entoure : des blocs ajoutés par un responsable avant OU après sont repris dans le formulaire.
// Ancien format (jusqu'à l'étape 5) : un callout 📋 « Rapport d'intervention » contenant tout ; il est
// reconnu pour être remplacé par la nouvelle structure à la première synchronisation.
const REPORT_MARKER = 'CR intervention';
const LEGACY_REPORT_MARKER = "Rapport d'intervention";
const LEGACY_REPORT_ICON = '📋';

const DRIVE_ID_RE = /^[A-Za-z0-9_-]{20,80}$/;   // forme d'un fileId Drive
const TEMP_RETENTION_DAYS = 14;                  // purge des fichiers de transit orphelins

// Colonnes Notion à ne pas exposer à la PWA (noms exacts). Valeur par défaut ;
// la propriété de script HIDDEN_PROPERTIES (noms séparés par « | ») la remplace.
const HIDDEN_PROPERTIES = [];
// Colonnes à afficher en premier, dans cet ordre. L'API Notion ne documente aucun
// ordre pour les propriétés d'une page : on le fixe ici (ou par la propriété de
// script PROPERTY_ORDER, noms séparés par « | »). Les colonnes non citées suivent.
const PROPERTY_ORDER = [];

// Types de champs que le formulaire sait afficher (voir le mémo de templates).
const COMPONENT_TYPES = ['text', 'textarea', 'number', 'checkbox', 'radio_group',
  'select', 'checkbox_group', 'date', 'image_upload'];
const CHOICE_TYPES = ['radio_group', 'select', 'checkbox_group'];
const COMPONENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_ID_RE = /^(u_|todo_|S:)/;

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;   // taille décodée max d'une photo
const MAX_NEST_DEPTH = 2;                    // profondeur de lecture des toggles
const NOTION_MAX_CHILDREN = 100;             // limite Notion par requête append
const NOTION_MAX_TEXT = 2000;                // limite Notion par objet rich_text
const MAX_FIELD_CHARS = 20000;               // garde-fou sur les saisies libres
const SYNC_CACHE_SECONDS = 21600;            // 6 h (maximum de CacheService)

/* ───────────────────────────── Erreurs & réponses ───────────────────────── */

class ApiError_ extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.extra = extra || {};
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(data) {
  return json_({ ok: true, data: data });
}

function fail_(err) {
  const known = err instanceof ApiError_;
  if (!known) console.error(err && err.stack ? err.stack : err);
  const error = known
    ? Object.assign({ code: err.code, message: err.message }, err.extra)
    : { code: 'INTERNAL', message: 'Erreur interne : ' + (err && err.message) };
  return json_({ ok: false, error: error });
}

/* ───────────────────────────── Points d'entrée ──────────────────────────── */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'ping') return ok_({ ts: new Date().toISOString() });
    const auth = authorize_(p.session, 'tech');
    switch (p.action) {
      case 'session':
        return ok_({ role: auth.r, expiresAt: auth.exp, serverNow: Date.now() });
      case 'getIntervention':
        return ok_(getIntervention_(p.id));
      case 'getReport':
        return ok_(getReport_(p));
      case 'methods':
        return ok_(getMethods_(p));
      case 'method':
        return ok_(getMethod_(p));
      case 'methodMedia':
        return ok_(getMethodMedia_(p));
      case 'machines':
        return ok_(getMachines_(p));
      case 'machine':
        return ok_(getMachine_(p));
      case 'machineMedia':
        return ok_(getMachineMedia_(p));
      case 'racksOverview':
        return ok_(getRacksOverview_(p));
      case 'racks':
        return ok_(getRacks_(p));
      default:
        throw new ApiError_('UNKNOWN_ACTION', 'Action GET inconnue : ' + p.action);
    }
  } catch (err) {
    return fail_(err);
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    if (body.action === 'login') return ok_(login_(body));
    authorize_(body.session, 'tech');
    switch (body.action) {
      case 'uploadMedia':
        return ok_(uploadMedia_(body));
      case 'syncReport':
        return ok_(syncReport_(body));
      case 'methodComment':
        return ok_(postMethodComment_(body));
      case 'rackDiagnosis':
        return ok_(postRackDiagnosis_(body));
      default:
        throw new ApiError_('UNKNOWN_ACTION', 'Action POST inconnue : ' + body.action);
    }
  } catch (err) {
    return fail_(err);
  }
}

function parseBody_(e) {
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new ApiError_('BAD_REQUEST', 'Corps de requête JSON invalide');
  }
}

/* ─────────────────────────────── Sécurité ───────────────────────────────── */

function cfg_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (v === null || v === '') {
    if (fallback !== undefined) return fallback;
    throw new ApiError_('CONFIG_MISSING', 'Propriété de script manquante : ' + key);
  }
  return v;
}

// Comparaison à durée constante (évite les attaques par mesure de temps).
function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ─────────────────────────────── Client Notion ──────────────────────────── */

function notion_(method, path, payload) {
  const options = {
    method: method.toLowerCase(),
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + cfg_('NOTION_TOKEN'),
      'Notion-Version': NOTION_VERSION
    }
  };
  if (payload) options.payload = JSON.stringify(payload);

  // On ne rejoue sur erreur 5xx que les requêtes sans effet de bord
  // (lecture, suppression) : rejouer un PATCH pourrait dupliquer des blocs.
  const replayable = method === 'GET' || method === 'DELETE' || /\/query$/.test(path);

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = UrlFetchApp.fetch(NOTION_API + path, options);
    const code = res.getResponseCode();

    if (code === 429 || (code >= 500 && replayable)) {
      const retryAfter = Number(headerValue_(res.getHeaders(), 'Retry-After')) || (attempt + 1);
      Utilities.sleep(Math.min(retryAfter, 10) * 1000);
      continue;
    }

    const text = res.getContentText();
    let data;
    try { data = JSON.parse(text); } catch (err) { data = { message: text }; }

    if (code >= 200 && code < 300) return data;
    if (code === 403) {
      throw new ApiError_('NOTION_FORBIDDEN',
        'Notion refuse cette opération (' + method + ' ' + path.split('?')[0] + ') : ' + ((data && data.message) || 'accès refusé') +
        ". Dans notion.so/my-integrations, l'intégration doit avoir les capacités « Read content », « Update content » et « Insert content », " +
        'et être ajoutée à la base (⋯ ▸ Connexions).', { status: code, notionCode: data && data.code });
    }
    throw new ApiError_('NOTION_ERROR', (data && data.message) || ('HTTP ' + code), {
      status: code,
      notionCode: data && data.code
    });
  }
  throw new ApiError_('NOTION_UNAVAILABLE', 'Notion indisponible après plusieurs tentatives');
}

function headerValue_(headers, name) {
  const wanted = name.toLowerCase();
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) return headers[keys[i]];
  }
  return undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  ROUTE 1 — getIntervention
 * ═══════════════════════════════════════════════════════════════════════════ */

function getIntervention_(idParam) {
  const page = findPageByReference_(idParam);

  // 1) Propriétés (colonnes) — génériques, sans nom de colonne en dur.
  let properties = [];
  const hiddenProperties = nameList_('HIDDEN_PROPERTIES', HIDDEN_PROPERTIES);
  Object.keys(page.properties).forEach(function (name) {
    if (hiddenProperties.indexOf(name) > -1) return;
    const prop = page.properties[name];
    const value = formatProperty_(prop);
    if (value === null || value === undefined) return;
    properties.push({ label: name, value: value, type: prop.type });
  });
  properties = sortProperties_(properties);

  const titleName = Object.keys(page.properties).filter(function (n) {
    return page.properties[n].type === 'title';
  })[0];
  const title = titleName ? plain_(page.properties[titleName].title) : '';

  // 2) Contenu de la page → blocs du template.
  const blocks = fetchBlocks_(page.id, 0);
  const ctx = { out: [], warnings: [], ids: {} };
  convertBlocks_(blocks, ctx, 0);

  // 3) Rapport partagé déjà commencé (par ce technicien sur un autre appareil,
  //    ou par un collègue) : son état est joint, pour reprendre où il en est.
  let report = null;
  const reportBlock = blocks.filter(isReportBlock_)[0];
  const stateBlock = blocks.filter(isStateBlock_)[0];
  if (reportBlock) {
    try {
      const state = loadState_(page.id, { rootId: reportBlock.id, stateId: stateBlock ? stateBlock.id : null });
      report = state ? publicState_(state, pageEditors_(page.id)) : null;
    } catch (err) {
      ctx.warnings.push({ code: 'REPORT_STATE_ERROR', message: err.message });
    }
  }

  return {
    schema: buildSchema_(ctx.out),
    report: report,
    serverNow: Date.now(),
    id: page.id,
    reference: referenceOf_(page, String(idParam).trim()),
    title: title,
    url: page.url,
    lastEditedTime: page.last_edited_time,
    properties: properties,
    templateBlocks: ctx.out,
    warnings: ctx.warnings
  };
}

function findPageByReference_(input) {
  const ref = String(input || '').trim();
  if (!ref || ref.length > 64) {
    throw new ApiError_('BAD_REQUEST', 'ID de mission manquant ou invalide');
  }
  const propName = cfg_('REF_PROPERTY_NAME', 'ID');
  const propType = cfg_('REF_PROPERTY_TYPE', 'unique_id');

  let filter;
  let prefix = '';
  if (propType === 'unique_id') {
    // « FI-252 », « fi252 » ou « 252 » sont acceptés.
    const m = ref.match(/^([A-Za-z]*)[\s\-_]*(\d+)$/);
    if (!m) throw new ApiError_('BAD_REQUEST', "Format d'ID attendu, par exemple FI-252");
    prefix = m[1].toUpperCase();
    // Notion ne filtre un unique_id que sur sa partie numérique.
    filter = { property: propName, unique_id: { equals: parseInt(m[2], 10) } };
  } else if (propType === 'title' || propType === 'rich_text') {
    filter = { property: propName };
    filter[propType] = { equals: ref };
  } else if (propType === 'formula') {
    filter = { property: propName, formula: { string: { equals: ref } } };
  } else {
    throw new ApiError_('CONFIG_INVALID', 'REF_PROPERTY_TYPE non supporté : ' + propType);
  }

  const res = notion_('POST', '/databases/' + cfg_('NOTION_DB_ID') + '/query', {
    filter: filter,
    page_size: 10
  });
  let pages = res.results || [];

  if (prefix) {
    pages = pages.filter(function (p) {
      const u = p.properties[propName];
      return u && u.unique_id && String(u.unique_id.prefix || '').toUpperCase() === prefix;
    });
  }
  if (!pages.length) {
    throw new ApiError_('NOT_FOUND', 'Aucune mission trouvée pour « ' + ref + ' »');
  }
  return pages[0];
}

function referenceOf_(page, fallback) {
  const prop = page.properties[cfg_('REF_PROPERTY_NAME', 'ID')];
  if (prop) {
    const v = formatProperty_(prop);
    if (v !== null && v !== undefined && v !== '') return String(v);
  }
  return fallback;
}

// Liste de noms de colonnes : propriété de script (séparée par « | ») sinon constante.
function nameList_(key, fallback) {
  const raw = cfg_(key, '');
  if (!raw) return fallback;
  return raw.split('|').map(function (x) { return x.trim(); }).filter(Boolean);
}

function sortProperties_(list) {
  const order = nameList_('PROPERTY_ORDER', PROPERTY_ORDER);
  if (!order.length) return list;
  const rank = function (p) {
    const i = order.indexOf(p.label);
    return i === -1 ? order.length : i;
  };
  return list
    .map(function (p, i) { return { p: p, i: i }; })
    .sort(function (a, b) { return (rank(a.p) - rank(b.p)) || (a.i - b.i); })
    .map(function (x) { return x.p; });
}

/* ── Formatage générique des propriétés Notion ───────────────────────────────
 *  value est « prêt à afficher » :
 *    string    : title, rich_text, select, status, date, url, email, phone…
 *    number    : number
 *    boolean   : checkbox
 *    string[]  : multi_select, people, files (noms), rollup en tableau
 *  Types ignorés (retour null) : relation (IDs inutilisables hors-ligne),
 *  et tout type inconnu.
 *  NB : les URLs de fichiers hébergés par Notion expirent au bout d'1 h ;
 *  pour les propriétés « files » on ne renvoie donc que les noms.
 * ──────────────────────────────────────────────────────────────────────────── */

function plain_(richText) {
  return (richText || []).map(function (t) { return t.plain_text; }).join('');
}

function formatDate_(d) {
  if (!d || !d.start) return '';
  return d.end ? d.start + ' → ' + d.end : d.start;
}

function formatProperty_(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':        return plain_(prop.title);
    case 'rich_text':    return plain_(prop.rich_text);
    case 'number':       return prop.number;
    case 'select':       return prop.select ? prop.select.name : '';
    case 'status':       return prop.status ? prop.status.name : '';
    case 'multi_select': return prop.multi_select.map(function (o) { return o.name; });
    case 'date':         return formatDate_(prop.date);
    case 'people':       return prop.people.map(function (p) { return p.name || p.id; });
    case 'checkbox':     return !!prop.checkbox;
    case 'url':          return prop.url || '';
    case 'email':        return prop.email || '';
    case 'phone_number': return prop.phone_number || '';
    case 'files':        return prop.files.map(function (f) { return f.name; });
    case 'created_time':     return prop.created_time;
    case 'last_edited_time': return prop.last_edited_time;
    case 'created_by':       return prop.created_by ? (prop.created_by.name || prop.created_by.id) : '';
    case 'last_edited_by':   return prop.last_edited_by ? (prop.last_edited_by.name || prop.last_edited_by.id) : '';
    case 'unique_id': {
      const u = prop.unique_id;
      if (!u) return '';
      return (u.prefix ? u.prefix + '-' : '') + u.number;
    }
    case 'formula': {
      const f = prop.formula;
      if (!f) return null;
      return f.type === 'date' ? formatDate_(f.date) : f[f.type];
    }
    case 'rollup': {
      const r = prop.rollup;
      if (!r) return null;
      if (r.type === 'array') {
        return r.array.map(formatProperty_).filter(function (v) {
          return v !== null && v !== undefined && v !== '';
        });
      }
      if (r.type === 'date') return formatDate_(r.date);
      if (r.type === 'number') return r.number;
      return null;
    }
    default:
      return null;
  }
}

/* ── Lecture et conversion des blocs ─────────────────────────────────────────
 *  templateBlocks est une liste PLATE et ORDONNÉE ; chaque élément a un `kind` :
 *    { kind:"section",   level:1|2|3, text, blockId }
 *    { kind:"component", id, type, label, ...options, blockId }   (JSON Notion)
 *    { kind:"text",      style, text, blockId }        (consignes, paragraphes)
 *    { kind:"divider" }
 *    { kind:"invalid",   blockId, error, raw }         (JSON mal formé)
 *  Les blocs « to_do » natifs de Notion deviennent des composants "checkbox".
 *  Un bloc de code JSON peut contenir un objet OU un tableau d'objets.
 * ──────────────────────────────────────────────────────────────────────────── */

function fetchBlocks_(blockId, depth) {
  const out = [];
  let cursor = null;
  do {
    const query = '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
    const res = notion_('GET', '/blocks/' + blockId + '/children' + query);
    (res.results || []).forEach(function (b) { out.push(b); });
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  if (depth < MAX_NEST_DEPTH) {
    out.forEach(function (b) {
      if (b.has_children && isNestable_(b) && !isReportBlock_(b) && !isStateBlock_(b)) {
        b._children = fetchBlocks_(b.id, depth + 1);
      }
    });
  }
  return out;
}

function isNestable_(b) {
  if (b.type === 'toggle') return true;
  return /^heading_[123]$/.test(b.type) && b[b.type] && b[b.type].is_toggleable === true;
}

// Un toggle (ou un titre déroulant) dont le titre commence par « Template » est un simple
// CONTENEUR : le responsable y range tout le formulaire pour pouvoir le replier dans Notion et
// retrouver le rapport juste en dessous. Son titre n'est pas un champ ni une section du formulaire ;
// son contenu est lu normalement.
function isTemplateContainer_(b) {
  if (!isNestable_(b)) return false;
  const title = plain_((b[b.type] || {}).rich_text).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return title.indexOf('template') === 0;
}

function convertBlocks_(blocks, ctx, depth) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (depth === 0 && (isReportBlock_(b) || isStateBlock_(b) || isLegacyReportBlock_(b))) continue;   // ni le rapport ni ses données ne sont du template
    if (isTemplateContainer_(b)) {
      if (b._children) convertBlocks_(b._children, ctx, depth + 1);
      continue;
    }
    const t = b.type;
    const data = b[t] || {};
    const text = plain_(data.rich_text);

    switch (t) {
      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        const level = Number(t.slice(-1));
        ctx.out.push({ kind: 'section', level: level, text: text, blockId: b.id });
        break;
      }

      case 'code':
        if (data.language === 'json') {
          parseJsonComponents_(b, text, ctx);
        }
        break;

      case 'to_do':
        ctx.out.push({
          kind: 'component',
          type: 'checkbox',
          id: 'todo_' + b.id,
          label: text,
          source: 'notion_todo',
          blockId: b.id
        });
        break;

      case 'paragraph':
        if (text.trim()) ctx.out.push({ kind: 'text', style: 'paragraph', text: text, blockId: b.id });
        break;

      case 'bulleted_list_item':
      case 'numbered_list_item':
      case 'quote':
      case 'callout':
      case 'toggle':
        if (text.trim()) {
          ctx.out.push({
            kind: 'text',
            style: t.replace(/_item$/, ''),
            text: text,
            blockId: b.id
          });
        }
        break;

      case 'divider':
        ctx.out.push({ kind: 'divider', blockId: b.id });
        break;

      default:
        break;   // images, embeds, tableaux… ignorés pour l'instant
    }

    if (b._children) convertBlocks_(b._children, ctx, depth + 1);
  }
}

// Signale (sans rien supprimer) les définitions de champs douteuses : le
// responsable les voit au chargement au lieu de les découvrir sur le terrain.
function checkComponent_(block, c, ctx) {
  const warn = function (code, message) {
    ctx.warnings.push({ blockId: block.id, code: code, id: String(c.id), message: message });
  };
  const id = String(c.id);
  if (!COMPONENT_ID_RE.test(id)) {
    warn('BAD_ID', 'id « ' + id + ' » : lettres, chiffres, _ et - seulement, 64 caractères au plus');
  } else if (RESERVED_ID_RE.test(id)) {
    warn('RESERVED_ID', 'id « ' + id + ' » : les préfixes u_, todo_ et S: sont réservés');
  }
  if (COMPONENT_TYPES.indexOf(c.type) === -1) {
    warn('UNKNOWN_TYPE', 'type « ' + c.type + ' » inconnu (types : ' + COMPONENT_TYPES.join(', ') + ')');
  }
  if (CHOICE_TYPES.indexOf(c.type) > -1) {
    const n = Array.isArray(c.options) ? c.options.length : 0;
    if (n < 2 || n > 20) warn('BAD_OPTIONS', 'le champ « ' + id + ' » demande de 2 à 20 options (' + n + ' trouvée(s))');
  }
}

function parseJsonComponents_(block, src, ctx) {
  let parsed;
  try {
    parsed = JSON.parse(src);
  } catch (err) {
    ctx.warnings.push({ blockId: block.id, code: 'INVALID_JSON', message: err.message });
    ctx.out.push({ kind: 'invalid', blockId: block.id, error: err.message, raw: src.slice(0, 500) });
    return;
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  list.forEach(function (c) {
    if (!c || typeof c !== 'object' || !c.type || !c.id) {
      ctx.warnings.push({
        blockId: block.id,
        code: 'MISSING_FIELDS',
        message: 'Un composant doit avoir au minimum "type" et "id"'
      });
      return;
    }
    if (ctx.ids[c.id]) {
      ctx.warnings.push({ blockId: block.id, code: 'DUPLICATE_ID', message: 'id déjà utilisé : ' + c.id });
    }
    ctx.ids[c.id] = true;
    checkComponent_(block, c, ctx);
    // `kind` et `blockId` écrasent d'éventuelles clés homonymes du JSON.
    ctx.out.push(Object.assign({}, c, { kind: 'component', blockId: block.id }));
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  ROUTE 2 — uploadMedia   (photo → Drive, zone de transit)
 * ═══════════════════════════════════════════════════════════════════════════ */

function uploadMedia_(b) {
  if (!b.fileData || !b.fileName) {
    throw new ApiError_('BAD_REQUEST', 'fileData et fileName sont requis');
  }
  const mimeType = String(b.mimeType || 'image/jpeg').toLowerCase();
  // HEIC/HEIF exclus : la PWA convertit en JPEG avant l'envoi.
  if (!IMAGE_MIME_RE.test(mimeType)) {
    throw new ApiError_('UNSUPPORTED_TYPE', 'Type non supporté : ' + mimeType + ' (jpeg, png, webp, gif)');
  }

  let b64 = String(b.fileData);
  const marker = b64.indexOf('base64,');           // tolère un préfixe data:URL
  if (marker > -1) b64 = b64.slice(marker + 7);

  let bytes;
  try {
    bytes = Utilities.base64Decode(b64);
  } catch (err) {
    throw new ApiError_('BAD_REQUEST', 'Base64 invalide');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new ApiError_('TOO_LARGE', 'Fichier trop volumineux (' + bytes.length + ' octets)');
  }

  // Nom déterministe = idempotence : si la PWA rejoue l'upload d'un même
  // mediaId (coupure réseau avant la réponse), on renvoie le fichier existant.
  const prefix = b.mediaId ? safeName_(b.mediaId).slice(0, 40) + '_' : '';
  const name = prefix + safeName_(b.fileName);

  const folder = targetFolder_(b.reference);
  const existing = folder.getFilesByName(name);
  const duplicate = existing.hasNext();
  const file = duplicate
    ? existing.next()
    : folder.createFile(Utilities.newBlob(bytes, mimeType, name));

  // Pas de partage public : le fichier n'est lu que par ce script, au moment
  // de la synchro, pour être transféré chez Notion.
  return {
    fileId: file.getId(),
    name: name,
    size: bytes.length,
    duplicate: duplicate
  };
}

const IMAGE_MIME_RE = /^image\/(jpeg|png|webp|gif)$/;

function safeName_(s) {
  return String(s).replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
}

function targetFolder_(reference) {
  const root = DriveApp.getFolderById(cfg_('DRIVE_FOLDER_ID'));
  if (!reference) return root;
  const name = safeName_(reference).slice(0, 64);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

// Garde-fou : un fileId fourni par la PWA doit se trouver dans le dossier racine
// (ou l'un de ses sous-dossiers directs). Sans cela, un client authentifié pourrait sinon
// faire lire n'importe quel fichier du Drive du propriétaire du script.
function assertInRoot_(file) {
  const rootId = cfg_('DRIVE_FOLDER_ID');
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    if (p.getId() === rootId) return;
    const grand = p.getParents();
    while (grand.hasNext()) {
      if (grand.next().getId() === rootId) return;
    }
  }
  throw new ApiError_('FORBIDDEN', 'Fichier hors du dossier autorisé', { fileId: file.getId() });
}


/* ── Rapport existant : repérage ─────────────────────────────────────────────── */

const titleOf_ = function (b) {
  return b && b[b.type] ? plain_(b[b.type].rich_text).trim().toLowerCase() : '';
};

function isReportBlock_(b) {
  return !!b && b.type === 'toggle' && titleOf_(b).indexOf(REPORT_MARKER.toLowerCase()) === 0;
}

function isStateBlock_(b) {
  return !!b && b.type === 'toggle' && titleOf_(b).indexOf(STATE_TOGGLE_TITLE.toLowerCase()) === 0;
}

function isLegacyReportBlock_(b) {
  if (!b || b.type !== 'callout') return false;
  const c = b.callout || {};
  const icon = c.icon && c.icon.type === 'emoji' ? c.icon.emoji : null;
  return icon === LEGACY_REPORT_ICON && titleOf_(b).indexOf(LEGACY_REPORT_MARKER.toLowerCase()) === 0;
}

// Parcourt les blocs de la page : rapports, blocs de données, anciens rapports (ids).
function findReportParts_(pageId) {
  const parts = { roots: [], states: [], legacy: [] };
  let cursor = null;
  do {
    const query = '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
    const res = notion_('GET', '/blocks/' + pageId + '/children' + query);
    (res.results || []).forEach(function (blk) {
      if (isReportBlock_(blk)) parts.roots.push(blk.id);
      else if (isStateBlock_(blk)) parts.states.push(blk.id);
      else if (isLegacyReportBlock_(blk)) parts.legacy.push(blk.id);
    });
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return parts;
}

/* ── Photos : Drive → Notion (API File Upload) ───────────────────────────────── */

function notionUploadFromDrive_(fileId) {
  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    throw new ApiError_('MEDIA_NOT_FOUND', 'Photo introuvable dans Drive : ' + fileId, { fileId: fileId });
  }
  if (file.isTrashed()) {
    throw new ApiError_('MEDIA_NOT_FOUND', 'Photo déjà supprimée de Drive : ' + fileId, { fileId: fileId });
  }
  assertInRoot_(file);

  const blob = file.getBlob().setName(file.getName());
  const mime = String(blob.getContentType() || '').toLowerCase();
  if (!IMAGE_MIME_RE.test(mime)) {
    throw new ApiError_('UNSUPPORTED_TYPE', 'Type non supporté : ' + mime, { fileId: fileId });
  }
  return notionUploadBlob_(blob);
}

// API Notion « File Upload » (fichiers ≤ 20 Mo) :
//   1. POST /file_uploads             → id
//   2. POST /file_uploads/{id}/send   → multipart, champ « file »
//   3. référencer l'id dans un bloc image, dans l'heure qui suit
// UrlFetchApp envoie un multipart/form-data quand le payload est un objet
// contenant un Blob : on ne fixe donc volontairement pas de Content-Type.
function notionUploadBlob_(blob) {
  const headers = {
    Authorization: 'Bearer ' + cfg_('NOTION_TOKEN'),
    'Notion-Version': NOTION_VERSION
  };
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const created = notion_('POST', '/file_uploads', {
      filename: blob.getName(),
      content_type: blob.getContentType()
    });
    const res = UrlFetchApp.fetch(NOTION_API + '/file_uploads/' + created.id + '/send', {
      method: 'post',
      headers: headers,
      payload: { file: blob },
      muteHttpExceptions: true
    });
    lastStatus = res.getResponseCode();
    if (lastStatus >= 200 && lastStatus < 300) return created.id;
    if (lastStatus === 429 || lastStatus >= 500) {
      Utilities.sleep((attempt + 1) * 1500);
      continue;
    }
    break;
  }
  throw new ApiError_('NOTION_UPLOAD_FAILED',
    "Échec de l'envoi d'une photo à Notion (HTTP " + lastStatus + ')', { status: lastStatus });
}

/* ── Nettoyage du transit Drive ──────────────────────────────────────────────── */

function cleanupDrive_(fileIds) {
  const out = { trashedFiles: 0, trashedFolders: 0, errors: [] };
  const rootId = cfg_('DRIVE_FOLDER_ID');
  const folders = {};

  fileIds.forEach(function (id) {
    try {
      const f = DriveApp.getFileById(id);
      const parents = f.getParents();
      while (parents.hasNext()) {
        const p = parents.next();
        folders[p.getId()] = p;
      }
      f.setTrashed(true);
      out.trashedFiles++;
    } catch (err) {
      out.errors.push(id + ' : ' + err.message);
    }
  });

  Object.keys(folders).forEach(function (fid) {
    if (fid === rootId) return;      // on ne touche jamais au dossier racine
    try {
      const fo = folders[fid];
      if (!fo.getFiles().hasNext() && !fo.getFolders().hasNext()) {
        fo.setTrashed(true);
        out.trashedFolders++;
      }
    } catch (err) {
      out.errors.push(fid + ' : ' + err.message);
    }
  });
  return out;
}

// Optionnel : à brancher sur un déclencheur quotidien (Déclencheurs ▸ Ajouter).
// Met à la corbeille les photos de transit jamais synchronisées (technicien
// parti sans valider, par exemple) après TEMP_RETENTION_DAYS jours.
function purgeStaleTempFiles() {
  const root = DriveApp.getFolderById(cfg_('DRIVE_FOLDER_ID'));
  const limit = Date.now() - TEMP_RETENTION_DAYS * 86400000;
  let trashed = 0;

  const sweep = function (folder, isRoot) {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.getDateCreated().getTime() < limit) {
        f.setTrashed(true);
        trashed++;
      }
    }
    const subs = folder.getFolders();
    while (subs.hasNext()) sweep(subs.next(), false);
    if (!isRoot && !folder.getFiles().hasNext() && !folder.getFolders().hasNext()) {
      folder.setTrashed(true);
    }
  };
  sweep(root, true);
  Logger.log('Fichiers de transit mis à la corbeille : %s', trashed);
}


/* ── Constructeurs de blocs Notion ──────────────────────────────────────────── */

function rt_(text, annotations) {
  const s = String(text == null ? '' : text);
  const out = [];
  for (let i = 0; i < s.length; i += NOTION_MAX_TEXT) {
    const part = { type: 'text', text: { content: s.slice(i, i + NOTION_MAX_TEXT) } };
    if (annotations) part.annotations = annotations;
    out.push(part);
  }
  return out.length ? out : [{ type: 'text', text: { content: '' } }];
}

function blockParagraph_(richText) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText } };
}

function blockHeading_(level, text) {
  const key = 'heading_' + level;
  const block = { object: 'block', type: key };
  block[key] = { rich_text: rt_(text || '—') };
  return block;
}

function display_(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (Array.isArray(v)) return v.length ? v.map(display_).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, MAX_FIELD_CHARS);
  return String(v).slice(0, MAX_FIELD_CHARS);
}

function formatWhen_(iso) {
  let d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  return Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm');
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Fonctions utilitaires à lancer depuis l'éditeur Apps Script
 * ═══════════════════════════════════════════════════════════════════════════ */

// 1) À lancer en premier : déclenche les autorisations OAuth (Drive, appels
//    externes) et affiche les noms exacts des colonnes de la base Notion.
function testSetup() {
  const folder = DriveApp.getFolderById(cfg_('DRIVE_FOLDER_ID'));
  Logger.log('Dossier Drive : %s', folder.getName());

  const db = notion_('GET', '/databases/' + cfg_('NOTION_DB_ID'));
  Logger.log('Base Notion : %s', plain_(db.title));
  Object.keys(db.properties).forEach(function (name) {
    Logger.log('  • "%s" (%s)', name, db.properties[name].type);
  });
}

// 2) Simule la route 1 (adapter l'ID).
function testGetIntervention() {
  Logger.log(JSON.stringify(getIntervention_(cfg_('TEST_REFERENCE', 'FI-252')), null, 2));
}

// 2 bis) Contrôle d'un template : lit la fiche (propriété de script TEST_REFERENCE,
//    par défaut FI-252) et affiche un résumé + un avertissement par ligne.
function testTemplate() {
  const r = getIntervention_(cfg_('TEST_REFERENCE', 'FI-252'));
  const fields = r.schema.filter(function (s) { return s.k === 'f'; });
  const sections = r.schema.length - fields.length;
  Logger.log('Fiche %s : %s champ(s), %s intertitre(s), %s propriété(s) en lecture seule.',
    r.reference, fields.length, sections, r.properties.length);
  fields.forEach(function (f) {
    Logger.log('  • %s  [%s]  %s', f.id, f.type, f.label);
  });
  if (!r.warnings.length) {
    Logger.log('Aucun avertissement.');
  } else {
    r.warnings.forEach(function (w) {
      Logger.log('⚠ %s%s : %s', w.code, w.id ? ' (' + w.id + ')' : '', w.message);
    });
  }
}


// 3) Vérifie que l'API « File Upload » de Notion est accessible avec ce jeton
//    et cette version (envoie un PNG de 1 pixel ; l'upload non rattaché à un
//    bloc expire tout seul au bout d'une heure).
function testNotionFileUpload() {
  const png = Utilities.base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  const id = notionUploadBlob_(Utilities.newBlob(png, 'image/png', 'test-1px.png'));
  Logger.log('Upload Notion OK, id = %s', id);
}
