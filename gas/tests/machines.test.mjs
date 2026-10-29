// Liste des machines (Machines.gs) sur le simulateur de Notion.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, PNG_B64 } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs', 'Machines.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));
const world = () => { const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s)); return w; };
const t = (s) => [{ plain_text: s }];
const PNG = [...Buffer.from(PNG_B64, 'base64')];

function seed(w) {
  const idf = w.addRelated('Île de France');
  const leclerc = w.addRelated('Leclerc Paris');
  w.addFile('https://files.test/facade.jpeg', PNG);
  const ordener = w.addMachine({
    props: {
      Dropper: { type: 'title', title: t('Dropper Ordener') },
      'Adresse du site': { type: 'rich_text', rich_text: t('162 Rue Ordener, 75018 Paris') },
      'Adresse du site (Carte)': { type: 'rich_text', rich_text: t('162 Rue Ordener, 75018 Paris, France') },
      'Code boite à clé': { type: 'rich_text', rich_text: t('1818') },
      'Wi-Fi': { type: 'rich_text', rich_text: t('SSID : bolt_7e48d4\nMDP : s3cret') },
      'État Machine': { type: 'select', select: { name: 'Station Bloquée' } },
      'En exploitation': { type: 'select', select: { name: 'OUI' } },
      Type: { type: 'select', select: { name: 'Cellule' } },
      'N°Projet': { type: 'rich_text', rich_text: t('D008') },
      'Connexion machine': { type: 'multi_select', multi_select: [{ name: 'ADDSECURE - Backup' }, { name: 'Fibre - Lien Principal' }] },
      'Options machine': { type: 'multi_select', multi_select: [{ name: 'CollideCheck' }] },
      'Colis Pièces de maintenance': { type: 'rich_text', rich_text: t('Dans la pièce à droite sur les étagères') },
      'Régions de stock': { type: 'relation', relation: [{ id: idf }] },
      Clients: { type: 'relation', relation: [{ id: leclerc }] },
      'Liste des projets': { type: 'relation', relation: [{ id: leclerc }] },
      '🎟️ Actions Droppers 1': { type: 'relation', relation: [{ id: leclerc }] },
      'Photo site': { type: 'files', files: [{ name: 'facade.jpeg', type: 'file', file: { url: 'https://files.test/facade.jpeg' } }] },
      'Objectif commande / jour': { type: 'number', number: 40 },
      'Étage': { type: 'rich_text', rich_text: t('Sous-sol -1') },
      'Date Création': { type: 'created_time', created_time: '2024-07-07T00:00:00Z' }
    }
  });
  const forum = w.addMachine({ props: {
    Dropper: { type: 'title', title: t('Droppers Forum des Halles') },
    'Adresse du site (Carte)': { type: 'rich_text', rich_text: t('26 Rue Berger, 75001 Paris, France') },
    'En exploitation': { type: 'select', select: { name: 'NON' } }
  } });
  const auneuil = w.addMachine({ props: {
    Dropper: { type: 'title', title: t('Dropper Auneuil') },
    'Adresse du site': { type: 'rich_text', rich_text: t('100 Rte de Gisors, 60390 Auneuil') },
    'Wi-Fi': { type: 'rich_text', rich_text: t('code wifi invité : abc') },
    'En exploitation': { type: 'select', select: { name: 'OUI' } }
  } });
  w.addMachine({ props: { Dropper: { type: 'title', title: t('Ailleurs') } }, parentDb: '99999999999999999999999999999999' });
  return { ordener, forum, auneuil };
}

