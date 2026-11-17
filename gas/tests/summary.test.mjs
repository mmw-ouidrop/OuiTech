// Synthèse sur la fiche : colonne « Compte rendu » (actions + CR) et colonne « Photos d’intervention ».
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, phone, PAGE } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs', 'Machines.gs', 'Racks Casiers.gs', 'Actions.gs', 'Summary.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));
const t = (s) => [{ plain_text: s }];
const fields = (o, at) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v, at }]));
const plainOf = (prop) => prop.rich_text.map((x) => x.plain_text).join('');

function seed() {
  const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s));
  const action = w.addMachine({ props: { Name: { type: 'title', title: t('Contrôle ALK') } } });
  w.pageProps = {
    'Actions prévues': { type: 'relation', relation: [{ id: action.id }] },
    'Compte rendu': { type: 'rich_text', rich_text: [] },
    'Photos d’intervention': { type: 'files', files: [{ name: 'ancienne.png', type: 'file', file: { url: 'https://notion.files/old' } }] }
  };
  return { w, action };
}

test('« Compte rendu » : actions (état + commentaires) puis CR renseigné, tenu à jour', () => {
  const { w, action } = seed();
  const a = phone(w, 'Karim Benali', 'cA'); a.load();
  const r0 = a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  const s1 = plainOf(w.pageProps['Compte rendu']);
  assert.match(s1, /^ACTIONS À RÉALISER\n▸ Contrôle ALK — Sans état\n/);
  assert.match(s1, /COMPTE RENDU D’INTERVENTION FI-252 — En cours/);
  assert.match(s1, /État du matériel : Neuf|etat_materiel|Neuf/);
  // un commentaire d'action met aussitôt la synthèse à jour (état + texte, auteur)
  const r = api(w).post({ action: 'actionComment', id: 'k1', missionId: PAGE, pageId: action.nid, reference: 'FI-252', name: 'Romane Perez', state: 'done', text: 'Pas d’amorces de rupture' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const s2 = plainOf(w.pageProps['Compte rendu']);
  assert.match(s2, /▸ Contrôle ALK — Terminée\n   • .* · Romane Perez · Terminée : Pas d’amorces de rupture\n/);
  // gras sur les titres
  assert.ok(w.pageProps['Compte rendu'].rich_text.some((x) => x.annotations && x.annotations.bold && /ACTIONS À RÉALISER/.test(x.plain_text)));
  // validation : statut repris
  a.sync({ status: { value: 'validated', at: a.at(5) } });
  assert.match(plainOf(w.pageProps['Compte rendu']), /Validé par Karim Benali/);
});

test('« Photos d’intervention » : chaque photo du CR y est ajoutée (sans toucher aux fichiers existants), retirée si supprimée', () => {
  const { w } = seed();
  const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  const f1 = a.upload('media-0001', 'a.jpg', 'image/jpeg'); const f2 = a.upload('media-0002', 'b.jpg', 'image/jpeg');
  const add = [
    { mediaId: 'media-0001', componentId: 'photo_compteur', driveFileId: f1, fileName: 'a.jpg', at: a.at(1) },
    { mediaId: 'media-0002', componentId: 'photo_compteur', driveFileId: f2, fileName: 'b.jpg', at: a.at(2) }
  ];
  const r = a.sync({ photos: { add } });
  assert.equal(r.data.applied.photos, 2, JSON.stringify([r.data.photoErrors, r.data.warnings, r.error]));
  const names = w.pageProps['Photos d’intervention'].files.map((x) => x.name);
  assert.equal(names.length, 3);
  assert.equal(names[0], 'ancienne.png');
  assert.ok(names.slice(1).every((n) => /^Prendre en photo.* · dia-000[12]\.jpg$/.test(n)), names.join(' | '));
  assert.match(plainOf(w.pageProps['Compte rendu']), /: 2 fichiers/);
  // rejeu : pas de doublon
  a.sync({ photos: { add } });
  assert.equal(w.pageProps['Photos d’intervention'].files.length, 3);
  // suppression d'une photo : retirée de la colonne aussi
  a.sync({ photos: { remove: [{ mediaId: 'media-0001', at: a.at(9) }] } });
  const left = w.pageProps['Photos d’intervention'].files.map((x) => x.name);
  assert.equal(left.length, 2);
  assert.ok(left.some((n) => /· dia-0002/.test(n)));
  assert.ok(!left.some((n) => /· dia-0001/.test(n)) && left.includes('ancienne.png'));
});

test('colonnes absentes : la synchro réussit sans bruit ; une erreur Notion sur la synthèse ne bloque jamais', () => {
  const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s));
  const a = phone(w, 'Karim Benali', 'cA'); a.load();
  const r = a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  assert.equal(r.ok, true);
  assert.ok(!r.data.warnings.some((x) => /SUMMARY/.test(x.code)));
  w.pageProps = { 'Compte rendu': { type: 'rich_text', rich_text: [] } };
  w.pageProps.Fake = null;
  delete w.pageProps.Fake;
  const orig = w.pageProps;
  w.pageProps = new Proxy(orig, { get: (o, k) => k === 'Compte rendu' ? { type: 'title', title: [] } : o[k] });   // mauvais type
  const r2 = a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at(2)) });
  assert.equal(r2.ok, true, JSON.stringify(r2));
});
