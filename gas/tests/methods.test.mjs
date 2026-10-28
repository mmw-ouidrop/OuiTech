// Fiches méthodes (Methods.gs) : liste, fiche (sections, médias), accès aux médias — sur le simulateur de Notion.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, PNG_B64 } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));
const world = () => { const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s)); return w; };
const rt = (t, extra = {}) => [{ type: 'text', text: { content: t }, ...extra }];
const h = (n, t) => ({ type: 'heading_' + n, ['heading_' + n]: { rich_text: rt(t) } });
const p = (t) => ({ type: 'paragraph', paragraph: { rich_text: rt(t) } });
const num = (t, children) => ({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt(t), children } });
const img = (url, cap) => ({ type: 'image', image: { type: 'file', file: { url }, caption: cap ? rt(cap) : [] } });
const PNG = [...Buffer.from(PNG_B64, 'base64')];

function seed(w) {
  w.addFile('https://files.test/a.png', PNG);
  w.addFile('https://files.test/support.pdf', [37, 80, 68, 70], 'application/pdf');
  w.addFile('https://files.test/big.png', new Array(7 * 1024 * 1024).fill(1));
  const lexium = w.addMethod({
    title: 'Remplacement Lexium', groups: ['ASC', 'NAV'], status: 'En cours', doc: 'https://docs.google.com/document/d/abc/edit',
    folder: 'https://drive.google.com/drive/folders/xyz', notes: 'Variateur de la navette',
    support: [{ name: 'guide.pdf', url: 'https://files.test/support.pdf' }],
    blocks: [
      p('Intro rapide'), h(2, 'Matériel'), { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('Lexium neuf') } },
      h(2, 'Outils'), { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('Clé Allen 4') } },
      h(2, 'Étapes'), num('Couper l’alimentation', [img('https://files.test/a.png', 'Disjoncteur')]), num('Déposer le variateur'),
      { type: 'video', video: { type: 'external', external: { url: 'https://youtu.be/abc' }, caption: [] } },
      img('https://files.test/big.png')
    ]
  });
  w.addMethod({ title: 'Armoire vide', groups: ['Elec'], status: 'Pas commencé' });
  w.addMethod({ title: 'Courroies', groups: ['ASC', 'NAV', 'PAP'], status: 'Terminé', blocks: [h(2, 'NAV'), h(3, 'Checker'), p('Tendre')] });
  w.addMethod({ title: 'Sans ensemble', groups: [], status: 'Terminé' });
  w.addMethod({ title: 'Ailleurs', groups: ['X'], parentDb: '99999999999999999999999999999999' });
  return lexium;
}

