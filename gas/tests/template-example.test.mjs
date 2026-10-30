// Le template d'exemple du mémo (docs/template-exemple.md) doit être lu sans
// aucun avertissement par le vrai parseur de Code.gs, et ses champs fusionnables
// par Report.gs. Convertit le Markdown en blocs Notion comme le fait un collage.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, phone, PAGE } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const md = fs.readFileSync(path.join(here, '..', '..', 'docs', 'templates', 'template-exemple.md'), 'utf8');
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));

function toBlocks(markdown, rt) {
  const out = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (l.startsWith('```')) {
      const lang = l.slice(3).trim();
      const body = [];
      while (!lines[++i].startsWith('```')) body.push(lines[i]);
      out.push({ type: 'code', code: { language: lang || 'plain text', rich_text: rt(body.join('\n')) } });
    } else if (/^#{1,3} /.test(l)) {
      const n = l.match(/^#+/)[0].length;
      out.push({ type: 'heading_' + n, ['heading_' + n]: { rich_text: rt(l.replace(/^#+ /, '')) } });
    } else if (l.startsWith('- [ ] ')) {
      out.push({ type: 'to_do', to_do: { rich_text: rt(l.slice(6)), checked: false } });
    } else {
      out.push({ type: 'paragraph', paragraph: { rich_text: rt(l) } });
    }
  }
  return out;
}

function load(markdown = md) {
  const w = makeWorld();
  SRC.forEach((s) => run(w.ctx, s));
  // remplace le template de base par l'exemple
  w.childrenOf(PAGE).forEach((b) => { b.archived = true; });
  w.seedChildren(PAGE, toBlocks(markdown, w.rt));
  return w;
}

test('le template d’exemple est lu sans aucun avertissement', () => {
  const w = load(); const a = phone(w, 'Karim Benali', 'cA');
  const r = a.load();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.warnings, []);
  const comps = r.data.templateBlocks.filter((b) => b.kind === 'component');
  const ids = comps.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
  assert.deepEqual(comps.filter((c) => !c.id.startsWith('todo_')).map((c) => c.type).sort(),
    ['checkbox', 'checkbox_group', 'date', 'image_upload', 'image_upload', 'number', 'radio_group', 'radio_group', 'select', 'text', 'textarea', 'textarea']);
  assert.equal(comps.filter((c) => c.id.startsWith('todo_')).length, 4, '4 cases natives');
  assert.equal(r.data.templateBlocks.filter((b) => b.kind === 'section').length, 5);
  assert.equal(r.data.templateBlocks.filter((b) => b.kind === 'text').length, 1, 'une consigne');
  // chaque type du vocabulaire est illustré au moins une fois
  const used = new Set(comps.map((c) => c.type));
  ['text', 'textarea', 'number', 'checkbox', 'radio_group', 'select', 'checkbox_group', 'date', 'image_upload'].forEach((t) => assert.ok(used.has(t), t));
});

test('l’exemple se synchronise : rapport complet, champs dans l’ordre du template', () => {
  const w = load(); const a = phone(w, 'Karim Benali', 'cA');
  a.load();
  const schemaFields = a.schema.filter((s) => s.k === 'f');
  assert.equal(schemaFields.length, 16);
  const r = a.sync({ fields: {
    acces_site: { v: 'Clé', at: a.at() },
    epi: { v: ['Casque', 'Gants'], at: a.at() },
    index_releve: { v: 1234.5, at: a.at() },
    travaux: { v: 'Remplacement complet.', at: a.at() },
    client_present: { v: true, at: a.at() },
    prochaine_visite: { v: '2026-11-03', at: a.at() }
  } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.applied.fields, 6);
  const txt = w.visibleReport().map((b) => w.text(b));
  assert.ok(txt.includes('Accès au site : Clé'));
  assert.ok(txt.includes('Équipements de protection portés : Casque, Gants'));
  assert.ok(txt.includes('Index relevé : 1234.5'));
  const cp = w.visibleReport().find((b) => w.text(b) === 'Client présent en fin d\'intervention');
  assert.equal(cp.type, 'to_do'); assert.equal(cp.to_do.checked, true, 'un champ checkbox JSON devient une case cochée');
  assert.ok(txt.indexOf('Avant d\'intervenir') < txt.indexOf('Intervention') && txt.indexOf('Intervention') < txt.indexOf('Clôture'));
});

// Template « Préventive machine 2.0 » (docs/templates/template-preventive-machine.md).
test('template préventive machine : aucun avertissement, ids uniques, options et libellés dans les limites, synchronisable', () => {
  const prev = fs.readFileSync(path.join(here, '..', '..', 'docs', 'templates', 'template-preventive-machine.md'), 'utf8');
  const w = load(prev); const a = phone(w, 'Karim Benali', 'cA');
  const r = a.load();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.warnings, []);
  const comps = r.data.templateBlocks.filter((b) => b.kind === 'component');
  assert.equal(new Set(comps.map((c) => c.id)).size, comps.length);
  assert.ok(comps.length > 70, comps.length + ' champs');
  comps.forEach((c) => {
    assert.ok(c.label.length <= 200, c.id);
    (c.options || []).forEach((o) => assert.ok(o.length <= 80, c.id + ' : ' + o));
  });
  assert.ok(r.data.templateBlocks.filter((b) => b.kind === 'section').length >= 11);
  assert.equal(r.data.templateBlocks.filter((b) => b.kind === 'invalid').length, 0);
  const sync = a.sync({ fields: { site: { v: 'Dropper Ordener', at: a.at() }, test_aru: { v: 'Les 4 sont fonctionnels', at: a.at() } } });
  assert.equal(sync.ok, true, JSON.stringify(sync));
  assert.equal(sync.data.applied.fields, 2);
});