test('liste : triée, ville tirée de l’adresse, région résolue, exploitation, base étrangère absente', () => {
  const w = world(); seed(w); const { get } = api(w);
  const r = get({ action: 'machines' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.items.map((i) => i.title), ['Dropper Auneuil', 'Dropper Ordener', 'Droppers Forum des Halles']);
  const o = r.data.items[1];
  assert.deepEqual([o.city, o.region, o.status, o.active, o.type, o.project], ['Paris', 'Île de France', 'Station Bloquée', true, 'Cellule', 'D008']);
  assert.equal(r.data.items[0].city, 'Auneuil'); assert.equal(r.data.items[0].region, '');
  assert.equal(r.data.items[2].active, false);
  assert.deepEqual(get({ action: 'machines', sinceRev: r.data.rev }).data, { unchanged: true, rev: r.data.rev });
});

test('liste : les titres de relation sont lus une fois puis gardés en cache', () => {
  const w = world(); seed(w); const { get } = api(w);
  get({ action: 'machines' });
  w.flushCacheKeysExcept && w.flushCacheKeysExcept('rel:');
  w.calls.length = 0;
  get({ action: 'machine', id: w.machinePages.find((p) => p.properties.Dropper && p.properties.Dropper.title[0].plain_text === 'Dropper Ordener').id.replace(/-/g, '') });
  assert.equal(w.calls.filter((c) => /^\/pages\//.test(c.path)).length, 2, 'la page + le client (région déjà en cache)');
});

test('fiche : champs structurés, Wi-Fi décomposé, colonnes inconnues en « extras », relations « Actions » ignorées', () => {
  const w = world(); const { ordener } = seed(w); const { get } = api(w);
  const r = get({ action: 'machine', id: ordener.nid });
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = r.data;
  assert.equal(d.title, 'Dropper Ordener');
  assert.equal(d.keybox, '1818');
  assert.deepEqual(d.wifi, { raw: 'SSID : bolt_7e48d4\nMDP : s3cret', ssid: 'bolt_7e48d4', password: 's3cret' });
  assert.deepEqual(d.connections, ['ADDSECURE - Backup', 'Fibre - Lien Principal']);
  assert.deepEqual(d.options, ['CollideCheck']);
  assert.equal(d.region, 'Île de France'); assert.equal(d.client, 'Leclerc Paris');
  assert.equal(d.parts, 'Dans la pièce à droite sur les étagères');
  assert.equal(d.target, '40');
  assert.equal(d.mapAddress, '162 Rue Ordener, 75018 Paris, France');
  assert.deepEqual(d.extras, [{ label: 'Étage', value: 'Sous-sol -1' }]);
  assert.equal(d.photos.length, 1);
  assert.equal(JSON.stringify(d).includes('Actions'), false);
});

test('fiche : Wi-Fi en texte libre, champs absents = vides, rien d’inventé', () => {
  const w = world(); const { auneuil, forum } = seed(w); const { get } = api(w);
  const a = get({ action: 'machine', id: auneuil.nid }).data;
  assert.deepEqual(a.wifi, { raw: 'code wifi invité : abc', ssid: '', password: '' });
  const f = get({ action: 'machine', id: forum.nid }).data;
  assert.equal(f.wifi, null); assert.equal(f.keybox, ''); assert.deepEqual(f.photos, []); assert.equal(f.active, false);
});

test('fiche : inchangée = aucune lecture du corps ; mauvaise base refusée', () => {
  const w = world(); const { ordener } = seed(w); const { get } = api(w);
  const d = get({ action: 'machine', id: ordener.nid }).data;
  w.calls.length = 0;
  assert.deepEqual(get({ action: 'machine', id: ordener.nid, sinceEdited: d.updated }).data, { unchanged: true, updated: d.updated });
  assert.equal(w.calls.filter((c) => /children/.test(c.path)).length, 0);
  const other = w.machinePages.find((p) => p.properties.Dropper && p.properties.Dropper.title[0].plain_text === 'Ailleurs');
  assert.equal(get({ action: 'machine', id: other.id.replace(/-/g, '') }).error.code, 'NOT_FOUND');
});

test('photos : base64, lien frais, clés étrangères et fiche de méthode refusées', () => {
  const w = world(); const { ordener } = seed(w); const { get } = api(w);
  const d = get({ action: 'machine', id: ordener.nid }).data;
  const r = get({ action: 'machineMedia', page: ordener.nid, key: d.photos[0].key });
  assert.equal(r.data.data, PNG_B64); assert.equal(r.data.mime, 'image/png');
  assert.equal(get({ action: 'machineMedia', page: ordener.nid, key: d.photos[0].key, mode: 'url' }).data.url, 'https://files.test/facade.jpeg');
  assert.equal(get({ action: 'machineMedia', page: ordener.nid, key: 'p:Wi-Fi:0' }).error.code, 'BAD_REQUEST');
  const m = w.addMethod({ title: 'Une méthode' });
  assert.equal(get({ action: 'machineMedia', page: m.nid, key: d.photos[0].key }).error.code, 'NOT_FOUND');
});

test('configuration : noms de colonnes, masquage et valeurs « en exploitation » personnalisables', () => {
  const w = world(); const { ordener } = seed(w); const { get } = api(w);
  w.props.MACHINES_PROP_KEYBOX = 'Étage'; w.props.MACHINES_HIDDEN_PROPERTIES = 'Étage';
  const d = get({ action: 'machine', id: ordener.nid }).data;
  assert.equal(d.keybox, 'Sous-sol -1');
  assert.equal(d.extras.some((e) => e.label === 'Étage'), false);
  w.props.MACHINES_ACTIVE_YES = 'NON'; w.flushCache();
  assert.equal(get({ action: 'machines' }).data.items.find((i) => i.title === 'Droppers Forum des Halles').active, true);
});

test('session obligatoire ; testMachines s’exécute', () => {
  const w = world(); seed(w); const { raw } = api(w);
  assert.equal(raw.get({ action: 'machines' }).error.code, 'UNAUTHORIZED');
  run(w.ctx, 'testMachines()');
});
