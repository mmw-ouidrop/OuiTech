// Doublures de Notion, Drive et des services Apps Script pour tester Code.gs + Report.gs.
// Notion simulé : VRAI arbre de blocs (parents/enfants, pagination, mise à jour,
// suppression, insertion à une position), avec les limites documentées de l'API.
// Ce n’est pas le vrai Notion : seule la fonction testNotionCapabilities() (Apps Script) vérifie votre espace de travail.
// (fonction testNotionCapabilities dans Apps Script) valide le contrat réel.
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

export const ROOT = 'ROOT_FOLDER_ID_0000000000000000';
export const PAGE = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';
export const DB = '11111111222233334444555555555555';
export const MDB = '34937d20ee35803c8909cf0fd8cda157';
export const RDB = '27e37d20ee35806294f7f3bf21b1d545';
export const MCDB = '26b37d20ee3580f3b76dc45d5073b74c';
export const TOKEN = 'tok_test';
export const PW_TECH = 'tech-pass-12345';
export const PW_SUPPORT = 'support-pass-67890';
export const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const dash = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
const norm = (id) => String(id).replace(/-/g, '');
const RICH_KEYS = new Set(['rich_text', 'caption']);

export function makeWorld() {
  const w = {
    calls: [], blocks: {}, kids: {}, drive: {}, folders: {}, uploads: {}, seq: 0, now: Date.parse('2026-10-20T08:00:00Z'),
    positionMode: 'both',          // both | after-only | none : ce que « Notion » accepte
    pageDb: null, failNext: null, pageSize: 100, props: {}, stored: {}
  };
  w.id = () => dash(String(++w.seq).padStart(32, '0'));
  w.fid = (p) => p + '_' + String(++w.seq).padStart(20, '0');

  const withPlain = (o) => {
    if (Array.isArray(o)) return o.map(withPlain);
    if (o && typeof o === 'object') {
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
        RICH_KEYS.has(k) && Array.isArray(v) ? v.map((t) => ({ ...t, plain_text: t.text.content })) : withPlain(v)]));
    }
    return o;
  };

  // Limites de l'API : 100 enfants, 2 niveaux d'imbrication, 2000 caractères, 100 éléments de rich_text.
  const validate = (block, depth) => {
    assert.ok(depth <= 2, 'Notion : 2 niveaux d’imbrication au maximum par requête');
    const body = block[block.type];
    assert.ok(body, 'bloc sans contenu : ' + block.type);
    for (const k of RICH_KEYS) {
      if (body[k]) {
        assert.ok(body[k].length <= 100, 'rich_text : 100 éléments maximum');
        body[k].forEach((t) => assert.ok(t.text.content.length <= 2000, 'rich_text : 2000 caractères maximum'));
      }
    }
    if (body.children) {
      assert.ok(body.children.length <= 100, 'Notion : 100 enfants maximum par tableau');
      body.children.forEach((c) => validate(c, depth + 1));
    }
  };

  // Comme Notion : un bloc dont un ancêtre est archivé est inaccessible.
  const dead = (b) => { for (let x = b; x && x.id; x = w.blocks[x.parent]) { if (x.archived) return true; } return false; };
  const create = (parentId, spec) => {
    const id = w.id();
    const { children, ...rest } = spec[spec.type];
    const b = { object: 'block', id, type: spec.type, parent: parentId, archived: false, [spec.type]: withPlain(rest) };
    if (spec.type === 'image' && !rest.external && !rest.file) {
      const fu = rest.file_upload && w.uploads[rest.file_upload.id];
      assert.ok(fu && fu.sent, 'image : file_upload inconnu ou non envoyé');
      assert.ok(!fu.attached, 'image : file_upload déjà utilisé');
      fu.attached = true;
    }
    w.blocks[id] = b;
    w.kids[id] = [];
    (children || []).forEach((c) => { w.kids[id].push(create(id, c).id); });
    return b;
  };
  w.seedChildren = (parentId, specs) => specs.map((s) => {
    const b = create(dash(norm(parentId)), s);
    w.kids[dash(norm(parentId))].push(b.id);
    return b;
  });
  const key = (id) => dash(norm(id));
  w.kids[key(PAGE)] = [];
  w.blocks[key(PAGE)] = { id: key(PAGE), type: 'page' };

  /* ── Fiches méthodes : base MDB, pages, fichiers téléchargeables ── */
  w.methodPages = [];
  w.files = {};                    // url → { bytes:number[], mime, status? }
  w.methodQueryPageSize = 100;
  w.addMethod = ({ title, groups = [], status = 'Terminé', doc = '', folder = '', notes = '', edited = '2026-10-19T08:00:00Z', support = [], medias = [], blocks = [], archived = false, parentDb }) => {
    const id = w.id();
    const nid = norm(id);
    w.blocks[id] = { id, type: 'page' };
    w.kids[id] = [];
    const page = {
      id, archived, url: 'https://notion.so/m', last_edited_time: edited,
      parent: { type: 'database_id', database_id: dash(parentDb || MDB) },
      properties: {
        Nom: { type: 'title', title: [{ plain_text: title }] },
        Ensemble: { type: 'multi_select', multi_select: groups.map((name) => ({ name })) },
        Statut: { type: 'status', status: { name: status } },
        Doc: { type: 'url', url: doc || null },
        Dossier: { type: 'url', url: folder || null },
        Notes: { type: 'rich_text', rich_text: notes ? [{ plain_text: notes }] : [] },
        Support: { type: 'files', files: support.map((f) => ({ name: f.name, type: 'file', file: { url: f.url } })) },
        Medias: { type: 'files', files: medias.map((f) => ({ name: f.name, type: 'file', file: { url: f.url } })) }
      }
    };
    w.methodPages.push(page);
    blocks.forEach((spec) => { const b = create(id, spec); w.kids[id].push(b.id); });
    return { id, nid, page };
  };
  // Machines : propriétés données telles quelles (types Notion), pages liées (région, client) dans une autre base.
  w.machinePages = [];
  w.comments = [];
  w.addMachine = ({ props = {}, edited = '2026-10-19T08:00:00Z', blocks = [], archived = false, parentDb }) => {
    const id = w.id();
    w.blocks[id] = { id, type: 'page' };
    w.kids[id] = [];
    const page = { id, archived, last_edited_time: edited, parent: { type: 'database_id', database_id: dash(parentDb || MCDB) }, properties: props };
    w.machinePages.push(page);
    blocks.forEach((spec) => { const b = create(id, spec); w.kids[id].push(b.id); });
    return { id, nid: norm(id), page };
  };
  // Racks / casiers : pages de la base RDB (État = select), filtrables par site (relation) et par état.
  w.addRack = ({ title, state = 'KO', site, cause = [], comment = '', edited = '2026-10-19T08:00:00Z', stateType = 'select' }) => {
    const props = {
      Name: { type: 'title', title: [{ plain_text: title }] },
      'État': stateType === 'select' ? { type: 'select', select: { name: state } } : { type: 'status', status: { name: state } },
      '🤖 Site': { type: 'relation', relation: site ? [].concat(site).map((id) => ({ id })) : [] },
      Cause: { type: 'multi_select', multi_select: cause.map((name) => ({ name })) }
    };
    if (comment !== null) props['Commentaire technicien'] = { type: 'rich_text', rich_text: comment ? [{ type: 'text', text: { content: comment }, plain_text: comment }] : [] };
    return w.addMachine({ props, edited, parentDb: RDB });
  };
  w.addNotionComment = (pageNid, text, by = 'u1', created = '2026-10-20T09:30:00Z') => {
    w.comments.push({ id: w.id(), parent: { page_id: pageNid }, created_time: created, created_by: { id: by }, rich_text: [{ plain_text: text, text: { content: text } }] });
  };
  w.addRelated = (title) => {
    const id = w.id();
    w.blocks[id] = { id, type: 'page' }; w.kids[id] = [];
    w.machinePages.push({ id, archived: false, last_edited_time: '2026-01-01T00:00:00Z', parent: { type: 'database_id', database_id: dash('99999999999999999999999999999999') }, properties: { Nom: { type: 'title', title: [{ plain_text: title }] } } });
    return id;
  };
  w.addFile = (url, bytes, mime = 'image/png') => { w.files[url] = { bytes: [...bytes], mime }; };

  const rtS = (t) => [{ type: 'text', text: { content: t } }];
  w.rt = rtS;
  // Page de mission : H1, 2 composants JSON, 1 to_do, 1 JSON invalide
  w.seedChildren(PAGE, [
    { type: 'heading_1', heading_1: { rich_text: rtS('Matériel') } },
    { type: 'code', code: { language: 'json', rich_text: rtS(JSON.stringify({ type: 'image_upload', id: 'photo_compteur', label: "Prendre en photo l'installation" })) } },
    { type: 'code', code: { language: 'json', rich_text: rtS(JSON.stringify({ type: 'radio_group', id: 'etat_materiel', label: 'État du matériel', options: ['Neuf', 'Usagé', 'Défectueux'] })) } },
    { type: 'to_do', to_do: { rich_text: rtS('Zone dégagée'), checked: false } },
    { type: 'code', code: { language: 'json', rich_text: rtS('{ pas du json') } }
  ]);

  // Aide pour les tests : arbre du rapport lisible. Le rapport est un toggle « CR intervention… » au niveau de la
  // page ; ses données sont un toggle frère « Données de synchronisation… ».
  const topLevel = () => w.kids[key(PAGE)].map((i) => w.blocks[i]).filter((b) => !b.archived);
  const title = (b) => (b[b.type].rich_text || []).map((t) => t.plain_text).join('');
  w.reportRoot = () => topLevel().find((b) => b.type === 'toggle' && title(b).startsWith('CR intervention'));
  w.reportCallout = w.reportRoot;                      // ancien nom, conservé pour les tests existants
  w.stateToggle = () => topLevel().find((b) => b.type === 'toggle' && title(b).startsWith('Données de synchronisation'));
  w.childrenOf = (id) => w.kids[key(id)].map((i) => w.blocks[i]).filter((b) => !b.archived);
  w.text = (b) => (b[b.type].rich_text || []).map((t) => t.plain_text).join('');
  w.visibleReport = () => w.childrenOf(w.reportRoot().id);
  w.stateJson = () => {
    const code = w.childrenOf(w.stateToggle().id).find((b) => b.type === 'code');
    return code[code.type].rich_text.map((x) => x.plain_text).join('');
  };
  w.stateRich = () => w.childrenOf(w.stateToggle().id).find((b) => b.type === 'code').code.rich_text;
  w.writes = () => w.calls.filter((c) => c.method !== 'GET' && !/\/query$/.test(c.path) && !c.path.startsWith('/file_uploads'));
  w.count = (method, re) => w.calls.filter((c) => c.method === method && re.test(c.path)).length;

  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body), getHeaders: () => ({}) });
  const err = (code, message) => res(code, { object: 'error', status: code, code: code === 404 ? 'object_not_found' : 'validation_error', message });

  const UrlFetchApp = {
    fetch(url, opts = {}) {
      if (!url.startsWith('https://api.notion.com/')) {
        w.calls.push({ method: 'GET', path: url, external: true });
        const f = w.files[url];
        if (!f) return { getResponseCode: () => 403, getContentText: () => 'expired', getHeaders: () => ({}) };
        return { getResponseCode: () => f.status || 200, getContentText: () => '', getHeaders: () => ({}), getBlob: () => newBlob(f.bytes, f.mime, 'x') };
      }
      let m;
      const [p0, qs] = url.replace('https://api.notion.com/v1', '').split('?');
      const method = (opts.method || 'get').toUpperCase();
      const body = opts.payload && typeof opts.payload === 'string' ? JSON.parse(opts.payload) : opts.payload;
      w.calls.push({ method, path: p0, body });
      assert.equal(opts.headers.Authorization, 'Bearer ' + TOKEN);
      assert.equal(opts.headers['Notion-Version'], '2022-06-28');
      if (w.failNext && w.failNext.test(method + ' ' + p0)) { const f = w.failNext; w.failNext = null; return res(f.code || 500, { message: 'panne simulée' }); }

      if (method === 'POST' && p0 === `/databases/${DB}/query`) {
        const n = body.filter.unique_id && body.filter.unique_id.equals;
        if (n !== 252) return res(200, { results: [] });
        return res(200, { results: [{
          id: dash(PAGE), url: 'https://notion.so/x', last_edited_time: '2026-10-19T08:00:00Z',
          properties: {
            Nom: { type: 'title', title: [{ plain_text: 'Remplacement compteur' }] },
            ID: { type: 'unique_id', unique_id: { prefix: 'FI', number: 252 } },
            Client: { type: 'rich_text', rich_text: [{ plain_text: 'Dupont' }] },
            Statut: { type: 'status', status: { name: 'À faire' } }
          } }] });
      }
      if (method === 'POST' && p0 === `/databases/${MDB}/query`) {
        const live = w.methodPages.filter((p) => !p.archived && norm(p.parent.database_id) === MDB);
        const start = Number((body && body.start_cursor) || 0);
        const size = Math.min((body && body.page_size) || 100, w.methodQueryPageSize);
        const more = start + size < live.length;
        return res(200, { results: live.slice(start, start + size), has_more: more, next_cursor: more ? String(start + size) : null });
      }
      if (method === 'GET' && p0 === `/databases/${RDB}`) {
        const sample = w.machinePages.find((p) => norm(p.parent.database_id) === RDB);
        const props = {};
        Object.entries((sample && sample.properties) || { 'État': { type: 'select' } }).forEach(([k, v]) => { props[k] = { type: v.type }; });
        if (props['État']) props['État'][props['État'].type] = { options: (w.stateOptions || ['KO', 'Remis', 'Dead']).map((name) => ({ name })) };
        return res(200, { properties: props });
      }
      if (method === 'POST' && p0 === `/databases/${RDB}/query`) {
        const match = (page, f) => {
          if (f.and) return f.and.every((x) => match(page, x));
          if (f.or) return f.or.some((x) => match(page, x));
          const prop = page.properties[f.property];
          if (!prop) return false;
          if (f.title) return prop.title.map((x) => x.plain_text).join('').toLowerCase().includes(f.title.contains.toLowerCase());
          if (f.select) { assert.equal(prop.type, 'select', 'filtre select sur une colonne ' + prop.type); return !!prop.select && prop.select.name === f.select.equals; }
          if (f.status) { assert.equal(prop.type, 'status', 'filtre status sur une colonne ' + prop.type); return !!prop.status && prop.status.name === f.status.equals; }
          if (f.relation) {
            const ids = prop.relation.map((r) => norm(r.id));
            if (f.relation.contains) return ids.includes(norm(f.relation.contains));
            if (f.relation.is_empty) return ids.length === 0;
          }
          throw new Error('filtre non géré par le simulateur : ' + JSON.stringify(f));
        };
        const live = w.machinePages.filter((p) => !p.archived && norm(p.parent.database_id) === RDB && (!body.filter || match(p, body.filter)));
        const start = Number((body && body.start_cursor) || 0);
        const more = start + 100 < live.length;
        return res(200, { results: live.slice(start, start + 100), has_more: more, next_cursor: more ? String(start + 100) : null });
      }
      if (p0 === '/comments') {
        if (w.noComments) return err(403, 'Insufficient permissions for this endpoint.');
        if (method === 'GET') {
          const bid = norm(new URLSearchParams(qs).get('block_id'));
          return res(200, { results: w.comments.filter((c) => norm(c.parent.page_id) === bid), has_more: false, next_cursor: null });
        }
        if (method === 'POST') {
          assert.ok(body.parent && body.parent.page_id && Array.isArray(body.rich_text));
          body.rich_text.forEach((t) => assert.ok(t.text.content.length <= 2000));
          const c = { id: w.id(), parent: { page_id: body.parent.page_id }, created_time: new Date(w.now).toISOString(), created_by: { id: 'bot' }, rich_text: body.rich_text.map((t) => ({ ...t, plain_text: t.text.content })) };
          w.comments.push(c);
          return res(200, c);
        }
      }
      m = p0.match(/^\/users\/([^/]+)$/);
      if (m && method === 'GET') return res(200, { id: m[1], name: (w.users || {})[m[1]] || null });
      m = p0.match(/^\/pages\/([^/]+)$/);
      if (m && method === 'PATCH') {
        const page = [...w.methodPages, ...w.machinePages].find((p) => norm(p.id) === norm(m[1]));
        if (!page) return err(404, 'Could not find page');
        Object.entries(body.properties || {}).forEach(([k, v]) => {
          if (!page.properties[k]) return;
          if (v.select || v.status) {
            const t = page.properties[k].type;
            assert.ok(v[t], 'type de colonne attendu : ' + t);
            if (w.failState) throw new Error('écriture d’état inattendue');
            page.properties[k] = { type: t, [t]: { name: v[t].name } };
          }
          if (v.rich_text) {
            v.rich_text.forEach((t) => assert.ok(t.text.content.length <= 2000, 'rich_text : 2000 caractères maximum'));
            page.properties[k] = { type: 'rich_text', rich_text: v.rich_text.map((t) => ({ ...t, plain_text: t.text.content })) };
          }
        });
        page.last_edited_time = new Date(w.now).toISOString();
        return res(200, page);
      }
      if (method === 'POST' && p0 === `/databases/${MCDB}/query`) {
        const live = w.machinePages.filter((p) => !p.archived && norm(p.parent.database_id) === MCDB);
        const start = Number((body && body.start_cursor) || 0);
        const more = start + 100 < live.length;
        return res(200, { results: live.slice(start, start + 100), has_more: more, next_cursor: more ? String(start + 100) : null });
      }
      m = p0.match(/^\/pages\/([^/]+)$/);
      if (m && method === 'GET' && [...w.methodPages, ...w.machinePages].some((p) => norm(p.id) === norm(m[1]))) {
        return res(200, [...w.methodPages, ...w.machinePages].find((p) => norm(p.id) === norm(m[1])));
      }
      if (method === 'GET' && p0 === `/pages/${PAGE}`) {
        return res(200, { parent: { database_id: w.pageDb || dash(DB) }, archived: false });
      }

      m = p0.match(/^\/blocks\/([^/]+)\/children$/);
      if (m) {
        const pid = key(m[1]);
        const parent = w.blocks[pid];
        if (!parent || dead(parent)) return err(404, 'Could not find block with ID: ' + m[1]);
        if (method === 'GET') {
          const q = new URLSearchParams(qs || '');
          const size = Math.min(Number(q.get('page_size') || 100), w.pageSize);
          const live = w.kids[pid].filter((i) => !w.blocks[i].archived);
          const start = Number(q.get('start_cursor') || 0);
          const slice = live.slice(start, start + size);
          const more = start + size < live.length;
          // comme Notion : `has_children` est renseigné sur chaque bloc renvoyé
          const out = slice.map((i) => { const b = w.blocks[i]; b.has_children = w.kids[i].some((k) => !w.blocks[k].archived); return b; });
          return res(200, { results: out, has_more: more, next_cursor: more ? String(start + size) : null });
        }
        if (method === 'PATCH') {
          assert.ok(Array.isArray(body.children) && body.children.length >= 1 && body.children.length <= 100, '1 à 100 enfants par requête');
          body.children.forEach((c) => validate(c, 1));
          const after = body.position ? (body.position.type === 'after_block' ? body.position.after_block.id : null) : body.after;
          if (body.position && w.positionMode !== 'both') return err(400, 'body failed validation: body.position should not exist');
          if (body.after && w.positionMode === 'none') return err(400, 'body failed validation: body.after should not exist');
          let at = w.kids[pid].length;
          if (after) {
            at = w.kids[pid].indexOf(key(after));
            if (at < 0) return err(400, 'Could not find the block to insert after');
            at += 1;
          }
          const made = body.children.map((c) => create(pid, c));
          w.kids[pid].splice(at, 0, ...made.map((b) => b.id));
          return res(200, { results: made.map((b) => w.blocks[b.id]) });
        }
      }

      m = p0.match(/^\/blocks\/([^/]+)$/);
      if (m) {
        const id = key(m[1]);
        const b = w.blocks[id];
        if (!b) return err(404, 'Could not find block with ID: ' + m[1]);
        if (method === 'GET') {
          if (dead(b)) return err(404, 'Could not find block with ID: ' + m[1]);
          const pb = w.blocks[b.parent];
          return res(200, { ...b, parent: pb && pb.type === 'page' ? { type: 'page_id', page_id: b.parent } : { type: 'block_id', block_id: b.parent } });
        }
        if (method === 'PATCH') {
          if (dead(b)) return err(400, "Can't edit block that is archived. You must unarchive the block before editing.");
          const t = Object.keys(body).find((k) => k !== 'archived');
          if (t !== b.type) return err(400, `Block type mismatch : ${b.type} / ${t}`);
          validate({ type: t, [t]: body[t] }, 1);
          b[t] = { ...b[t], ...withPlain(body[t]) };
          return res(200, b);
        }
        if (method === 'DELETE') {
          if (dead(b)) return err(400, "Can't edit block that is archived.");
          b.archived = true;
          return res(200, b);
        }
      }

      if (method === 'POST' && p0 === '/file_uploads') {
        const id = w.id();
        w.uploads[id] = { ...body, sent: false };
        return res(200, { id, status: 'pending' });
      }
      m = p0.match(/^\/file_uploads\/([^/]+)\/send$/);
      if (m && method === 'POST') {
        assert.ok(opts.payload.file && opts.payload.file.getContentType, 'multipart : champ file attendu');
        assert.equal(opts.contentType, undefined, 'pas de Content-Type forcé sur le multipart');
        w.uploads[m[1]].sent = true;
        return res(200, { id: m[1], status: 'uploaded' });
      }
      return err(404, 'route inconnue du simulateur : ' + method + ' ' + p0);
    }
  };

  /* ── Drive ── */
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const mkFolder = (id, name, parent) => ({
    id, name, parent, trashed: false,
    getId() { return id; }, getName() { return name; },
    setTrashed(v) { this.trashed = v; },
    getParents() { return iter(parent ? [w.folders[parent]] : []); },
    getFiles() { return iter(Object.values(w.drive).filter((f) => f.parent === id && !f.trashed)); },
    getFolders() { return iter(Object.values(w.folders).filter((f) => f.parent === id && !f.trashed)); },
    getFilesByName(n) { return iter(Object.values(w.drive).filter((f) => f.parent === id && f.name === n && !f.trashed)); },
    getFoldersByName(n) { return iter(Object.values(w.folders).filter((f) => f.parent === id && f.name === n && !f.trashed)); },
    createFolder(n) { const f = mkFolder(w.fid('fold'), n, id); w.folders[f.id] = f; return f; },
    createFile(blob) { const f = mkFile(w.fid('file'), blob.getName(), id, blob); w.drive[f.id] = f; return f; }
  });
  const mkFile = (id, name, parent, blob) => ({
    id, name, parent, trashed: false, blob, created: new Date(),
    getId() { return id; }, getName() { return name; }, isTrashed() { return this.trashed; },
    setTrashed(v) { this.trashed = v; }, getBlob() { return blob; },
    getParents() { return iter(w.folders[parent] ? [w.folders[parent]] : []); },
    getDateCreated() { return this.created; }
  });
  w.folders[ROOT] = mkFolder(ROOT, 'OUIDROP photos', null);
  w.mkFile = mkFile;

  const newBlob = (bytes, mime, name) => ({
    bytes, mime, name,
    getName() { return this.name; }, setName(n) { this.name = n; return this; },
    getContentType() { return this.mime; }, getBytes() { return this.bytes; },
    getDataAsString() { return Buffer.from(this.bytes.map((b) => (b < 0 ? b + 256 : b))).toString('utf8'); }
  });

  let cache = {};
  w.flushCache = () => { cache = {}; };
  w.cacheKeys = () => Object.keys(cache);
  const ctx = vm.createContext({
    console, Logger: { log() {} }, UrlFetchApp,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return s; } }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => ({ NOTION_TOKEN: TOKEN, NOTION_DB_ID: DB, DRIVE_FOLDER_ID: ROOT, PASSWORD_TECH: PW_TECH, PASSWORD_SUPPORT: PW_SUPPORT, TEST_PAGE_ID: PAGE, ...w.stored, ...w.props }[k] ?? null),
      setProperty: (k, v) => { w.stored[k] = String(v); }
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => cache[k] ?? null,
      put: (k, v) => { assert.ok(Buffer.byteLength(String(v)) <= 100 * 1024, 'CacheService : 100 Ko maximum par valeur'); cache[k] = String(v); },
      remove: (k) => { delete cache[k]; },
      removeAll: (ks) => ks.forEach((k) => delete cache[k])
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      sleep() {}, newBlob, getUuid: () => crypto.randomUUID(),
      // comme Apps Script : l'empreinte est un tableau d'octets SIGNÉS ; base64 « web-safe » avec bourrage
      computeHmacSha256Signature: (data, key) => [...crypto.createHmac('sha256', key).update(String(data)).digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map((b) => (b < 0 ? b + 256 : b)))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => { assert.equal(s.length % 4, 0, 'base64DecodeWebSafe : bourrage attendu'); return [...Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')].map((b) => (b > 127 ? b - 256 : b)); },
      base64Encode: (x) => Buffer.from(x.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
      base64Decode: (s) => { if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error('bad b64'); return [...Buffer.from(s, 'base64')]; },
      formatDate: (d, tz, pattern = 'yyyy-MM-dd HH:mm') => {
        const [y, mo, da, h, mi] = new Date(d).toISOString().slice(0, 16).split(/[-T:]/)
        return pattern.replace('yyyy', y).replace('MM', mo).replace('dd', da).replace('HH', h).replace('mm', mi)
      }
    },
    DriveApp: {
      getFolderById: (id) => { if (!w.folders[id]) throw new Error('not found'); return w.folders[id]; },
      getFileById: (id) => { if (!w.drive[id] || w.drive[id].purged) throw new Error('not found'); return w.drive[id]; }
    },
    Buffer, __w: w
  });
  vm.runInContext('Date.now = () => __w.now', ctx);
  w.ctx = ctx;
  return w;
}

