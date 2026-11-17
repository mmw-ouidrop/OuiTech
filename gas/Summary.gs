/**
 * SYNTHÈSE SUR LA PAGE DE LA FICHE — deux colonnes de la base des fiches, tenues à jour automatiquement :
 *
 *  · « Compte rendu » (texte)        : 1) les actions à réaliser (titre, état, commentaires des techniciens)
 *                                      2) tout le compte rendu saisi (sections, champs renseignés, nombre de photos)
 *  · « Photos d'intervention » (fichiers) : toutes les photos ajoutées dans le CR (une copie de chaque photo)
 *
 *  Mises à jour à chaque synchro du CR et à chaque commentaire d'action. Une colonne absente (ou d'un autre type) est
 *  ignorée avec un avertissement ; une erreur ici ne fait jamais échouer la synchro.
 *
 *  Propriétés de script (facultatives) :
 *    SUMMARY_PROP_NAME   Défaut : Compte rendu
 *    PHOTOS_PROP_NAME    Défaut : Photos d’intervention
 */

const SUMMARY_PROP_DEFAULT = 'Compte rendu';
const PHOTOS_PROP_DEFAULT = 'Photos d’intervention';
const SUMMARY_ACTIONS_TTL = 90;          // secondes : les actions (état, commentaires) sont relues au plus toutes les 90 s
const SUMMARY_MAX_OBJECTS = 100;         // limite Notion : 100 morceaux de texte par colonne
const SUMMARY_CHUNK = 1900;
const SUMMARY_ENTRY_TEXT = 240;
const SUMMARY_ENTRIES_PER_ACTION = 8;

function summaryCfg_() {
  return { summary: cfg_('SUMMARY_PROP_NAME', SUMMARY_PROP_DEFAULT), photos: cfg_('PHOTOS_PROP_NAME', PHOTOS_PROP_DEFAULT) };
}

// Noms réels des deux colonnes dans la page (ou '' si absente / mauvais type).
function summaryProps_(page, warnings) {
  const cfg = summaryCfg_();
  const find = function (wanted, type) {
    const n = findProp_(page, wanted);
    if (n && page.properties[n].type === type) return n;
    // Colonne absente : on s'en passe sans bruit (voir testSummary pour la vérifier). Mauvais type : avertissement.
    if (n) warnings.push({ code: 'SUMMARY_PROP_TYPE', message: 'La colonne « ' + n + ' » doit être de type ' + (type === 'files' ? 'Fichiers et médias' : 'Texte') });
    return '';
  };
  return { summary: find(cfg.summary, 'rich_text'), photos: find(cfg.photos, 'files') };
}

/* ───────────────────────────── Texte de synthèse ───────────────────────────── */

// Segments { t: texte, b: gras } mis bout à bout.
function buildSummary_(state, actions, reference) {
  const seg = [];
  const add = function (t, b) { seg.push({ t: t, b: !!b }); };

  add('ACTIONS À RÉALISER\n', true);
  if (!actions.length) add('Aucune action liée à cette fiche.\n');
  actions.forEach(function (a) {
    const entries = a.entries || [];
    let st = '';
    entries.forEach(function (e) { if (e.state) st = e.state; });
    add('▸ ' + a.title, true);
    add(' — ' + (st ? ACTION_STATES[st] : 'Sans état') + '\n');
    if (!entries.length) add('   (aucun commentaire)\n');
    entries.slice(-SUMMARY_ENTRIES_PER_ACTION).forEach(function (e) {
      const text = String(e.text || '').replace(/\s+/g, ' ').trim();
      add('   • ' + formatWhen_(e.at) + ' · ' + e.by + (e.state ? ' · ' + ACTION_STATES[e.state] : '') + (text ? ' : ' + text.slice(0, SUMMARY_ENTRY_TEXT) : '') + '\n');
    });
  });

  add('\nCOMPTE RENDU D’INTERVENTION', true);
  add((reference ? ' ' + reference : '') + ' — ' + (state.status === 'validated'
    ? 'Validé par ' + state.statusBy + ' (' + formatWhen_(state.statusAt) + ')'
    : 'En cours') + '\n');

  const photoCount = {};
  Object.keys(state.photos).forEach(function (m) {
    const p = state.photos[m];
    if (!p.del) photoCount[p.f] = (photoCount[p.f] || 0) + 1;
  });

  let heading = null;
  let any = false;
  renderList_(state).forEach(function (it) {
    if (it.k === 's') { heading = it; return; }
    if (it.k !== 'f') return;
    const f = state.fields[it.id];
    const v = f ? f.v : '';
    let line = '';
    if (it.type === 'image_upload') {
      if (photoCount[it.id]) line = it.label + ' : ' + photoCount[it.id] + ' fichier' + (photoCount[it.id] > 1 ? 's' : '');
    } else if (CHECKBOX_TYPES.indexOf(it.type) > -1) {
      if (v === true) line = '☑ ' + it.label;
    } else if (v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) {
      line = it.label + ' : ' + display_(v);
    }
    if (!line) return;
    if (heading) { add('\n' + heading.text + '\n', true); heading = null; }
    add(line + '\n');
    any = true;
  });
  if (!any) add('Aucune saisie pour le moment.\n');
  return seg;
}

