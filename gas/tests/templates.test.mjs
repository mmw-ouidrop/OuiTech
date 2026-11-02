// Éditeur de template (profil support) : lecture, écriture ciblée, validation (Templates.gs).
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, PAGE } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs', 'Machines.gs', 'Racks.gs', 'Templates.gs'];
const SRC = FILES.map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));

function world(empty = false) {
  const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s));
  if (empty) w.childrenOf(PAGE).forEach((b) => { b.archived = true; });
  return w;
}
const json = (o) => ({ type: 'code', code: { language: 'json', rich_text: [{ type: 'text', text: { content: JSON.stringify(o) } }] } });
const para = (t, ann = {}) => ({ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: t }, annotations: ann }] } });
const head = (t, n = 2) => ({ type: 'heading_' + n, ['heading_' + n]: { rich_text: [{ type: 'text', text: { content: t } }] } });
const get = (w) => api(w, 'support').get({ action: 'templateGet', id: 'FI-252' });
const save = (w, items) => api(w, 'support').post({ action: 'templateSave', id: 'FI-252', items });
const kinds = (w, parent = PAGE) => w.childrenOf(parent).map((b) => b.type + ':' + (b.type === 'code' ? JSON.parse(w.text(b)).id : w.text(b)));

test('réservé au support : un technicien est refusé', () => {
  const w = world();
  assert.equal(api(w, 'tech').get({ action: 'templateGet', id: 'FI-252' }).error.code, 'FORBIDDEN_ROLE');
  assert.equal(api(w, 'tech').post({ action: 'templateSave', id: 'FI-252', items: [] }).error.code, 'FORBIDDEN_ROLE');
});

test('lecture : chaque bloc devient un élément ; JSON invalide et média sont verrouillés', () => {
  const w = world(true);
  w.seedChildren(PAGE, [head('Avant'), para('Consigne', { bold: true }), json({ type: 'select', id: 'etat', label: 'État', options: ['A', 'B'], required: true }),
    { type: 'to_do', to_do: { rich_text: w.rt('Zone dégagée'), checked: false } }, { type: 'divider', divider: {} },
    { type: 'code', code: { language: 'json', rich_text: w.rt('{ casse') } }, { type: 'code', code: { language: 'html', rich_text: w.rt('<b>x</b>') } },
    { type: 'image', image: { type: 'external', external: { url: 'https://x.test/a.png' }, caption: w.rt('Schéma') } }]);
  const r = get(w);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.items.map((i) => i.t), ['section', 'text', 'field', 'todo', 'divider', 'locked', 'html', 'locked']);
  assert.equal(r.data.items[1].rich, true);
  assert.deepEqual([r.data.items[2].type, r.data.items[2].id, r.data.items[2].required, r.data.items[2].options], ['select', 'etat', true, ['A', 'B']]);
  assert.equal(r.data.container, false);
  assert.equal(r.data.reference, 'FI-252');
});

test('écriture ciblée : modifier, ajouter, déplacer, supprimer ; le reste n’est pas réécrit', () => {
  const w = world(true);
  w.seedChildren(PAGE, [head('Avant'), para('Gras', { bold: true }), json({ type: 'text', id: 'a', label: 'A', hint: 'garde-moi' }), json({ type: 'text', id: 'b', label: 'B' }),
    { type: 'image', image: { type: 'external', external: { url: 'https://x.test/a.png' } } }, para('À supprimer')]);
  const items = get(w).data.items;
  const [h, p, a, b, img] = items;
  a.label = 'A modifié';
  const neu = { t: 'field', type: 'radio_group', id: 'choix', label: 'Choix', options: ['Oui', 'Non'], required: true };
  const writes0 = w.writes().length;
  const r = save(w, [h, p, neu, b, a, img]);          // « A » déplacé après « B », nouveau champ inséré avant « B »
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(kinds(w), ['heading_2:Avant', 'paragraph:Gras', 'code:choix', 'code:b', 'code:a', 'image:']);
  const ca = w.childrenOf(PAGE).find((x) => x.type === 'code' && JSON.parse(w.text(x)).id === 'a');
  assert.deepEqual(JSON.parse(w.text(ca)), { hint: 'garde-moi', type: 'text', id: 'a', label: 'A modifié' }, 'les clés propres au responsable sont conservées');
  const para1 = w.childrenOf(PAGE)[1];
  assert.equal(para1.paragraph.rich_text[0].annotations.bold, true, 'bloc inchangé : mise en forme intacte');
  assert.deepEqual(r.data.saved, { created: 1, updated: 0, deleted: 1, moved: 1 });
  assert.equal(r.data.items.length, 6);
  // la mission lit le nouveau template
  const m = api(w).get({ action: 'getIntervention', id: 'FI-252' }).data;
  assert.deepEqual(m.schema.filter((s) => s.k === 'f').map((s) => s.id), ['choix', 'b', 'a']);
  assert.ok(w.writes().length > writes0);
});

