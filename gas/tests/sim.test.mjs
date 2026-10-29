// Banc de test de Code.gs + Report.gs (protocole v2 : rapport partagé).
// Lancer (depuis gas/) :  node --test "tests/*.test.mjs"
// Notion et Drive sont simulés (voir fake-notion.mjs) : on vérifie la logique du
// script, pas le contrat réel de l'API — pour ça, voir testNotionCapabilities().
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, phone, PAGE, ROOT, PNG_B64 } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));

function world() {
  const w = makeWorld();
  SRC.forEach((s) => run(w.ctx, s));
  return w;
}
const fields = (o, at) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v, at }]));
const lines = (w) => w.visibleReport().map((b) => w.text(b));

/* ═════════════════════════ Route 1 — lecture ═════════════════════════ */

test('getIntervention : token, propriétés, template, schéma', () => {
  const w = world(); const { get } = api(w);
  assert.equal(get({ action: 'getIntervention', id: 'FI-252', session: 'nope' }).error.code, 'UNAUTHORIZED');
  assert.equal(get({ action: 'ping', session: '' }).ok, true);
  const r = get({ action: 'getIntervention', id: 'fi 252' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.reference, 'FI-252');
  assert.equal(r.data.report, null);
  assert.ok(r.data.serverNow > 0);
  assert.deepEqual(r.data.schema.map((s) => s.id).slice(1), ['photo_compteur', 'etat_materiel', r.data.schema[3].id]);
  assert.equal(r.data.schema[0].k, 's');
  assert.deepEqual(r.data.schema[2].options, ['Neuf', 'Usagé', 'Défectueux']);
  assert.equal(r.data.warnings[0].code, 'INVALID_JSON');
  assert.equal(get({ action: 'getIntervention', id: 'FI-999' }).error.code, 'NOT_FOUND');
  assert.equal(get({ action: 'getIntervention', id: '???' }).error.code, 'BAD_REQUEST');
});

test('ordre et masquage des propriétés : propriétés de script « | », colonnes non citées à la suite', () => {
  const w = world(); const { get } = api(w);
  const labels = () => get({ action: 'getIntervention', id: 'FI-252' }).data.properties.map((p) => p.label);
  assert.deepEqual(labels(), ['Nom', 'ID', 'Client', 'Statut'], 'sans configuration : ordre de Notion');
  w.props = { PROPERTY_ORDER: ' Statut | Client ', HIDDEN_PROPERTIES: 'ID' };
  assert.deepEqual(labels(), ['Statut', 'Client', 'Nom']);
  w.props = { PROPERTY_ORDER: 'Inconnue|Nom' };
  assert.deepEqual(labels(), ['Nom', 'ID', 'Client', 'Statut'], 'un nom inconnu est sans effet');
  // masquer une colonne n'empêche pas de retrouver la mission par son ID
  w.props = { HIDDEN_PROPERTIES: 'ID' };
  assert.equal(get({ action: 'getIntervention', id: 'FI-252' }).data.reference, 'FI-252');
});

test('définitions de champs douteuses : avertissements précis, rien n’est retiré', () => {
  const w = world(); const { get } = api(w);
  const rt = w.rt;
  const block = (o) => ({ type: 'code', code: { language: 'json', rich_text: rt(JSON.stringify(o)) } });
  w.seedChildren(PAGE, [
    block([
      { type: 'text', id: 'ok_champ', label: 'Correct' },
      { type: 'texte', id: 'type_inconnu', label: 'Faux type' },
      { type: 'text', id: 'u_reserve', label: 'Préfixe réservé' },
      { type: 'text', id: 'avec espace', label: 'Id invalide' },
      { type: 'radio_group', id: 'sans_options', label: 'Sans options' },
      { type: 'select', id: 'trop_court', label: 'Une seule', options: ['A'] },
      { type: 'checkbox_group', id: 'bon_choix', label: 'Bon', options: ['A', 'B'] },
      { type: 'text', id: 'ok_champ', label: 'Doublon' }
    ])
  ]);
  const r = get({ action: 'getIntervention', id: 'FI-252' }).data;
  const codes = r.warnings.map((x) => x.code + ':' + (x.id || ''));
  assert.deepEqual(codes.filter((c) => !c.startsWith('INVALID_JSON')).sort(), [
    'BAD_ID:avec espace', 'BAD_OPTIONS:sans_options', 'BAD_OPTIONS:trop_court',
    'DUPLICATE_ID:', 'RESERVED_ID:u_reserve', 'UNKNOWN_TYPE:type_inconnu'
  ].sort());
  assert.equal(r.templateBlocks.filter((b) => b.kind === 'component').length, 3 + 8, 'tous les champs sont conservés (3 du template de base + 8)');
});

test('template rangé dans un toggle « Template … » : titre ignoré, contenu lu, rapport en dessous', () => {
  for (const kind of ['toggle', 'heading_1']) {
    const w = world(); const { get } = api(w); const rt = w.rt;
    w.childrenOf(PAGE).forEach((b) => { b.archived = true; });
    const inner = [
      { type: 'heading_2', heading_2: { rich_text: rt('Matériel') } },
      { type: 'code', code: { language: 'json', rich_text: rt(JSON.stringify({ type: 'text', id: 'ref', label: 'Référence' })) } },
      { type: 'to_do', to_do: { rich_text: rt('Zone dégagée'), checked: false } }
    ];
    const spec = kind === 'toggle'
      ? { type: 'toggle', toggle: { rich_text: rt('Template formulaire d’intervention'), children: inner } }
      : { type: 'heading_1', heading_1: { rich_text: rt('Template — formulaire'), is_toggleable: true, children: inner } };
    w.seedChildren(PAGE, [{ type: 'paragraph', paragraph: { rich_text: rt('Note interne') } }, spec]);
    const r = get({ action: 'getIntervention', id: 'FI-252' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const blocks = r.data.templateBlocks;
    assert.deepEqual(blocks.map((b) => b.kind + ':' + (b.text || b.label)), ['text:Note interne', 'section:Matériel', 'component:Référence', 'component:Zone dégagée'], kind);
    assert.deepEqual(r.data.schema.map((s) => s.id).filter((i) => !i.startsWith('S:')), ['ref', r.data.schema[2].id]);

    // le rapport est écrit APRÈS le toggle, au niveau de la page
    const a = phone(w, 'Karim Benali', 'cA'); a.load();
    assert.equal(a.sync({ fields: fields({ ref: 'CPT-1' }, a.at()) }).ok, true);
    const top = w.childrenOf(PAGE).map((b) => b.type);
    assert.deepEqual(top.slice(-2), ['toggle', 'toggle'], kind);       // rapport puis données de synchronisation
    assert.ok(top.length >= 3 && top.indexOf(kind) < top.length - 2, kind);
  }
});

/* ═════════════════════════ Création & mise à jour en place ═════════════════════════ */

test('1re synchro : squelette complet, état en JSON ASCII, rien d’autre dans la page', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA');
  a.load();
  const zone = a.schema[3].id;
  const r = a.sync({ fields: fields({ etat_materiel: 'Usagé', [zone]: true }, a.at()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.report.rev, 1);
  assert.equal(r.data.reset, false);

  const c = w.reportRoot();
  assert.equal(w.text(c), 'CR intervention — En cours');
  const top = w.childrenOf(PAGE);
  assert.deepEqual(top.filter((b) => b.type === 'toggle').map((b) => w.text(b)), ['CR intervention — En cours', 'Données de synchronisation (ne pas modifier)']);
  assert.equal(top.indexOf(w.stateToggle()), top.indexOf(c) + 1, 'données = frère juste après le rapport');
  assert.equal(top.some((b) => b.type === 'callout'), false);
  const l = lines(w);
  assert.match(l[0], /^Dernière modification : Karim Benali · 20\/10\/2026 08:00$/);
  assert.deepEqual(l.slice(1), ['Matériel', "Prendre en photo l'installation", 'État du matériel : Usagé', 'Zone dégagée']);
  assert.equal(w.visibleReport()[4].to_do.checked, true);
  assert.ok(/^[\x20-\x7e]*$/.test(w.stateJson()), 'JSON ASCII uniquement');
  assert.equal(JSON.parse(w.stateJson()).fields.etat_materiel.by, 'Karim Benali');
  assert.equal(w.count('PATCH', /children$/), 3, 'toggle rapport + toggle données + bloc JSON');
  // le template n'est pas pollué par le rapport
  const g = a.load();
  assert.ok(!JSON.stringify(g.data.templateBlocks).includes('Dernière modification'));
  assert.equal(g.data.report.rev, 1);
  assert.equal(g.data.report.fields.etat_materiel.v, 'Usagé');
});

test('mise à jour en place : 1 champ modifié = blocs existants patchés, aucun ajout ni suppression', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  const idsBefore = w.childrenOf(w.reportCallout().id).map((b) => b.id);
  w.now += 5 * 60_000; w.calls.length = 0;
  const r = a.sync({ fields: fields({ etat_materiel: 'Défectueux' }, a.at()) });
  assert.equal(r.data.applied.fields, 1);
  assert.deepEqual(w.childrenOf(w.reportCallout().id).map((b) => b.id), idsBefore);
  assert.equal(w.count('DELETE', /./), 0);
  assert.equal(w.calls.filter((c) => c.method === 'PATCH' && /children$/.test(c.path)).length, 0);
  assert.ok(lines(w).includes('État du matériel : Défectueux'));
  assert.equal(r.data.report.rev, 2);
});

test('rejeu de la même requête : sans effet, rév inchangée, aucune écriture Notion', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  const ch = { fields: fields({ etat_materiel: 'Neuf' }, a.at()) };
  a.sync(ch);
  w.calls.length = 0;
  const r = a.sync(ch);
  assert.equal(r.data.unchanged, true);
  assert.equal(r.data.report.rev, 1);
  assert.equal(w.writes().length, 0);
});

/* ═════════════════════════ Deux techniciens ═════════════════════════ */

test('2 techniciens : champs différents fusionnés, même champ = dernier gagnant, perdant prévenu', () => {
  const w = world();
  const a = phone(w, 'Karim Benali', 'cA');
  const b = phone(w, 'Sophie Martin', 'cB', -4 * 60_000);     // téléphone en retard de 4 min
  a.load(); b.load();
  const zone = a.schema[3].id;

  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  w.now += 60_000;
  // B n'a pas vu la modification de A. Son horloge retarde, mais sa saisie est postérieure à celle de A.
  const rb = b.sync({ fields: fields({ etat_materiel: 'Usagé', [zone]: true }, b.at()) });
  assert.equal(rb.data.overridden.length, 0, 'B est plus récente en temps réel : B gagne');
  assert.equal(rb.data.report.fields.etat_materiel.by, 'Sophie Martin');

  // A (qui ne sait rien) renvoie une valeur plus ancienne que celle de B
  const ra = a.sync({ fields: fields({ etat_materiel: 'Défectueux' }, a.at(-30_000)) });
  assert.equal(ra.data.overridden.length, 1);
  assert.deepEqual(ra.data.overridden[0].theirs.v, 'Usagé');
  assert.equal(ra.data.overridden[0].theirs.by, 'Sophie Martin');
  assert.equal(ra.data.overridden[0].mine, 'Défectueux');
  // …et récupère la fusion : la case de B est là
  assert.equal(ra.data.report.fields[zone].v, true);
  assert.ok(lines(w).includes('État du matériel : Usagé'));
  assert.match(lines(w)[0], /Karim Benali|Sophie Martin/);
});

test('égalité exacte d’horodatage : le plus grand clientId gagne, quel que soit l’ordre d’arrivée', () => {
  for (const order of [['cA', 'cB'], ['cB', 'cA']]) {
    const w = world(); const ps = { cA: phone(w, 'Karim Benali', 'cA'), cB: phone(w, 'Sophie Martin', 'cB') };
    ps.cA.load(); ps.cB.load();
    const at = w.now;
    order.forEach((id) => ps[id].sync({ fields: { etat_materiel: { v: id, at } } }));
    assert.equal(JSON.parse(w.stateJson()).fields.etat_materiel.v, 'cB');
  }
});

test('horloge du téléphone en avance : la saisie n’est jamais placée dans le futur', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA', +3_600_000); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  assert.ok(JSON.parse(w.stateJson()).fields.etat_materiel.at <= w.now);
  // un collègue qui saisit juste après n'est pas écrasé par l'avance de A
  const b = phone(w, 'Sophie Martin', 'cB'); b.load();
  w.now += 10_000;
  const r = b.sync({ fields: fields({ etat_materiel: 'Usagé' }, b.at()) });
  assert.equal(r.data.report.fields.etat_materiel.v, 'Usagé');
});

test('lecture légère : inchangé = aucune requête Notion ; changement = rapport ; présence', () => {
  const w = world();
  const a = phone(w, 'Karim Benali', 'cA'); const b = phone(w, 'Sophie Martin', 'cB');
  a.load(); b.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  b.load();
  w.calls.length = 0;
  const p1 = b.poll();
  assert.equal(p1.data.unchanged, true); assert.equal(w.calls.length, 0, 'zéro appel Notion');
  assert.deepEqual(p1.data.editors.map((e) => e.name), ['Karim Benali']);
  w.now += 1000;
  a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
  const p2 = b.poll();
  assert.equal(p2.data.unchanged, false);
  assert.equal(p2.data.report.fields.etat_materiel.v, 'Usagé');
  // cache évincé : relecture depuis Notion, même état
  w.flushCache(); w.calls.length = 0;
  const p3 = b.poll();
  assert.equal(p3.data.unchanged, false);
  assert.equal(p3.data.report.rev, p2.data.report.rev);
  assert.ok(w.count('GET', /children/) > 0);
  assert.equal(b.poll().data.unchanged, false, 'b n’a pas encore intégré la rév');
});

/* ═════════════════════════ Validation partagée ═════════════════════════ */

test('valider : dernières saisies appliquées, CR figé pour tous, réouverture par n’importe qui', () => {
  const w = world();
  const a = phone(w, 'Karim Benali', 'cA'); const b = phone(w, 'Sophie Martin', 'cB');
  a.load(); b.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  w.now += 1000;
  const v = a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()), status: { value: 'validated', at: a.at() } });
  assert.equal(v.data.applied.status, true);
  assert.equal(v.data.report.fields.etat_materiel.v, 'Usagé', 'saisie envoyée avec la validation appliquée');
  assert.equal(w.text(w.reportCallout()), "CR intervention — Validé");
  assert.match(lines(w)[0], /Validé par Karim Benali/);

  w.now += 1000;
  const rej = b.sync({ fields: fields({ etat_materiel: 'Défectueux' }, b.at()) });
  assert.deepEqual(rej.data.rejected.fields, ['etat_materiel']);
  assert.equal(rej.data.rejected.reason, 'VALIDATED');
  assert.equal(rej.data.report.status, 'validated');
  assert.ok(lines(w).includes('État du matériel : Usagé'));

  w.now += 1000;
  const re = b.sync({ fields: fields({ etat_materiel: 'Défectueux' }, b.at()), status: { value: 'draft', at: b.at() } });
  assert.equal(re.data.report.status, 'draft');
  assert.equal(re.data.report.fields.etat_materiel.v, 'Défectueux');
  assert.equal(w.text(w.reportCallout()), 'CR intervention — En cours');
});

