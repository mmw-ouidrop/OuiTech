/**
 * ============================================================================
 *  Methods.gs — Fiches méthodes (base Notion « MO Maintenance Physique »)
 * ============================================================================
 *
 *  Lecture seule. Deux routes de données + une route de médias :
 *
 *    GET ?action=methods&sinceRev=…&session=…
 *        → { unchanged:true, rev }  ou
 *          { rev, items:[ { id, title, groups:[…], status, updated, summary } ] }
 *
 *    GET ?action=method&id=<pageId>&sinceEdited=…&session=…
 *        → { unchanged:true } ou la fiche :
 *          { id, title, groups, status, updated, notes, errors,
 *            links:[{label,url,kind}],            Doc, Dossier
 *            support:[{key,name}],                fichiers de la colonne « Support »
 *            media:[{key,kind,name,caption}],     colonne « Medias » puis images/vidéos du corps
 *            hero:{key,kind}|null,                bandeau du haut
 *            sections:[{title,kind,nodes:[…]}],   corps découpé par grands titres
 *            warnings:[…] }
 *
 *    GET ?action=methodMedia&page=<pageId>&key=<clé>&mode=data|url&session=…
 *        → { name, mime, size, data(base64) }            image / fichier ≤ 6 Mo
 *        → { name, mime, size, tooLarge:true, url }      fichier plus gros : lien frais (≈ 1 h)
 *        → { name, mime, url }                           mode=url : lien frais sans téléchargement
 *      Les adresses des fichiers hébergés par Notion expirent au bout d'environ une heure : la PWA ne
 *      les stocke jamais, elle demande le fichier ici (et garde l'image en mémoire locale pour le hors-ligne).
 *
 *  PROPRIÉTÉS DE SCRIPT (toutes facultatives)
 *    METHODS_DB_ID          ID de la base. Défaut : 34937d20ee35803c8909cf0fd8cda157
 *    METHODS_PROP_GROUP     colonne de regroupement (multi-sélection). Défaut : Ensemble
 *    METHODS_PROP_STATUS    Défaut : Statut
 *    METHODS_PROP_DOC       Défaut : Doc        (URL)
 *    METHODS_PROP_FOLDER    Défaut : Dossier    (URL)
 *    METHODS_PROP_SUPPORT   Défaut : Support    (fichiers)
 *    METHODS_PROP_MEDIAS    Défaut : Medias     (fichiers)
 *    METHODS_PROP_NOTES     Défaut : Notes      (texte)
 *    METHODS_PROP_ERRORS    Défaut : Erreurs Associées
 *    METHODS_HIDDEN_STATUS  statuts non publiés aux techniciens, séparés par « | ». Défaut : Pas commencé
 *    METHODS_HIDDEN_TITLES  titres de fiches à ne pas publier, séparés par « | ». Défaut : (aucun)
 *
 *  L'intégration Notion doit être connectée à la base (⋯ ▸ Connexions).
 * ============================================================================
 */

const METHODS_DB_DEFAULT = '34937d20ee35803c8909cf0fd8cda157';
const METHODS_MAX_PAGES = 5;                 // 5 × 100 fiches maximum
const METHODS_MAX_DEPTH = 3;                 // niveaux d'imbrication lus dans le corps
const METHODS_MAX_CALLS = 60;                // requêtes Notion maximum pour une fiche
const METHODS_MEDIA_MAX_BYTES = 6 * 1024 * 1024;
const METHODS_LIST_CACHE_SECONDS = 120;