export const run = (ctx, src) => vm.runInContext(src, ctx);
export const out = (o) => JSON.parse(o.getContent());

export function api(w, role = 'tech') {
  const raw = {
    post: (o) => out(run(w.ctx, `doPost({postData:{contents:${JSON.stringify(JSON.stringify(o))}}})`)),
    get: (o) => out(run(w.ctx, `doGet({parameter:${JSON.stringify(o)}})`))
  };
  // vraie connexion (une fois par monde et par niveau), puis la session accompagne chaque requête
  w.sessions = w.sessions || {};
  if (!w.sessions[role]) {
    const r = raw.post({ action: 'login', password: role === 'support' ? PW_SUPPORT : PW_TECH, firstName: 'Test', lastName: role, clientId: 'login-' + role });
    assert.equal(r.ok, true, JSON.stringify(r));
    w.sessions[role] = r.data.session;
  }
  const withSession = (o) => ({ session: w.sessions[role], ...o });
  return { post: (o) => raw.post(withSession(o)), get: (o) => raw.get(withSession(o)), raw };
}

// Un « téléphone » : identité, horloge propre (décalage en ms), dernière révision connue.
export function phone(w, name, clientId, skewMs = 0) {
  const { post, get } = api(w);
  const [firstName, lastName] = name.split(' ');
  const p = {
    name, clientId, skewMs, baseRev: 0, schema: null, report: null,
    now: () => w.now + skewMs,
    sync(changes = {}, extra = {}) {
      const r = post({
        action: 'syncReport', notionPageId: PAGE, reference: 'FI-252', clientId, author: { firstName, lastName },
        clientNow: w.now + skewMs, baseRev: p.baseRev, schema: p.schema, changes, ...extra
      });
      if (r.ok && r.data.report) { p.baseRev = r.data.report.rev; p.report = r.data.report; }
      return r;
    },
    load() {
      const r = get({ action: 'getIntervention', id: 'FI-252' });
      if (r.ok) { p.schema = r.data.schema; p.report = r.data.report; if (r.data.report) p.baseRev = r.data.report.rev; }
      return r;
    },
    poll() { return get({ action: 'getReport', pageId: PAGE, sinceRev: p.baseRev, clientId, name }); },
    at: (offsetMs = 0) => w.now + skewMs + offsetMs,
    upload(mediaId) {
      return post({ action: 'uploadMedia', fileData: PNG_B64, fileName: mediaId + '.png', mimeType: 'image/png', mediaId, reference: 'FI-252' }).data.fileId;
    }
  };
  return p;
}