test('une validation plus ancienne qu’une réouverture est refusée', () => {
  const w = world();
  const a = phone(w, 'Karim Benali', 'cA'); const b = phone(w, 'Sophie Martin', 'cB');
  a.load(); b.load();
  const t0 = w.now;
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, t0) , status: { value: 'validated', at: t0 + 1000 } });
  w.now += 5000;
  b.sync({}, {}); // b rejoint
  b.sync({ status: { value: 'draft', at: t0 + 3000 } });
  w.now += 1000;
  const late = a.sync({ status: { value: 'validated', at: t0 + 2000 } });     // saisie hors ligne, plus ancienne
  assert.equal(late.data.rejected.status, true);
  assert.equal(late.data.report.status, 'draft');
});

/* ═════════════════════════ Photos ═════════════════════════ */

test('photos : lots de 6, reste signalé, images sous le bon champ, transit Drive nettoyé', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  const ids = Array.from({ length: 8 }, (_, i) => `media-${i + 1}-xx`);
  const files = ids.map((m) => a.upload(m));
  const folder = w.drive[files[0]].parent;
  const add = ids.map((m, i) => ({ mediaId: m, componentId: 'photo_compteur', driveFileId: files[i], at: a.at(i) }));

  const r1 = a.sync({ photos: { add } });
  assert.equal(r1.data.applied.photos, 6);
  assert.equal(r1.data.photosRemaining, 2);
  assert.equal(r1.data.report.photos.photo_compteur.length, 6);
  const photoBlock = w.visibleReport().find((b) => w.text(b).startsWith("Prendre en photo"));
  assert.equal(w.childrenOf(photoBlock.id).filter((b) => b.type === 'image').length, 6);
  assert.equal(r1.data.cleanup.trashedFiles, 6);

  const r2 = a.sync({ photos: { add } });          // le client renvoie tout ce qui n'est pas acquitté
  assert.equal(r2.data.applied.photos, 2);
  assert.equal(r2.data.photosRemaining, 0);
  assert.equal(w.childrenOf(photoBlock.id).filter((b) => b.type === 'image').length, 8);
  assert.ok(files.every((f) => w.drive[f].trashed));
  assert.equal(w.folders[folder].trashed, true);
  assert.equal(w.folders[ROOT].trashed, false);
  assert.equal(Object.values(w.uploads).length, 8, 'chaque photo n’est transférée qu’une fois');

  // rejeu : rien de plus dans Notion
  const r3 = a.sync({ photos: { add } });
  assert.equal(r3.data.unchanged, true);
  assert.equal(w.childrenOf(photoBlock.id).filter((b) => b.type === 'image').length, 8);
});