function methodsCfg_() {
  return {
    db: String(cfg_('METHODS_DB_ID', METHODS_DB_DEFAULT)).replace(/-/g, ''),
    group: cfg_('METHODS_PROP_GROUP', 'Ensemble'),
    status: cfg_('METHODS_PROP_STATUS', 'Statut'),
    doc: cfg_('METHODS_PROP_DOC', 'Doc'),
    folder: cfg_('METHODS_PROP_FOLDER', 'Dossier'),
    support: cfg_('METHODS_PROP_SUPPORT', 'Support'),
    medias: cfg_('METHODS_PROP_MEDIAS', 'Medias'),
    notes: cfg_('METHODS_PROP_NOTES', 'Notes'),
    errors: cfg_('METHODS_PROP_ERRORS', 'Erreurs Associées'),
    comments: cfg_('METHODS_PROP_COMMENTS', 'Commentaires'),
    hiddenStatus: nameList_('METHODS_HIDDEN_STATUS', ['Pas commencé']),
    hiddenTitles: nameList_('METHODS_HIDDEN_TITLES', [])
  };
}

function plainId_(id) {
  return String(id || '').replace(/-/g, '').toLowerCase();
}

function methodPageId_(input) {
  const id = plainId_(input);
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ApiError_('BAD_REQUEST', 'Identifiant de fiche invalide');
  return id;
}

function propOf_(page, name) {
  return page.properties ? page.properties[name] : undefined;
}

function titleOfPage_(page) {
  const names = Object.keys(page.properties || {});
  for (let i = 0; i < names.length; i++) {
    if (page.properties[names[i]].type === 'title') return plain_(page.properties[names[i]].title).trim();
  }
  return '';
}

function choiceNames_(prop) {
  if (!prop) return [];
  if (prop.type === 'multi_select') return prop.multi_select.map(function (o) { return o.name; });
  if (prop.type === 'select') return prop.select ? [prop.select.name] : [];
  if (prop.type === 'status') return prop.status ? [prop.status.name] : [];
  return [];
}