function summaryRichText_(seg) {
  const out = [];
  seg.forEach(function (s) {
    for (let i = 0; i < s.t.length; i += SUMMARY_CHUNK) {
      const part = { type: 'text', text: { content: s.t.slice(i, i + SUMMARY_CHUNK) } };
      if (s.b) part.annotations = { bold: true };
      out.push(part);
    }
  });
  if (out.length > SUMMARY_MAX_OBJECTS) {
    out.length = SUMMARY_MAX_OBJECTS - 1;
    out.push({ type: 'text', text: { content: '\n… (synthèse tronquée : voir le rapport complet dans la page)' }, annotations: { italic: true } });
  }
  return out;
}

function summaryHash_(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h) + ':' + s.length;
}

/* ───────────────────────────── Actions (avec cache court) ───────────────────────────── */

function summaryActions_(page, force) {
  const cache = CacheService.getScriptCache();
  const key = 'sumact:' + plainId_(page.id);
  if (!force) {
    const hit = cache.get(key);
    if (hit) { try { return JSON.parse(hit); } catch (err) { /* relu ci-dessous */ } }
  }
  const warnings = [];
  const list = readActions_(page, warnings).map(function (a) {
    return { title: a.title, entries: (a.entries || []).slice(-SUMMARY_ENTRIES_PER_ACTION).map(function (e) {
      return { by: e.by, state: e.state, text: String(e.text || '').slice(0, SUMMARY_ENTRY_TEXT), at: e.at };
    }) };
  });
  try { cache.put(key, JSON.stringify(list), SUMMARY_ACTIONS_TTL); } catch (err) { /* trop gros : pas de cache */ }
  return list;
}

/* ───────────────────────────── Écriture sur la page ───────────────────────────── */

// Met à jour « Compte rendu » et, si demandé, ajoute / retire des photos dans « Photos d'intervention ».
//  photos = { add: [{ id (file_upload), name }], remove: [noms] }
function writePageSummary_(pageId, state, opts) {
  opts = opts || {};
  const warnings = [];
  const page = notion_('GET', '/pages/' + pageId);
  const names = summaryProps_(page, warnings);
  const props = {};

  if (names.summary) {
    const actions = summaryActions_(page, !!opts.forceActions);
    const rich = summaryRichText_(buildSummary_(state, actions, referenceOf_(page, opts.reference || '')));
    const cache = CacheService.getScriptCache();
    const hk = 'sumh:' + pageId;
    const h = summaryHash_(JSON.stringify(rich));
    if (cache.get(hk) !== h || opts.forceWrite) {
      props[names.summary] = { rich_text: rich };
      cache.put(hk, h, 21600);
    }
  }

  const ph = opts.photos;
  if (names.photos && ph && ((ph.add && ph.add.length) || (ph.remove && ph.remove.length))) {
    const drop = {};
    (ph.remove || []).forEach(function (n) { drop[n] = true; });
    const keep = (page.properties[names.photos].files || []).filter(function (f) { return !drop[f.name]; });
    props[names.photos] = { files: keep.concat((ph.add || []).map(function (a) {
      return { name: a.name, type: 'file_upload', file_upload: { id: a.id } };
    })) };
  }

  if (Object.keys(props).length) notion_('PATCH', '/pages/' + pageId, { properties: props });
  return warnings;
}

// Appel « sans risque » : jamais d'exception vers l'appelant.
function writePageSummarySafe_(pageId, state, opts) {
  try {
    return writePageSummary_(pageId, state, opts);
  } catch (err) {
    return [{ code: 'SUMMARY_ERROR', message: 'Synthèse non mise à jour : ' + (err && err.message) }];
  }
}

// À lancer dans l'éditeur Apps Script : vérifie que les deux colonnes existent (avec TEST_REFERENCE) et écrit la synthèse.
function testSummary() {
  const page = findPageByReference_(cfg_('TEST_REFERENCE', 'FI-252'));
  const cfg = summaryCfg_();
  [[cfg.summary, 'rich_text', 'Texte'], [cfg.photos, 'files', 'Fichiers et médias']].forEach(function (c) {
    const n = findProp_(page, c[0]);
    Logger.log('%s : %s', c[0], !n ? 'INTROUVABLE (créez une colonne ' + c[2] + ')' : page.properties[n].type === c[1] ? 'OK' : 'type ' + page.properties[n].type + ' au lieu de ' + c[2]);
  });
  const st = loadState_(plainId_(page.id));
  Logger.log(JSON.stringify(writePageSummarySafe_(plainId_(page.id), st, { forceActions: true, forceWrite: true })));
}