test('photo déjà dans le rapport mais acquittement perdu (cache évincé) : pas de doublon, transit libéré', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  const f = a.upload('media-005-ee');
  const add = [{ mediaId: 'media-005-ee', componentId: 'photo_compteur', driveFileId: f, at: a.at() }];
  a.sync({ photos: { add } });
  w.flushCache(); w.drive[f].trashed = false;          // le serveur a oublié, le fichier est encore là
  const r = a.sync({ photos: { add } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.applied.photos, 0);
  assert.equal(r.data.report.photos.photo_compteur.length, 1);
  const pb = w.visibleReport().find((b) => w.text(b).startsWith('Prendre'));
  assert.equal(w.childrenOf(pb.id).length, 1);
  assert.equal(w.drive[f].trashed, true);
});

test('photo supprimée par un technicien : bloc image supprimé ; photo perdue dans Drive : signalée, le reste passe', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  const f1 = a.upload('media-001-aa'); const f2 = a.upload('media-002-bb');
  w.drive[f2].purged = true;
  const r = a.sync({ photos: { add: [
    { mediaId: 'media-001-aa', componentId: 'photo_compteur', driveFileId: f1, at: a.at() },
    { mediaId: 'media-002-bb', componentId: 'photo_compteur', driveFileId: f2, at: a.at() }] } });
  assert.equal(r.data.applied.photos, 1);
  assert.equal(r.data.photoErrors[0].code, 'MEDIA_NOT_FOUND');
  assert.equal(r.data.photoErrors[0].mediaId, 'media-002-bb');
  w.now += 1000;
  const d = a.sync({ photos: { remove: [{ mediaId: 'media-001-aa', at: a.at() }] } });
  assert.equal(d.data.applied.photosRemoved, 1);
  const pb = w.visibleReport().find((b) => w.text(b).startsWith('Prendre'));
  assert.equal(w.childrenOf(pb.id).length, 0);
  assert.deepEqual(d.data.report.photos.photo_compteur || [], []);
});