test('liste : triée, statuts masqués exclus, ensembles multiples, révision stable', () => {
  const w = world(); seed(w); const { get } = api(w);
  const r = get({ action: 'methods' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.items.map((i) => i.title), ['Courroies', 'Remplacement Lexium', 'Sans ensemble']);
  assert.deepEqual(r.data.items[0].groups, ['ASC', 'NAV', 'PAP']);
  assert.equal(r.data.items[1].summary, 'Variateur de la navette');
  const again = get({ action: 'methods', sinceRev: r.data.rev });
  assert.deepEqual(again.data, { unchanged: true, rev: r.data.rev });
});

test('liste : plus de 100 fiches paginées ; une fiche modifiée change la révision (après expiration du cache)', () => {
  const w = world(); w.methodQueryPageSize = 3; const { get } = api(w);
  for (let i = 0; i < 8; i++) w.addMethod({ title: 'F' + i, groups: ['A'] });
  const a = get({ action: 'methods' });
  assert.equal(a.data.items.length, 8);
  w.methodPages[0].last_edited_time = '2026-10-20T10:00:00Z';
  w.flushCache();
  const b = get({ action: 'methods' });
  assert.notEqual(a.data.rev, b.data.rev);
});

test('masquage configurable : statuts et titres', () => {
  const w = world(); seed(w); const { get } = api(w);
  w.props.METHODS_HIDDEN_STATUS = 'En cours|Pas commencé'; w.props.METHODS_HIDDEN_TITLES = 'Courroies';
  assert.deepEqual(get({ action: 'methods' }).data.items.map((i) => i.title), ['Sans ensemble']);
});

test('fiche : sections par grands titres, genres, liens, support, médias, vignette', () => {
  const w = world(); const m = seed(w); const { get } = api(w);
  const r = get({ action: 'method', id: m.nid });
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = r.data;
  assert.equal(d.title, 'Remplacement Lexium');
  assert.deepEqual(d.sections.map((s) => [s.title, s.kind]), [['', 'intro'], ['Matériel', 'materials'], ['Outils', 'tools'], ['Étapes', 'steps']]);
  const steps = d.sections[3].nodes;
  assert.equal(steps[0].k, 'li'); assert.equal(steps[0].n, 1);
  assert.equal(steps[0].kids[0].k, 'image');                       // image imbriquée sous l'étape 1
  assert.equal(d.sections[3].nodes.find((n) => n.k === 'video').url, 'https://youtu.be/abc');
  assert.deepEqual(d.links.map((l) => l.kind), ['doc', 'folder']);
  assert.equal(d.support.length, 1); assert.equal(d.support[0].name, 'guide.pdf');
  assert.equal(d.media.filter((x) => x.kind === 'image').length, 2);
  assert.equal(d.hero.kind, 'image');
  assert.equal(d.notes, 'Variateur de la navette');
});

test('fiche : un seul grand titre = niveau le plus haut ; sous-titres conservés dans la section', () => {
  const w = world(); seed(w); const { get } = api(w);
  const id = get({ action: 'methods' }).data.items.find((i) => i.title === 'Courroies').id;
  const d = get({ action: 'method', id }).data;
  assert.equal(d.sections.length, 1);
  assert.equal(d.sections[0].title, 'NAV');
  assert.equal(d.sections[0].nodes[0].k, 'h'); assert.equal(d.sections[0].nodes[0].l, 3);
});

test('fiche : inchangée = aucune lecture du corps ; autre base ou id invalide refusés', () => {
  const w = world(); const m = seed(w); const { get } = api(w);
  const a = get({ action: 'method', id: m.nid }).data;
  w.calls.length = 0;
  const r = get({ action: 'method', id: m.nid, sinceEdited: a.updated });
  assert.deepEqual(r.data, { unchanged: true, updated: a.updated });
  assert.equal(w.calls.filter((c) => /children/.test(c.path)).length, 0);
  const other = w.methodPages.find((x) => x.properties.Nom.title[0].plain_text === 'Ailleurs');
  assert.equal(get({ action: 'method', id: other.id.replace(/-/g, '') }).error.code, 'NOT_FOUND');
  assert.equal(get({ action: 'method', id: 'pas-un-id' }).error.code, 'BAD_REQUEST');
});

test('médias : image en base64, fichier trop gros = lien frais, mode url, support, clés étrangères refusées', () => {
  const w = world(); const m = seed(w); const { get } = api(w);
  const d = get({ action: 'method', id: m.nid }).data;
  const imgs = d.media.filter((x) => x.kind === 'image');
  const small = get({ action: 'methodMedia', page: m.nid, key: imgs[0].key });
  assert.equal(small.ok, true, JSON.stringify(small).slice(0, 200));
  assert.equal(small.data.data, PNG_B64); assert.equal(small.data.mime, 'image/png');
  const big = get({ action: 'methodMedia', page: m.nid, key: imgs[1].key });
  assert.equal(big.data.tooLarge, true); assert.equal(big.data.url, 'https://files.test/big.png'); assert.equal(big.data.data, undefined);
  const u = get({ action: 'methodMedia', page: m.nid, key: imgs[1].key, mode: 'url' });
  assert.equal(u.data.url, 'https://files.test/big.png');
  const sup = get({ action: 'methodMedia', page: m.nid, key: d.support[0].key });
  assert.equal(sup.data.mime, 'application/pdf'); assert.equal(sup.data.name, 'guide.pdf');

  // bloc d'une autre page (la page de mission) : refusé, même avec un bon id de fiche
  const foreign = w.kids[Object.keys(w.kids)[0]][0];
  assert.equal(get({ action: 'methodMedia', page: m.nid, key: foreign }).error.code, 'NOT_FOUND');
  assert.equal(get({ action: 'methodMedia', page: m.nid, key: 'p:Autre:0' }).error.code, 'BAD_REQUEST');
  assert.equal(get({ action: 'methodMedia', page: m.nid, key: 'zzz' }).error.code, 'BAD_REQUEST');
});

test('médias : lien expiré côté stockage = erreur franche ; session obligatoire', () => {
  const w = world(); const m = seed(w); const { get, raw } = api(w);
  const d = get({ action: 'method', id: m.nid }).data;
  delete w.files['https://files.test/a.png'];
  assert.equal(get({ action: 'methodMedia', page: m.nid, key: d.media[0].key }).error.code, 'MEDIA_UNAVAILABLE');
  assert.equal(raw.get({ action: 'methods' }).error.code, 'UNAUTHORIZED');
});

test('testMethods (Apps Script) s’exécute sans planter', () => {
  const w = world(); seed(w);
  run(w.ctx, 'testMethods()');
});