function textOfProp_(prop) {
  if (!prop) return '';
  const v = formatProperty_(prop);
  if (v === null || v === undefined) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

function urlOfProp_(prop) {
  if (!prop) return '';
  if (prop.type === 'url') return prop.url || '';
  if (prop.type === 'rich_text') return plain_(prop.rich_text).trim();
  return '';
}

function isHiddenMethod_(page, c) {
  const status = choiceNames_(propOf_(page, c.status))[0] || '';
  if (status && c.hiddenStatus.indexOf(status) > -1) return true;
  return c.hiddenTitles.indexOf(titleOfPage_(page)) > -1;
}

/* ─────────────────────────────── Liste ──────────────────────────────────── */

function hash_(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function shorten_(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function getMethods_(p) {
  const c = methodsCfg_();
  const cache = CacheService.getScriptCache();
  let list = null;
  const cached = cache.get('methods:list');
  if (cached) {
    try { list = JSON.parse(cached); } catch (err) { list = null; }
  }
  if (!list) {
    const items = [];
    let cursor = null;
    for (let n = 0; n < METHODS_MAX_PAGES; n++) {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = notion_('POST', '/databases/' + c.db + '/query', body);
      (res.results || []).forEach(function (page) {
        if (isHiddenMethod_(page, c)) return;
        const title = titleOfPage_(page);
        if (!title) return;
        items.push({
          id: plainId_(page.id),
          title: title,
          groups: choiceNames_(propOf_(page, c.group)),
          status: choiceNames_(propOf_(page, c.status))[0] || '',
          updated: page.last_edited_time || '',
          summary: shorten_(textOfProp_(propOf_(page, c.notes)), 160)
        });
      });
      if (!res.has_more) break;
      cursor = res.next_cursor;
    }
    items.sort(function (a, b) { return a.title.localeCompare(b.title, 'fr'); });
    list = { rev: hash_(items.map(function (i) { return i.id + '|' + i.updated + '|' + i.title + '|' + i.groups.join(',') + '|' + i.status; }).join('\n')), items: items };
    const text = JSON.stringify(list);
    if (text.length < 90000) cache.put('methods:list', text, METHODS_LIST_CACHE_SECONDS);
  }
  if (p && p.sinceRev && p.sinceRev === list.rev) return { unchanged: true, rev: list.rev };
  return list;
}

/* ──────────────────────────────── Fiche ─────────────────────────────────── */

function normText_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function sectionKind_(title) {
  const t = normText_(title);
  if (/(materiel|fourniture|piece)/.test(t)) return 'materials';
  if (/outil/.test(t)) return 'tools';
  if (/^(avant|prerequis|securite|consigne|precaution)/.test(t)) return 'before';
  if (/(resume|objectif|principe)/.test(t)) return 'summary';
  if (/(etape|procedure|realisation|mode operatoire|intervention|demarche|depannage)/.test(t)) return 'steps';
  if (/photo/.test(t)) return 'photos';
  return 'other';
}

function rich_to_segments_(rich) {
  return (rich || []).map(function (r) {
    const seg = { t: r.plain_text !== undefined ? r.plain_text : ((r.text && r.text.content) || '') };
    const a = r.annotations || {};
    if (a.bold) seg.b = 1;
    if (a.italic) seg.i = 1;
    if (a.strikethrough) seg.s = 1;
    if (a.underline) seg.u = 1;
    if (a.code) seg.c = 1;
    const href = r.href || (r.text && r.text.link && r.text.link.url);
    if (href) seg.h = href;
    return seg;
  }).filter(function (s) { return s.t !== ''; });
}

function fileInfo_(data) {
  // data = contenu d'un bloc image/video/file/pdf : { type:'file'|'external', file:{url}|external:{url}, caption }
  if (!data) return { url: '', external: false };
  if (data.type === 'external') return { url: (data.external || {}).url || '', external: true };
  return { url: (data.file || {}).url || '', external: false };
}

function fetchMethodBlocks_(blockId, depth, budget) {
  const out = [];
  let cursor = null;
  do {
    if (budget.calls >= METHODS_MAX_CALLS) { budget.truncated = true; return out; }
    budget.calls++;
    const query = '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
    const res = notion_('GET', '/blocks/' + blockId + '/children' + query);
    (res.results || []).forEach(function (b) { out.push(b); });
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  if (depth < METHODS_MAX_DEPTH) {
    out.forEach(function (b) {
      if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database') {
        b._children = fetchMethodBlocks_(b.id, depth + 1, budget);
      }
    });
  }
  return out;
}

// Blocs Notion → nœuds simples pour la PWA.
function convertMethodBlocks_(blocks) {
  const nodes = [];
  blocks.forEach(function (b) {
    const t = b.type;
    const d = b[t] || {};
    const kids = function () { return b._children ? convertMethodBlocks_(b._children) : []; };
    switch (t) {
      case 'paragraph':
        nodes.push({ k: 'p', rt: rich_to_segments_(d.rich_text), kids: kids() });
        break;
      case 'heading_1': case 'heading_2': case 'heading_3':
        nodes.push({ k: 'h', l: Number(t.slice(-1)), rt: rich_to_segments_(d.rich_text), kids: kids() });
        break;
      case 'bulleted_list_item': case 'numbered_list_item':
        nodes.push({ k: 'li', n: t === 'numbered_list_item' ? 1 : 0, rt: rich_to_segments_(d.rich_text), kids: kids() });
        break;
      case 'to_do':
        nodes.push({ k: 'todo', done: !!d.checked, rt: rich_to_segments_(d.rich_text), kids: kids() });
        break;
      case 'quote':
        nodes.push({ k: 'quote', rt: rich_to_segments_(d.rich_text), kids: kids() });
        break;
      case 'callout':
        nodes.push({ k: 'callout', icon: d.icon && d.icon.type === 'emoji' ? d.icon.emoji : '', rt: rich_to_segments_(d.rich_text), kids: kids() });
        break;
      case 'toggle':
        nodes.push({ k: 'toggle', rt: rich_to_segments_(d.rich_text), kids: kids() });
        break;
      case 'divider':
        nodes.push({ k: 'hr' });
        break;
      case 'code':
        nodes.push({ k: 'code', lang: d.language || '', text: plain_(d.rich_text) });
        break;
      case 'image': {
        const f = fileInfo_(d);
        nodes.push({ k: 'image', key: b.id, cap: rich_to_segments_(d.caption), ext: f.external ? 1 : 0 });
        break;
      }
      case 'video': {
        const f = fileInfo_(d);
        // Vidéo hébergée par un service (YouTube, Vimeo, Loom…) : on garde son adresse ; fichier Notion : clé.
        nodes.push(f.external
          ? { k: 'video', url: f.url, cap: rich_to_segments_(d.caption) }
          : { k: 'video', key: b.id, cap: rich_to_segments_(d.caption) });
        break;
      }
      case 'pdf': case 'file': case 'audio': {
        const f = fileInfo_(d);
        const name = d.name || plain_(d.caption) || (f.url ? decodeURIComponent(f.url.split('?')[0].split('/').pop() || '') : '') || 'Fichier';
        nodes.push(f.external
          ? { k: 'link', url: f.url, title: name }
          : { k: 'file', key: b.id, name: name, cap: rich_to_segments_(d.caption) });
        break;
      }
      case 'bookmark': case 'embed': case 'link_preview':
        if (d.url) nodes.push({ k: 'link', url: d.url, title: plain_(d.caption) || d.url });
        break;
      case 'table': {
        const rows = (b._children || []).filter(function (r) { return r.type === 'table_row'; }).map(function (r) {
          return (r.table_row.cells || []).map(function (cell) { return rich_to_segments_(cell); });
        });
        nodes.push({ k: 'table', header: !!d.has_column_header, rows: rows });
        break;
      }
      case 'column_list': case 'column': case 'synced_block':
        kids().forEach(function (n) { nodes.push(n); });
        break;
      default:
        break;       // blocs sans équivalent (sous-pages, équations…) : ignorés
    }
  });
  return nodes;
}

function collectMedia_(nodes, out) {
  nodes.forEach(function (n) {
    if (n.k === 'image' || (n.k === 'video' && n.key)) {
      out.push({ key: n.key, kind: n.k, name: '', caption: n.cap ? n.cap.map(function (s) { return s.t; }).join('') : '' });
    }
    if (n.kids) collectMedia_(n.kids, out);
  });
}

function splitSections_(nodes) {
  let top = 0;
  nodes.forEach(function (n) { if (n.k === 'h' && (!top || n.l < top)) top = n.l; });
  const sections = [];
  let cur = null;
  nodes.forEach(function (n) {
    if (n.k === 'h' && n.l === top) {
      const title = n.rt.map(function (s) { return s.t; }).join('').trim();
      cur = { title: title, kind: sectionKind_(title), nodes: (n.kids || []).slice() };
      sections.push(cur);
      return;
    }
    if (!cur) { cur = { title: '', kind: 'intro', nodes: [] }; sections.push(cur); }
    cur.nodes.push(n);
  });
  return sections.filter(function (s) { return s.title || s.nodes.length; });
}

function filesOfProp_(prop) {
  if (!prop || prop.type !== 'files') return [];
  return prop.files || [];
}

function getMethod_(p) {
  const c = methodsCfg_();
  const pageId = methodPageId_(p.id);
  const page = notion_('GET', '/pages/' + pageId);
  assertMethodPage_(page, c);
  if (page.archived) throw new ApiError_('NOT_FOUND', 'Fiche introuvable');
  if (p.sinceEdited && p.sinceEdited === page.last_edited_time) return { unchanged: true, updated: page.last_edited_time };

  const budget = { calls: 0, truncated: false };
  const blocks = fetchMethodBlocks_(pageId, 0, budget);
  const nodes = convertMethodBlocks_(blocks);
  const sections = splitSections_(nodes);

  // Colonne « Medias » : l'ordre de Notion est conservé tel quel (carrousel). Une adresse externe (YouTube, Vimeo, Loom…)
  // devient une vidéo intégrée ; un fichier se reconnaît à son extension.
  const media = [];
  filesOfProp_(propOf_(page, c.medias)).forEach(function (f, i) {
    const info = fileInfo_(f);
    const key = 'p:' + c.medias + ':' + i;
    const isVideoFile = /\.(mp4|mov|webm|m4v)(\?|$)/i.test(info.url) || /\.(mp4|mov|webm|m4v)$/i.test(f.name || '');
    if (info.external && /^https?:\/\//.test(info.url) && !/\.(jpe?g|png|gif|webp|avif|heic)(\?|$)/i.test(info.url) && !isVideoFile) {
      media.push({ key: key, kind: 'video', url: info.url, name: f.name || '', caption: '' });     // page vidéo hébergée ailleurs
    } else {
      media.push({ key: key, kind: isVideoFile ? 'video' : 'image', name: f.name || '', caption: '' });
    }
  });
  const bodyMedia = [];
  collectMedia_(nodes, bodyMedia);
  const hero = media[0] || bodyMedia[0] || null;
  const comments = readComments_(page, c);

  const links = [];
  const doc = urlOfProp_(propOf_(page, c.doc));
  if (/^https?:\/\//.test(doc)) links.push({ label: 'Document détaillé', url: doc, kind: 'doc' });
  const folder = urlOfProp_(propOf_(page, c.folder));
  if (/^https?:\/\//.test(folder)) links.push({ label: 'Dossier de photos et vidéos', url: folder, kind: 'folder' });

  const support = filesOfProp_(propOf_(page, c.support)).map(function (f, i) {
    return { key: 'p:' + c.support + ':' + i, name: f.name || 'Support' };
  });

  const warnings = [];
  if (budget.truncated) warnings.push({ code: 'TRUNCATED', message: 'Fiche très longue : la fin n’est pas affichée, voir le document détaillé' });

  return {
    v: 2,                                            // version du format : la PWA relit les fiches enregistrées avant
    id: pageId,
    title: titleOfPage_(page),
    groups: choiceNames_(propOf_(page, c.group)),
    status: choiceNames_(propOf_(page, c.status))[0] || '',
    updated: page.last_edited_time || '',
    notes: textOfProp_(propOf_(page, c.notes)),
    errors: textOfProp_(propOf_(page, c.errors)),
    links: links,
    support: support,
    media: media.concat(bodyMedia),
    gallery: media,                                  // colonne « Medias », dans l'ordre de Notion (carrousel)
    hero: hero ? { key: hero.key, kind: hero.kind } : null,
    commentsEnabled: comments.enabled,
    comments: comments.items,
    sections: sections,
    warnings: warnings
  };
}

function assertMethodPage_(page, c) {
  const parent = page && page.parent;
  if (!parent || plainId_(parent.database_id) !== c.db) {
    throw new ApiError_('NOT_FOUND', 'Fiche introuvable');
  }
}

/* ─────────────────────────────── Médias ─────────────────────────────────── */

// Remonte de bloc en bloc jusqu'à la page : seuls les médias d'une fiche de la base sont servis.
function blockBelongsToPage_(block, pageId) {
  let cur = block;
  for (let hops = 0; hops < 6 && cur; hops++) {
    const par = cur.parent || {};
    if (par.type === 'page_id') return plainId_(par.page_id) === pageId;
    if (par.type === 'block_id') cur = notion_('GET', '/blocks/' + par.block_id);
    else return false;
  }
  return false;
}

function mediaSource_(page, key, allowedProps) {
  // → { url, name, mime }
  const m = String(key || '').match(/^p:(.+):(\d{1,3})$/);
  if (m) {
    if (allowedProps.indexOf(m[1]) === -1) throw new ApiError_('BAD_REQUEST', 'Clé de média invalide');
    const files = filesOfProp_(propOf_(page, m[1]));
    const f = files[Number(m[2])];
    if (!f) throw new ApiError_('NOT_FOUND', 'Média introuvable');
    return { url: fileInfo_(f).url, name: f.name || '' };
  }
  const blockId = plainId_(key);
  if (!/^[0-9a-f]{32}$/.test(blockId)) throw new ApiError_('BAD_REQUEST', 'Clé de média invalide');
  const block = notion_('GET', '/blocks/' + blockId);
  if (block.archived || !blockBelongsToPage_(block, plainId_(page.id))) throw new ApiError_('NOT_FOUND', 'Média introuvable');
  if (['image', 'video', 'file', 'pdf', 'audio'].indexOf(block.type) === -1) throw new ApiError_('NOT_FOUND', 'Média introuvable');
  const d = block[block.type] || {};
  const url = fileInfo_(d).url;
  const nameFromUrl = url ? decodeURIComponent(url.split('?')[0].split('/').pop() || '') : '';
  return { url: url, name: d.name || nameFromUrl || block.type };
}

function getMethodMedia_(p) {
  const c = methodsCfg_();
  const pageId = methodPageId_(p.page);
  const page = notion_('GET', '/pages/' + pageId);
  assertMethodPage_(page, c);
  return deliverMedia_(mediaSource_(page, p.key, [c.medias, c.support]), p.mode);
}

// Télécharge le fichier (adresse fraîche fournie par Notion) et le renvoie en base64, ou renvoie seulement le lien.
function deliverMedia_(src, mode) {
  if (!src.url || !/^https:\/\//.test(src.url)) throw new ApiError_('NOT_FOUND', 'Média introuvable');
  if (mode === 'url') return { name: src.name, url: src.url };

  const res = UrlFetchApp.fetch(src.url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) {
    throw new ApiError_('MEDIA_UNAVAILABLE', 'Le fichier n’a pas pu être récupéré (HTTP ' + res.getResponseCode() + ')');
  }
  const blob = res.getBlob();
  const bytes = blob.getBytes();
  const mime = blob.getContentType() || 'application/octet-stream';
  if (bytes.length > METHODS_MEDIA_MAX_BYTES) {
    return { name: src.name, mime: mime, size: bytes.length, tooLarge: true, url: src.url };
  }
  return { name: src.name, mime: mime, size: bytes.length, data: Utilities.base64Encode(bytes) };
}

/* ───────────────────────────── Commentaires ─────────────────────────────── */

// Colonne texte « Commentaires » de la fiche : un commentaire par paragraphe, du plus ancien au plus récent.
//     Prénom Nom · 29/10/2026 08:22
//     texte (une ou plusieurs lignes)
const COMMENT_SEP = '\n\n';
const COMMENT_MAX_CHARS = 1000;          // par commentaire
const COMMENT_PROP_MAX_CHARS = 12000;    // au-delà, les plus anciens sont retirés

function stamp_() {
  return Utilities.formatDate(new Date(Date.now()), TZ, 'dd/MM/yyyy HH:mm');
}

function cleanName_(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function parseComments_(text) {
  return String(text || '').split(/\n{2,}/).map(function (block) {
    const lines = block.replace(/\r/g, '').split('\n');
    const m = lines[0].match(/^(.*?) · (\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})$/);
    if (!m) return block.trim() ? { by: '', at: '', text: block.trim() } : null;   // texte ajouté à la main dans Notion
    return { by: m[1], at: m[2], text: lines.slice(1).join('\n').trim() };
  }).filter(Boolean);
}

function readComments_(page, c) {
  const prop = propOf_(page, c.comments);
  if (!prop || prop.type !== 'rich_text') return { enabled: false, items: [] };
  return { enabled: true, items: parseComments_(plain_(prop.rich_text)) };
}

// Découpe un texte en éléments rich_text de 2000 caractères au plus (limite de l'API Notion).
function richChunks_(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1900) out.push({ type: 'text', text: { content: text.slice(i, i + 1900) } });
  return out;
}

// Ajoute `block` à la fin d'une colonne texte (ou au début : `atStart`), sous verrou, sans jamais perdre le contenu existant.
// Retire les plus anciens blocs si la colonne dépasse COMMENT_PROP_MAX_CHARS. `dedupeId` : rejeu sans effet pendant 6 h.
function appendToTextProp_(pageId, propName, block, opts) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const cache = CacheService.getScriptCache();
    const dedupeKey = opts.dedupeId ? 'w:' + opts.dedupeId : '';
    if (dedupeKey && cache.get(dedupeKey)) return { duplicate: true };
    const page = notion_('GET', '/pages/' + pageId);
    opts.check(page);
    const prop = propOf_(page, propName);
    if (!prop || prop.type !== 'rich_text') {
      throw new ApiError_('COLUMN_MISSING', 'La colonne « ' + propName + ' » (type Texte) n’existe pas dans la base Notion : créez-la, puis réessayez.');
    }
    const sep = opts.separator;
    let blocks = plain_(prop.rich_text).split(sep).filter(function (b) { return b.trim(); });
    if (opts.replace) blocks = [];
    if (opts.atStart) blocks.unshift(block); else blocks.push(block);
    let text = blocks.join(sep);
    while (text.length > COMMENT_PROP_MAX_CHARS && blocks.length > 1) {
      if (opts.atStart) blocks.pop(); else blocks.shift();
      text = blocks.join(sep);
    }
    const props = {};
    props[propName] = { rich_text: richChunks_(text) };
    notion_('PATCH', '/pages/' + pageId, { properties: props });
    if (dedupeKey) cache.put(dedupeKey, '1', SYNC_CACHE_SECONDS);
    return { duplicate: false, text: text, page: page };
  } finally {
    lock.releaseLock();
  }
}

function postMethodComment_(body) {
  const c = methodsCfg_();
  const pageId = methodPageId_(body.pageId);
  const by = cleanName_(body.name);
  if (!by) throw new ApiError_('AUTHOR_REQUIRED', 'Indiquez votre nom (Réglages) avant de commenter.');
  const text = String(body.text || '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
  if (!text) throw new ApiError_('BAD_REQUEST', 'Le commentaire est vide.');
  if (text.length > COMMENT_MAX_CHARS) throw new ApiError_('BAD_REQUEST', 'Commentaire trop long (' + COMMENT_MAX_CHARS + ' caractères au plus).');
  const dedupeId = String(body.id || '').slice(0, 64);
  const r = appendToTextProp_(pageId, c.comments, by + ' · ' + stamp_() + '\n' + text, {
    separator: COMMENT_SEP, dedupeId: dedupeId, check: function (page) { assertMethodPage_(page, c); }
  });
  if (r.duplicate) return { duplicate: true };
  return { duplicate: false, comments: parseComments_(r.text) };
}

/* ─────────────────────────── Test dans l'éditeur ────────────────────────── */

// À lancer dans l'éditeur Apps Script : vérifie l'accès à la base et résume ce qui sera publié.
function testMethods() {
  const c = methodsCfg_();
  const list = getMethods_({});
  Logger.log('Base %s : %s fiche(s) publiée(s)', c.db, list.items.length);
  const groups = {};
  list.items.forEach(function (i) {
    (i.groups.length ? i.groups : ['(sans ensemble)']).forEach(function (g) { groups[g] = (groups[g] || 0) + 1; });
  });
  Object.keys(groups).sort().forEach(function (g) { Logger.log('  %s : %s', g, groups[g]); });
  if (list.items.length) {
    const m = getMethod_({ id: list.items[0].id });
    Logger.log('Exemple « %s » : %s section(s), %s média(s), %s lien(s)', m.title, m.sections.length, m.media.length, m.links.length);
  }
}