test('photo hors du dossier racine Drive → FORBIDDEN (aucune écriture de photo)', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  const outside = w.mkFile('OUTSIDE_FILE_ID_000000000000000', 's.png', null,
    { getName: () => 's.png', setName() { return this; }, getContentType: () => 'image/png' });
  w.drive[outside.id] = outside;
  const r = a.sync({ photos: { add: [{ mediaId: 'media-003-cc', componentId: 'photo_compteur', driveFileId: outside.id, at: a.at() }] } });
  assert.equal(r.ok, true);
  assert.equal(r.data.applied.photos, 0);
  assert.equal(r.data.photoErrors[0].code, 'FORBIDDEN');
});

test('photo envoyée sur un CR validé : refusée, fichier Drive conservé pour plus tard', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ status: { value: 'validated', at: a.at() } });
  w.now += 1000;
  const f = a.upload('media-004-dd');
  const r = a.sync({ photos: { add: [{ mediaId: 'media-004-dd', componentId: 'photo_compteur', driveFileId: f, at: a.at() }] } });
  assert.deepEqual(r.data.rejected.photos, ['media-004-dd']);
  assert.equal(w.drive[f].trashed, false);
});

/* ═════════════════════════ Champs ajoutés par les techniciens ═════════════════════════ */

test('champs ajoutés : section « Ajouts terrain », valeur, suppression douce, section retirée avec le dernier', () => {
  const w = world();
  const a = phone(w, 'Karim Benali', 'cA'); const b = phone(w, 'Sophie Martin', 'cB');
  a.load(); b.load();
  const r = a.sync({ custom: { add: [
    { id: 'u_abc123', type: 'text', label: 'Numéro de série', at: a.at() },
    { id: 'u_def456', type: 'radio_group', label: 'Accès', options: ['Libre', 'Clé'], at: a.at(1) },
    { id: 'u_bad', type: 'script', label: 'x', at: a.at() }] } });
  assert.equal(r.data.applied.custom, 2);
  assert.equal(r.data.report.custom.length, 2);
  const l = lines(w);
  assert.deepEqual(l.slice(-3), ['Ajouts terrain', 'Numéro de série : —', 'Accès : —']);
  // l'autre technicien voit le champ et le remplit
  w.now += 1000;
  const rb = b.sync({ fields: fields({ u_abc123: 'SN-42' }, b.at()) });
  assert.equal(rb.data.report.custom.length, 2);
  assert.ok(lines(w).includes('Numéro de série : SN-42'));
  // suppression : un champ puis l'autre
  w.now += 1000;
  a.sync({ custom: { remove: [{ id: 'u_abc123', at: a.at() }] } });
  assert.ok(!lines(w).some((x) => x.startsWith('Numéro de série')));
  assert.ok(lines(w).includes('Ajouts terrain'));
  w.now += 1000;
  const last = a.sync({ custom: { remove: [{ id: 'u_def456', at: a.at() }] } });
  assert.ok(!lines(w).includes('Ajouts terrain'));
  assert.deepEqual(last.data.report.removedCustom.sort(), ['u_abc123', 'u_def456']);
  // un rejeu de l'ajout ne ressuscite pas un champ supprimé
  const again = a.sync({ custom: { add: [{ id: 'u_abc123', type: 'text', label: 'Numéro de série', at: a.at() }] } });
  assert.equal(again.data.applied.custom, 0);
});