test('inchangé : aucune écriture', () => {
  const w = world(true);
  w.seedChildren(PAGE, [head('Avant'), para('Texte', { italic: true }), json({ type: 'number', id: 'n', label: 'N', unit: 'V' })]);
  const items = get(w).data.items;
  const before = w.writes().length;
  const r = save(w, items);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(w.writes().length, before);
  assert.deepEqual(r.data.saved, { created: 0, updated: 0, deleted: 0, moved: 0 });
});

test('page vide : un toggle « Template CR intervention » est créé et reçoit le formulaire', () => {
  const w = world(true);
  const r = save(w, [{ t: 'section', level: 1, text: 'Matériel' }, { t: 'field', type: 'image_upload', id: 'photo', label: 'Photo' }, { t: 'text', style: 'bulleted_list', text: 'Point' }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const top = w.childrenOf(PAGE);
  assert.equal(top.length, 1);
  assert.equal(top[0].type, 'toggle');
  assert.equal(w.text(top[0]), 'Template CR intervention');
  assert.deepEqual(kinds(w, top[0].id), ['heading_1:Matériel', 'code:photo', 'bulleted_list_item:Point']);
  assert.equal(r.data.container, true);
  assert.equal(api(w).get({ action: 'getIntervention', id: 'FI-252' }).data.schema.length, 2);
});

test('un toggle « Template » existant est le conteneur ; le rapport n’est jamais touché', () => {
  const w = world(true);
  w.seedChildren(PAGE, [{ type: 'toggle', toggle: { rich_text: w.rt('Template CR'), children: [head('A'), para('B')] } }]);
  const ph = w.phone ? null : null;
  const r1 = get(w);
  assert.equal(r1.data.container, true);
  assert.equal(r1.data.items.length, 2);
  const items = r1.data.items;
  const r = save(w, [items[1], items[0]]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const cont = w.childrenOf(PAGE)[0];
  assert.deepEqual(kinds(w, cont.id), ['paragraph:B', 'heading_2:A']);
});

test('validation : identifiant dupliqué ou réservé, options, libellé, texte vide', () => {
  const w = world(true);
  const f = (o) => ({ t: 'field', type: 'text', id: 'x', label: 'X', ...o });
  const code = (items) => save(w, items).error;
  assert.match(code([f({}), f({})]).message, /déjà utilisé/);
  assert.match(code([f({ id: 'u_x' })]).message, /réservé/);
  assert.match(code([f({ id: 'a b' })]).message, /invalide/);
  assert.match(code([f({ type: 'radio_group', options: ['un'] })]).message, /2 à 20/);
  assert.match(code([f({ label: ' ' })]).message, /libellé/);
  assert.match(code([{ t: 'text', style: 'paragraph', text: '  ' }]).message, /vide/);
  assert.equal(code([{ t: 'locked', label: 'x' }]).code, 'BAD_REQUEST');
  assert.equal(w.writes().length, 0, 'rien n’est écrit si un élément est refusé');
});

test('template modifié dans Notion entre-temps : enregistrement refusé', () => {
  const w = world(true);
  w.seedChildren(PAGE, [head('A')]);
  const items = get(w).data.items;
  w.childrenOf(PAGE)[0].archived = true;
  assert.equal(save(w, items).error.code, 'TEMPLATE_CHANGED');
});

test('insertion au début impossible : repli à la fin avec avertissement', () => {
  const w = world(true);
  w.seedChildren(PAGE, [head('A')]);
  const items = get(w).data.items;
  w.positionMode = 'none';
  const r = save(w, [{ t: 'text', style: 'paragraph', text: 'Neuf' }, items[0]]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.data.warnings.some((x) => x.code === 'POSITION_UNSUPPORTED'));
});
