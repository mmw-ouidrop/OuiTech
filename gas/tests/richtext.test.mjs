// Contenu de mission : texte mis en forme, listes imbriquées, colonnes « Fichiers », noms de colonnes, auteurs.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, PAGE } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs', 'Machines.gs', 'Racks Casiers.gs', 'Actions.gs'];
const SRC = FILES.map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));

function world() {
  const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s));
  w.childrenOf(PAGE).forEach((b) => { b.archived = true; });
  return w;
}
const rich = (content, ann = {}, href) => ({ type: 'text', text: { content, link: href ? { url: href } : null }, annotations: ann, plain_text: content });

test('texte mis en forme : gras, italique, souligné, barré, code, lien et couleur sont conservés', () => {
  const w = world(); const { get } = api(w);
  w.seedChildren(PAGE, [
    { type: 'paragraph', paragraph: { rich_text: [rich('Coupez '), rich('le courant', { bold: true }), rich(' puis '), rich('attendez', { underline: true, color: 'red' }), rich(' et '), rich('voir', {}, 'https://ouidrop.eu/x')] } }
  ]);
  const r = get({ action: 'getIntervention', id: 'FI-252' });
  const t = r.data.templateBlocks[0];
  assert.equal(t.text, 'Coupez le courant puis attendez et voir');
  assert.deepEqual(t.rt.map((s) => s.t), ['Coupez ', 'le courant', ' puis ', 'attendez', ' et ', 'voir']);
  assert.equal(t.rt[1].b, 1);
  assert.deepEqual([t.rt[3].u, t.rt[3].col], [1, 'red']);
  assert.equal(t.rt[5].h, 'https://ouidrop.eu/x');
});

test('listes : puces et numéros gardent leur niveau, y compris les sous-listes', () => {
  const w = world(); const { get } = api(w);
  const li = (type, text, children) => ({ type, [type]: { rich_text: [rich(text)], children } });
  w.seedChildren(PAGE, [
    li('bulleted_list_item', 'Contrôler', [li('bulleted_list_item', 'La prise', [li('bulleted_list_item', 'Le câble')]), li('numbered_list_item', 'Le disjoncteur')]),
    li('numbered_list_item', 'Fermer'),
    { type: 'callout', callout: { rich_text: [rich('Attention')], icon: { type: 'emoji', emoji: '⚠️' } } }
  ]);
  const tb = get({ action: 'getIntervention', id: 'FI-252' }).data.templateBlocks;
  assert.deepEqual(tb.map((b) => [b.style, b.level, b.text]), [
    ['bulleted_list', 0, 'Contrôler'], ['bulleted_list', 1, 'La prise'], ['bulleted_list', 2, 'Le câble'],
    ['numbered_list', 1, 'Le disjoncteur'], ['numbered_list', 0, 'Fermer'], ['callout', undefined, 'Attention']
  ]);
  assert.equal(tb[5].icon, '⚠️');
});

test('colonnes « Fichiers » : vignettes (clé, type) et lecture par missionMedia', () => {
  const w = world(); const { get } = api(w);
  w.addFile('https://files.test/a.png', [137, 80, 78, 71]);
  w.addFile('https://files.test/b.pdf', [37, 80, 68, 70], 'application/octet-stream');
  w.pageProps = {
    'Photos d’inter': { type: 'files', files: [
      { name: 'a.png', type: 'file', file: { url: 'https://files.test/a.png' } },
      { name: 'b.pdf', type: 'file', file: { url: 'https://files.test/b.pdf' } },
      { name: 'film.mov', type: 'external', external: { url: 'https://cdn.test/film.mov' } },
      { name: 'http.png', type: 'external', external: { url: 'http://insecure.test/x.png' } }
    ] },
    Vide: { type: 'files', files: [] },
    Poids: { type: 'number', number: null }
  };
  const r = get({ action: 'getIntervention', id: 'FI-252' });
  const p = r.data.properties.find((x) => x.label === 'Photos d’inter');
  assert.deepEqual(p.files.map((f) => [f.key, f.kind, f.url]), [
    ['p:Photos d’inter:0', 'image', undefined], ['p:Photos d’inter:1', 'pdf', undefined], ['p:Photos d’inter:2', 'video', 'https://cdn.test/film.mov']
  ]);
  assert.deepEqual(r.data.properties.find((x) => x.label === 'Vide').files, []);
  assert.equal(r.data.properties.find((x) => x.label === 'Poids').value, '', 'un nombre vide reste listé');
  const img = get({ action: 'missionMedia', page: PAGE, key: p.files[0].key });
  assert.equal(img.data.mime, 'image/png');
  const pdf = get({ action: 'missionMedia', page: PAGE, key: p.files[1].key });
  assert.equal(pdf.data.mime, 'application/pdf', 'type déduit des premiers octets quand l’hébergeur répond octet-stream');
  assert.equal(get({ action: 'missionMedia', page: PAGE, key: 'p:Client:0' }).error.code, 'BAD_REQUEST', 'seules les colonnes de fichiers sont servies');
});

test('HIDDEN_PROPERTIES et PROPERTY_ORDER : un élément « A|B|C » vaut trois noms ; apostrophes et accents tolérés', () => {
  const w = world(); const { get } = api(w);
  w.pageProps = { 'Date d’intervention': { type: 'date', date: { start: '2026-10-30' } }, 'Heure d’envoi': { type: 'rich_text', rich_text: [{ plain_text: '08:00' }] } };
  run(w.ctx, "HIDDEN_PROPERTIES.splice(0, 1, \"Client|heure d'envoi\"); PROPERTY_ORDER.splice(0, 1, \"Statut|date d'intervention\");");
  const labels = get({ action: 'getIntervention', id: 'FI-252' }).data.properties.map((p) => p.label);
  assert.equal(labels.includes('Client'), false);
  assert.equal(labels.includes('Heure d’envoi'), false);
  assert.deepEqual(labels.slice(0, 2), ['Statut', 'Date d’intervention']);
});

test('auteur : une seule définition de cleanName_, texte ou objet, jamais « [object Object] »', () => {
  const defs = FILES.map((f, i) => (SRC[i].match(/function cleanName_\(/g) || []).length).reduce((a, b) => a + b, 0);
  assert.equal(defs, 1, 'cleanName_ doit n’exister qu’une fois dans tout le projet');
  const w = world();
  assert.equal(run(w.ctx, "cleanName_({ firstName: 'Ana', lastName: ' Roy ' })"), 'Ana Roy');
  assert.equal(run(w.ctx, "cleanName_('  Léo \\n Petit ')"), 'Léo Petit');
  assert.equal(run(w.ctx, "cleanName_({})"), '');
  assert.equal(run(w.ctx, "cleanName_('[object Object]')"), '');
  const st = run(w.ctx, "JSON.stringify(fixAuthors_({ fields: { a: { v: 1, by: '[object Object]' } }, custom: {}, photos: {}, last: { by: '[object Object]', at: 1 }, statusBy: 'Ana' }))");
  assert.equal(JSON.parse(st).fields.a.by, '');
  assert.equal(JSON.parse(st).last.by, 'Auteur inconnu');
});