test('champs ajoutés refusés sur un CR validé', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ status: { value: 'validated', at: a.at() } });
  w.now += 1000;
  const r = a.sync({ custom: { add: [{ id: 'u_zzz999', type: 'text', label: 'Tard', at: a.at() }] } });
  assert.deepEqual(r.data.rejected.custom, ['u_zzz999']);
});

/* ═════════════════════════ Évolutions du template ═════════════════════════ */

function addTemplateBlockAfterReport(w, spec) {
  w.seedChildren(PAGE, [spec]);
}

test('le responsable ajoute des blocs APRÈS le rapport : récupérés et insérés au bon endroit sans toucher aux saisies', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
  addTemplateBlockAfterReport(w, { type: 'heading_1', heading_1: { rich_text: w.rt('Sécurité') } });
  addTemplateBlockAfterReport(w, { type: 'code', code: { language: 'json', rich_text: w.rt(JSON.stringify({ type: 'radio_group', id: 'epi', label: 'EPI portés', options: ['Oui', 'Non'] })) } });
  addTemplateBlockAfterReport(w, { type: 'to_do', to_do: { rich_text: w.rt('Consignes lues'), checked: false } });

  const g = a.load();                               // « Actualiser »
  assert.deepEqual(g.data.schema.map((s) => s.id).slice(-3).map((x) => x.replace(/^S:.*/, 'S')), ['S', 'epi', g.data.schema.at(-1).id]);
  assert.equal(g.data.report.fields.etat_materiel.v, 'Usagé', 'saisies intactes');

  w.now += 1000; w.calls.length = 0;
  const r = a.sync({ fields: fields({ epi: 'Oui' }, a.at()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(lines(w).slice(-3), ['Sécurité', 'EPI portés : Oui', 'Consignes lues']);
  assert.ok(lines(w).includes('État du matériel : Usagé'));
  assert.equal(w.count('DELETE', /./), 0);
});

test('nouveau champ inséré au milieu : placé après son prédécesseur, pas en fin de rapport', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
  const schema = a.schema.map((x) => ({ ...x }));
  schema.splice(2, 0, { k: 'f', id: 'marque', type: 'text', label: 'Marque' });     // entre la photo et l'état
  a.schema = schema;
  w.now += 1000;
  a.sync({ fields: fields({ marque: 'Itron' }, a.at()) });
  assert.deepEqual(lines(w).slice(1, 5), ['Matériel', "Prendre en photo l'installation", 'Marque : Itron', 'État du matériel : Usagé']);
});

test('Notion refuse « position » : repli sur « after » ; refuse les deux : ajout en fin avec avertissement', () => {
  for (const [mode, expectWarn] of [['after-only', false], ['none', true]]) {
    const w = world(); w.positionMode = mode; const a = phone(w, 'Karim Benali', 'cA'); a.load();
    a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
    const schema = a.schema.map((x) => ({ ...x }));
    schema.splice(2, 0, { k: 'f', id: 'marque', type: 'text', label: 'Marque' });
    a.schema = schema; w.now += 1000;
    const r = a.sync({ fields: fields({ marque: 'Itron' }, a.at()) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data.warnings.some((x) => x.code === 'POSITION_UNSUPPORTED'), expectWarn, mode);
    assert.ok(lines(w).includes('Marque : Itron'), mode);
    if (!expectWarn) assert.equal(lines(w)[3], 'Marque : Itron');
  }
});

test('élément retiré du template : conservé dans le rapport (il peut contenir des saisies)', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
  a.schema = a.schema.filter((s) => s.id !== 'etat_materiel');
  w.now += 1000;
  const r = a.sync({ fields: fields({ [a.schema[2].id]: true }, a.at()) });
  assert.ok(r.data.report.schema.some((s) => s.id === 'etat_materiel'));
  assert.ok(lines(w).includes('État du matériel : Usagé'));
});

test('libellé modifié par le responsable : bloc mis à jour en place', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
  a.schema = a.schema.map((s) => (s.id === 'etat_materiel' ? { ...s, label: 'État du compteur' } : s));
  w.now += 1000;
  a.sync({});
  assert.ok(lines(w).includes('État du compteur : Usagé'));
  assert.ok(!lines(w).some((x) => x.startsWith('État du matériel')));
});

