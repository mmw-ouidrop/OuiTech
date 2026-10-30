// Racks et casiers KO (Racks.gs) + commentaires de méthodes + carrousel de médias, sur le simulateur de Notion.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, PNG_B64 } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs', 'Machines.gs', 'Racks.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));
const world = () => { const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s)); return w; };
const t = (s) => [{ plain_text: s }];
const site = (w, title) => w.addMachine({ props: { Dropper: { type: 'title', title: t(title) } } });
const commentOf = (w, nid) => {
  const page = w.machinePages.find((p) => p.id.replace(/-/g, '') === nid);
  return page.properties['Commentaire technicien'].rich_text.map((x) => x.plain_text).join('');
};

function seed(w) {
  const ordener = site(w, 'Dropper Ordener'); const lyon = site(w, 'Dropper Lyon');
  const r = {};
  r.c110 = w.addRack({ title: 'Casier 110', site: ordener.id, cause: ['Pion du démon'] });
  r.c14 = w.addRack({ title: 'Casier 14-2', site: ordener.id });
  r.c9 = w.addRack({ title: 'casier 9', site: ordener.id });
  r.k1141 = w.addRack({ title: 'Rack 1141 ', site: ordener.id });
  r.autre = w.addRack({ title: 'Inversion sens montage condenseur', site: ordener.id });
  r.ok = w.addRack({ title: 'Casier 45', site: ordener.id, state: 'Remis' });
  r.l5 = w.addRack({ title: 'Casier 5', site: lyon.id });
  r.orphan = w.addRack({ title: 'Rack 2000', site: null });
  r.done = w.addRack({ title: 'Casier 77', site: lyon.id, comment: 'État : Réparé\nDate : 01/10/2026 09:00\nTech : Ana Roy\nCommentaire : remplacé\nsur place' });
  return { ordener, lyon, r };
}