/* ═════════════════════════ Robustesse ═════════════════════════ */

test('bloc supprimé à la main dans Notion : recréé à la prochaine modification de ce champ', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  const victim = w.visibleReport().find((b) => w.text(b).startsWith('État du matériel'));
  victim.archived = true;
  w.now += 1000;
  const r = a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(lines(w).includes('État du matériel : Usagé'));
  assert.equal(lines(w).filter((x) => x.startsWith('État du matériel')).length, 1);
});

test('rapport entier supprimé à la main (cache périmé) : recréé, « reset » demandé au client', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  w.reportCallout().archived = true;
  w.now += 1000;
  const r = a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.reset, true);
  assert.equal(r.data.report.rev, 1);
  assert.ok(lines(w).includes('État du matériel : Usagé'));
});

test('données de synchronisation abîmées à la main : rapport reconstruit, avertissement', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  const code = w.childrenOf(w.stateToggle().id)[0];
  code.code.rich_text = [{ type: 'text', text: { content: '{ abîmé' }, plain_text: '{ abîmé' }];
  w.flushCache(); w.now += 1000;
  const r = a.sync({ fields: fields({ etat_materiel: 'Usagé' }, a.at()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.data.warnings.some((x) => x.code === 'STATE_CORRUPT'));
  assert.equal(r.data.reset, true);
  assert.equal(w.visibleReport().length > 0, true);
  const tops = w.childrenOf(PAGE);
  assert.equal(tops.filter((b) => b.type === 'toggle' && w.text(b).startsWith('CR intervention')).length, 1);
  assert.equal(tops.filter((b) => b.type === 'toggle' && w.text(b).startsWith('Données de synchronisation')).length, 1);
});

test('ancien rapport v1 (sans données de synchronisation) : remplacé, jamais deux rapports', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA');
  w.seedChildren(PAGE, [{ type: 'callout', callout: { icon: { type: 'emoji', emoji: '📋' }, rich_text: w.rt("Rapport d'intervention — 01/01/2026 10:00") } }]);
  const g = a.load();
  assert.equal(g.data.report, null);
  const r = a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const tops = w.childrenOf(PAGE);
  assert.equal(tops.filter((b) => b.type === 'callout').length, 0, 'ancien callout retiré');
  assert.deepEqual(tops.filter((b) => b.type === 'toggle').map((b) => w.text(b)), ['CR intervention — En cours', 'Données de synchronisation (ne pas modifier)']);
  assert.ok(r.data.warnings.some((x) => x.code === 'LEGACY_REPORT_REPLACED'));
});

test('texte > 2000 caractères, accents et emoji : découpés, relus à l’identique après éviction du cache', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  const long = 'é€😀 xyz'.repeat(900);                 // > 2000 caractères, multi-octets
  a.sync({ fields: fields({ etat_materiel: long }, a.at()) });
  assert.ok(w.stateRich().length > 1, 'état découpé en plusieurs morceaux');
  assert.ok(w.stateRich().every((t) => t.text.content.length <= 2000));
  w.flushCache();
  const b = phone(w, 'Sophie Martin', 'cB');
  const g = b.load();
  assert.equal(g.data.report.fields.etat_materiel.v, long);
  assert.ok(w.visibleReport().some((x) => x.paragraph && x.paragraph.rich_text.every((t) => t.text.content.length <= 2000)));
});

test('gros formulaire (> 100 éléments) : création par lots, imbrication autorisée', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  const schema = [{ k: 's', id: 'S:x', text: 'Gros', level: 1 }];
  for (let i = 0; i < 130; i++) schema.push({ k: 'f', id: 'c' + i, type: 'checkbox', label: 'Point ' + i });
  a.schema = schema;
  const r = a.sync({ fields: fields({ c5: true, c129: true }, a.at()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(w.visibleReport().length, 1 + 131);
  assert.equal(w.visibleReport()[7].to_do.checked, true);
  assert.equal(w.visibleReport().at(-1).to_do.checked, true);
});

test('panne Notion en cours de synchro : erreur franche, puis reprise sans doublon', () => {
  const w = world(); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  a.sync({ fields: fields({ etat_materiel: 'Neuf' }, a.at()) });
  w.failNext = Object.assign(/PATCH \/blocks\/[^/]+$/, { code: 502 });
  w.now += 1000;
  const ch = { fields: fields({ etat_materiel: 'Usagé' }, a.at()) };
  const bad = a.sync(ch);
  assert.equal(bad.ok, false);
  const ok = a.sync(ch);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(lines(w).filter((x) => x.startsWith('État du matériel')).length, 1);
  assert.ok(lines(w).includes('État du matériel : Usagé'));
});

/* ═════════════════════════ Sécurité ═════════════════════════ */

test('contrôles : token, auteur, clientId, page hors base, valeurs invalides', () => {
  const w = world(); const { post } = api(w); const a = phone(w, 'Karim Benali', 'cA'); a.load();
  assert.equal(post({ action: 'syncReport', session: 'x', notionPageId: PAGE }).error.code, 'UNAUTHORIZED');
  assert.equal(post({ action: 'syncReport', notionPageId: 'pas-un-id', clientId: 'c', author: { firstName: 'a', lastName: 'b' } }).error.code, 'BAD_REQUEST');
  assert.equal(post({ action: 'syncReport', notionPageId: PAGE, author: { firstName: 'a', lastName: 'b' } }).error.code, 'BAD_REQUEST');
  assert.equal(post({ action: 'syncReport', notionPageId: PAGE, clientId: 'c', author: { firstName: ' ', lastName: '' } }).error.code, 'AUTHOR_REQUIRED');

  w.pageDb = '99999999-9999-9999-9999-999999999999'; w.calls.length = 0;
  const e = a.sync({ fields: fields({ etat_materiel: 'x' }, a.at()) });
  assert.equal(e.error.code, 'FORBIDDEN'); assert.equal(w.writes().length, 0);
  w.pageDb = null;

  const r = a.sync({ fields: { inconnu: { v: 1, at: a.at() }, etat_materiel: { v: { x: 1 }, at: a.at() }, photo_compteur: { v: 'x', at: a.at() } } });
  assert.equal(r.ok, true);
  assert.equal(r.data.applied.fields, 0);
  assert.deepEqual(r.data.warnings.map((x) => x.code).sort(), ['INVALID_VALUE', 'PHOTO_FIELD_HAS_NO_VALUE', 'UNKNOWN_FIELD']);
});

test('route 2 uploadMedia : dossier par référence, idempotent, sans lien public, types refusés', () => {
  const w = world(); const { post } = api(w);
  const a = post({ action: 'uploadMedia', fileData: 'data:image/png;base64,' + PNG_B64, fileName: 'compteur.png', mimeType: 'image/png', mediaId: 'm-1', reference: 'FI-252' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.data.driveUrl, undefined);
  assert.equal(w.folders[w.drive[a.data.fileId].parent].name, 'FI-252');
  const b = post({ action: 'uploadMedia', fileData: PNG_B64, fileName: 'compteur.png', mimeType: 'image/png', mediaId: 'm-1', reference: 'FI-252' });
  assert.equal(b.data.duplicate, true); assert.equal(b.data.fileId, a.data.fileId);
  assert.equal(Object.keys(w.drive).length, 1);
  assert.equal(post({ action: 'uploadMedia', fileData: PNG_B64, fileName: 'x.heic', mimeType: 'image/heic' }).error.code, 'UNSUPPORTED_TYPE');
  assert.equal(post({ action: 'uploadMedia', fileData: '@@@', fileName: 'x.png', mimeType: 'image/png' }).error.code, 'BAD_REQUEST');
});

test('testNotionCapabilities s’exécute de bout en bout sur le simulateur et nettoie ses blocs', () => {
  const w = world();
  run(w.ctx, 'testNotionCapabilities()');
  assert.equal(w.kids[Object.keys(w.kids)[0]].filter((i) => !w.blocks[i].archived && /TEST capacités/.test(w.text(w.blocks[i]))).length, 0);
});

test('testTemplate (Apps Script) : résumé lisible et avertissements, sans planter', () => {
  const w = world();
  const logs = [];
  w.ctx.Logger = { log: (f, ...a) => logs.push(a.reduce((t, x) => t.replace('%s', x), f)) };
  run(w.ctx, 'testTemplate()');
  assert.match(logs[0], /^Fiche FI-252 : 3 champ\(s\), 1 intertitre\(s\), 4 propriété\(s\)/);
  assert.ok(logs.some((l) => l.includes('INVALID_JSON')));
});