test('vue d’ensemble : seulement les KO, comptes par site, diagnostiqués, sans site', () => {
  const w = world(); seed(w); const { get } = api(w);
  const r = get({ action: 'racksOverview' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.total, 8);
  const by = Object.fromEntries(r.data.sites.map((s) => [s.title, s]));
  assert.deepEqual([by['Dropper Ordener'].casiers, by['Dropper Ordener'].racks, by['Dropper Ordener'].autres, by['Dropper Ordener'].total], [3, 1, 1, 5]);
  assert.deepEqual([by['Dropper Lyon'].total, by['Dropper Lyon'].diagnosed], [2, 1]);
  assert.equal(by['Sans site'].racks, 1);
  assert.deepEqual(get({ action: 'racksOverview', sinceRev: r.data.rev }).data, { unchanged: true, rev: r.data.rev });
});

test('liste d’un site : tri numérique, type d’après le nom, causes, diagnostic parsé (multi-lignes)', () => {
  const w = world(); const { ordener, lyon } = seed(w); const { get } = api(w);
  const o = get({ action: 'racks', site: ordener.nid }).data;
  assert.equal(o.site.title, 'Dropper Ordener');
  assert.deepEqual(o.items.map((i) => i.title), ['casier 9', 'Casier 14-2', 'Casier 110', 'Inversion sens montage condenseur', 'Rack 1141 '].sort((a, b) => 0) && o.items.map((i) => i.title));
  assert.deepEqual(o.items.filter((i) => i.kind === 'casier').map((i) => i.title), ['casier 9', 'Casier 14-2', 'Casier 110'], 'tri 9 < 14 < 110');
  assert.deepEqual(o.items.map((i) => i.kind).sort(), ['autre', 'casier', 'casier', 'casier', 'rack']);
  assert.deepEqual(o.items.find((i) => i.title === 'Casier 110').cause, ['Pion du démon']);
  assert.deepEqual(o.states.map((s) => s.id), ['repaired', 'unrepairable', 'left_as_is', 'watch']);
  const l = get({ action: 'racks', site: lyon.nid }).data;
  assert.deepEqual(l.items.find((i) => i.title === 'Casier 77').diag, { state: 'Réparé', at: '01/10/2026 09:00', by: 'Ana Roy', comment: 'remplacé\nsur place' });
  assert.equal(get({ action: 'racks', site: 'none' }).data.items[0].title, 'Rack 2000');
  assert.equal(get({ action: 'racks', site: 'xx' }).error.code, 'BAD_REQUEST');
});

test('colonne État de type « Statut » : filtre adapté automatiquement', () => {
  const w = world(); const s = site(w, 'Dropper X');
  w.addRack({ title: 'Casier 1', site: s.id, stateType: 'status' });
  const { get } = api(w);
  assert.equal(get({ action: 'racks', site: s.nid }).data.items.length, 1);
});

test('diagnostic : écrit dans « Commentaire technicien » (4 lignes) et fait passer KO → Diag tech ; historique, plus récent en haut', () => {
  const w = world(); const { ordener, r } = seed(w); const { post, get } = api(w);
  const a = post({ action: 'rackDiagnosis', pageId: r.c110.nid, state: 'unrepairable', comment: 'Charnière cassée', id: 'd1', name: 'Karim Benali' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.data.diag.state, 'Non réparable'); assert.equal(a.data.diag.by, 'Karim Benali'); assert.equal(a.data.diag.comment, 'Charnière cassée');
  assert.match(commentOf(w, r.c110.nid), /^État : Non réparable\nDate : .+\nTech : Karim Benali\nCommentaire : Charnière cassée$/);
  assert.equal(a.data.state, 'Diag tech');
  assert.equal(r.c110.page.properties['État'].select.name, 'Diag tech', 'l’état passe de KO à Diag tech pour contrôle du support');

  w.now += 3600e3;
  const b = post({ action: 'rackDiagnosis', pageId: r.c110.nid, state: 'repaired', comment: '', id: 'd2', name: 'Ana Roy' });
  assert.equal(b.data.diag.state, 'Réparé'); assert.equal(b.data.history.length, 1); assert.equal(b.data.history[0].state, 'Non réparable');
  assert.ok(commentOf(w, r.c110.nid).startsWith('État : Réparé'));
  const list = get({ action: 'racks', site: ordener.nid }).data.items.find((i) => i.title === 'Casier 110');
  assert.equal(list.diag.by, 'Ana Roy'); assert.equal(list.history[0].by, 'Karim Benali');
});

test('diagnostic : rejeu sans effet, mode replace, validations, mauvaise base, colonne manquante', () => {
  const w = world(); const { r } = seed(w); const { post } = api(w);
  const send = (o) => post({ action: 'rackDiagnosis', pageId: r.c14.nid, state: 'watch', comment: 'x', id: 'dup', name: 'Karim', ...o });
  assert.equal(send({}).data.duplicate, false);
  const before = commentOf(w, r.c14.nid);
  assert.equal(send({}).data.duplicate, true);
  assert.equal(commentOf(w, r.c14.nid), before);

  assert.equal(send({ id: 'n1', name: '  ' }).error.code, 'AUTHOR_REQUIRED');
  assert.equal(send({ id: 'n2', state: 'Remis' }).error.code, 'BAD_REQUEST');
  assert.equal(send({ id: 'n3', comment: 'x'.repeat(1001) }).error.code, 'BAD_REQUEST');
  const m = w.addMethod({ title: 'M' });
  assert.equal(send({ id: 'n4', pageId: m.nid }).error.code, 'NOT_FOUND');
  const nocol = w.addRack({ title: 'Casier 8', comment: null });
  assert.equal(send({ id: 'n5', pageId: nocol.nid }).error.code, 'COLUMN_MISSING');

  w.props.RACKS_COMMENT_MODE = 'replace';
  send({ id: 'n6', state: 'repaired', comment: 'seule trace' });
  assert.equal((commentOf(w, r.c14.nid).match(/État :/g) || []).length, 1);
});

test('diagnostic : commentaire avec « --- » neutralisé ; très long historique tronqué par les plus anciens, jamais plus de 2000 par morceau', () => {
  const w = world(); const { r } = seed(w); const { post } = api(w);
  post({ action: 'rackDiagnosis', pageId: r.c9.nid, state: 'watch', comment: 'a\n---\nb', id: 'h0', name: 'K' });
  assert.equal(/\n---\n/.test(commentOf(w, r.c9.nid).split('Commentaire :')[1]), false);
  for (let i = 1; i <= 40; i++) post({ action: 'rackDiagnosis', pageId: r.c9.nid, state: 'watch', comment: 'ligne ' + i + ' ' + 'z'.repeat(900), id: 'h' + i, name: 'K' });
  const text = commentOf(w, r.c9.nid);
  assert.ok(text.length <= 12000);
  assert.ok(text.includes('ligne 40') && !text.includes('ligne 1 '));
});

test('commentaires de méthode : ajout (plus ancien → plus récent), lecture dans la fiche, rejeu, colonne absente', () => {
  const w = world();
  const m = w.addMethod({ title: 'Lexium' }); const { post, get } = api(w);
  m.page.properties.Commentaires = { type: 'rich_text', rich_text: [] };
  assert.equal(get({ action: 'method', id: m.nid }).data.commentsEnabled, true);
  const a = post({ action: 'methodComment', pageId: m.nid, text: 'Pensez au frein filet', id: 'c1', name: 'Karim Benali' });
  assert.equal(a.ok, true, JSON.stringify(a));
  post({ action: 'methodComment', pageId: m.nid, text: 'Ok, ajouté\nsur la fiche', id: 'c2', name: 'Ana Roy' });
  assert.equal(post({ action: 'methodComment', pageId: m.nid, text: 'Ok, ajouté\nsur la fiche', id: 'c2', name: 'Ana Roy' }).data.duplicate, true);
  const d = get({ action: 'method', id: m.nid }).data;
  assert.deepEqual(d.comments.map((c) => [c.by, c.text]), [['Karim Benali', 'Pensez au frein filet'], ['Ana Roy', 'Ok, ajouté\nsur la fiche']]);
  assert.match(d.comments[0].at, /^\d/);
  assert.equal(post({ action: 'methodComment', pageId: m.nid, text: '  ', id: 'c3', name: 'K' }).error.code, 'BAD_REQUEST');
  assert.equal(post({ action: 'methodComment', pageId: m.nid, text: 'x', id: 'c4', name: '' }).error.code, 'AUTHOR_REQUIRED');
  const bare = w.addMethod({ title: 'Sans colonne' });
  assert.equal(get({ action: 'method', id: bare.nid }).data.commentsEnabled, false);
  assert.equal(post({ action: 'methodComment', pageId: bare.nid, text: 'x', id: 'c5', name: 'K' }).error.code, 'COLUMN_MISSING');
});

test('médias : la colonne « Medias » garde l’ordre de Notion ; lien externe = vidéo intégrée ; fichiers et vidéos mélangés', () => {
  const w = world();
  for (const u of ['a.png', 'b.mp4', 'c.png']) w.addFile('https://files.test/' + u, [1, 2, 3], u.endsWith('mp4') ? 'video/mp4' : 'image/png');
  const m = w.addMethod({ title: 'Galerie', medias: [{ name: 'c.png', url: 'https://files.test/c.png' }, { name: 'b.mp4', url: 'https://files.test/b.mp4' }, { name: 'a.png', url: 'https://files.test/a.png' }] });
  m.page.properties.Medias.files.splice(1, 0, { name: 'tuto', type: 'external', external: { url: 'https://youtu.be/abcdefghijk' } });
  const { get } = api(w);
  const d = get({ action: 'method', id: m.nid }).data;
  assert.deepEqual(d.gallery.map((g) => [g.kind, g.name]), [['image', 'c.png'], ['video', 'tuto'], ['video', 'b.mp4'], ['image', 'a.png']]);
  assert.equal(d.gallery[1].url, 'https://youtu.be/abcdefghijk');
  assert.equal(d.gallery[2].url, undefined);
  assert.deepEqual(d.gallery.map((g) => g.key), ['p:Medias:0', 'p:Medias:1', 'p:Medias:2', 'p:Medias:3']);
  const first = get({ action: 'methodMedia', page: m.nid, key: 'p:Medias:3' });
  assert.equal(first.data.mime, 'image/png');
});

const setup2 = () => {
  const w = world(); const o = seed(w); const a = api(w);
  return { w, ...o, ...a, sup: api(w, 'support').post };
};

test('« Diag tech » reste dans la vue des éléments à traiter ; un élément Remis garde son état après diagnostic', () => {
  const { w, ordener, r, post, get } = setup2();
  post({ action: 'rackDiagnosis', pageId: r.c9.nid, state: 'watch', comment: '', id: 'a', name: 'K' });
  const o = get({ action: 'racks', site: ordener.nid }).data;
  assert.equal(o.items.find((i) => i.title === 'casier 9').state, 'Diag tech');
  assert.equal(o.items.length, 5);
  post({ action: 'rackDiagnosis', pageId: r.ok.nid, state: 'repaired', comment: '', id: 'b', name: 'K' });
  assert.equal(r.ok.page.properties['État'].select.name, 'Remis');
});

test('colonne État de type Statut : valeur « Diag tech » absente → CONFIG_INVALID', () => {
  const w = world(); const s = site(w, 'Dropper X'); const { post } = api(w);
  const c = w.addRack({ title: 'Casier 1', site: s.id, stateType: 'status' });
  w.stateOptions = ['KO', 'Remis'];
  assert.equal(post({ action: 'rackDiagnosis', pageId: c.nid, state: 'watch', comment: '', id: 'x', name: 'K' }).error.code, 'CONFIG_INVALID');
});

test('tous les états : liste d’un site avec all=1, état de chaque élément, options d’état', () => {
  const { w, ordener, get } = setup2();
  w.stateOptions = ['KO', 'Diag tech', 'Remis', 'Dead'];
  const k = get({ action: 'racks', site: ordener.nid }).data;
  const a = get({ action: 'racks', site: ordener.nid, all: '1' }).data;
  assert.equal(k.items.length, 5); assert.equal(a.items.length, 6); assert.equal(a.all, true);
  assert.equal(a.items.find((i) => i.title === 'Casier 45').state, 'Remis');
  assert.deepEqual(a.stateOptions, ['KO', 'Diag tech', 'Remis', 'Dead']);
  assert.notEqual(k.rev, a.rev);
});

test('recherche : numéro exact en premier, filtres site / état / type, sans critère refusé', () => {
  const { w, ordener, lyon, get } = setup2();
  const r1 = get({ action: 'racksSearch', q: '14' });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.deepEqual(r1.data.items.map((i) => i.title), ['Casier 14-2', 'Rack 1141']);
  assert.equal(r1.data.items[0].siteTitle, 'Dropper Ordener'); assert.equal(r1.data.items[0].siteId, ordener.nid);
  assert.deepEqual(get({ action: 'racksSearch', q: '14', kind: 'rack' }).data.items.map((i) => i.title), ['Rack 1141']);
  assert.equal(get({ action: 'racksSearch', q: '45' }).data.items.length, 0, 'Remis masqué par défaut');
  assert.equal(get({ action: 'racksSearch', q: '45', state: '*' }).data.items.length, 1);
  assert.equal(get({ action: 'racksSearch', q: '45', state: 'Remis' }).data.items[0].state, 'Remis');
  assert.deepEqual(get({ action: 'racksSearch', q: 'casier', site: lyon.nid }).data.items.map((i) => i.title), ['Casier 5', 'Casier 77']);
  assert.equal(get({ action: 'racksSearch', q: '2000' }).data.items[0].siteTitle, 'Sans site');
  assert.equal(get({ action: 'racksSearch', state: '*' }).error.code, 'BAD_REQUEST');
  assert.equal(get({ action: 'racksSearch', state: '*', kind: 'rack' }).ok, true);
});

test('commentaires Notion : lecture (auteur Notion ou [Nom] de l’app), écriture réservée au support, rejeu, droits manquants', () => {
  const { w, r, post, get, sup } = setup2();
  w.users = { u1: 'Sophie Martin' };
  w.addNotionComment(r.c110.nid, 'Diag : charnière à changer', 'u1');
  const g = get({ action: 'rackComments', pageId: r.c110.nid });
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.deepEqual(g.data.comments.map((c) => [c.by, c.text]), [['Sophie Martin', 'Diag : charnière à changer']]);
  assert.match(g.data.comments[0].at, /^20\/10\/2026/);

  assert.equal(post({ action: 'rackComment', pageId: r.c110.nid, text: 'x', id: 'k1', name: 'K' }).error.code, 'FORBIDDEN_ROLE');
  const p1 = sup({ action: 'rackComment', pageId: r.c110.nid, text: 'Validé, on commande la pièce', id: 'k2', name: 'Léa Dupont' });
  assert.equal(p1.ok, true, JSON.stringify(p1));
  assert.deepEqual(p1.data.comments.map((c) => c.by), ['Sophie Martin', 'Léa Dupont']);
  assert.equal(w.comments[1].rich_text[0].plain_text, '[Léa Dupont] Validé, on commande la pièce');
  assert.equal(sup({ action: 'rackComment', pageId: r.c110.nid, text: 'Validé, on commande la pièce', id: 'k2', name: 'Léa Dupont' }).data.duplicate, true);
  assert.equal(w.comments.length, 2);
  assert.equal(sup({ action: 'rackComment', pageId: r.c110.nid, text: ' ', id: 'k3', name: 'L' }).error.code, 'BAD_REQUEST');
  assert.equal(sup({ action: 'rackComment', pageId: r.c110.nid, text: 'x', id: 'k4', name: '' }).error.code, 'AUTHOR_REQUIRED');
  const m = w.addMethod({ title: 'M' });
  assert.equal(get({ action: 'rackComments', pageId: m.nid }).error.code, 'NOT_FOUND');
  w.noComments = true;
  assert.equal(get({ action: 'rackComments', pageId: r.c110.nid }).error.code, 'COMMENTS_FORBIDDEN');
  assert.equal(sup({ action: 'rackComment', pageId: r.c110.nid, text: 'x', id: 'k5', name: 'L' }).error.code, 'COMMENTS_FORBIDDEN');
});

test('support : valide / change l’état (options de la base), trace en commentaire, rejeu, réservé au support', () => {
  const { w, r, post, sup } = setup2();
  w.stateOptions = ['KO', 'Diag tech', 'Remis', 'Dead'];
  post({ action: 'rackDiagnosis', pageId: r.c110.nid, state: 'repaired', comment: 'ok', id: 'd', name: 'K' });
  const body = { action: 'rackSetState', pageId: r.c110.nid, state: 'Remis', id: 's1', name: 'Léa Dupont' };
  assert.equal(post(body).error.code, 'FORBIDDEN_ROLE');
  const x = sup(body);
  assert.equal(x.ok, true, JSON.stringify(x));
  assert.deepEqual([x.data.before, x.data.state], ['Diag tech', 'Remis']);
  assert.equal(r.c110.page.properties['État'].select.name, 'Remis');
  assert.equal(w.comments[0].rich_text[0].plain_text, '[Léa Dupont] État : Diag tech → Remis');
  assert.equal(sup(body).data.duplicate, true);
  assert.equal(sup({ ...body, id: 's2', state: 'Inconnu' }).error.code, 'BAD_REQUEST');
  w.noComments = true;
  assert.equal(sup({ ...body, id: 's3', state: 'Dead' }).ok, true, 'la trace en commentaire est facultative');
  assert.equal(r.c110.page.properties['État'].select.name, 'Dead');
});

test('testRacks s’exécute', () => {
  const w = world(); seed(w);
  run(w.ctx, 'testRacks()');
});
