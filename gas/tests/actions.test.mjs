// Actions à réaliser (Actions.gs) : lecture des pages liées, état + commentaire déposés dans les commentaires Notion.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, PAGE } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs', 'Machines.gs', 'Racks Casiers.gs', 'Actions.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));
const t = (s) => [{ plain_text: s }];

function seed() {
  const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s));
  const casier = w.addRelated('Casier 85'); const ticket = w.addRelated('Ticket 10/11/2026');
  w.addFile('https://files/plan.pdf', [1, 2, 3], 'application/pdf');
  const action = w.addMachine({ props: {
    Name: { type: 'title', title: t('Action exemple') },
    Type: { type: 'select', select: { name: 'Maintenance physique' } },
    Status: { type: 'status', status: { name: 'Planned' } },
    'Temps nécessaire': { type: 'select', select: { name: '15min' } },
    Description: { type: 'rich_text', rich_text: t('Voici la description') },
    'Matériel ou outillage spécifique': { type: 'rich_text', rich_text: t('Tournevis') },
    'Datasheet / Plans': { type: 'files', files: [{ name: 'plan.pdf', type: 'file', file: { url: 'https://files/plan.pdf' } }] },
    '☠️ Casiers et Racks KO': { type: 'relation', relation: [{ id: casier }] },
    Tickets: { type: 'relation', relation: [{ id: ticket }] }
  } });
  const other = w.addMachine({ props: { Name: { type: 'title', title: t('Action non liée') } } });
  w.pageProps = { 'Actions prévues': { type: 'relation', relation: [{ id: action.id }] } };
  return { w, action, other };
}

test('getIntervention : les actions liées sont jointes (titre, type, durée, fichiers, éléments liés)', () => {
  const { w, action } = seed(); const { get } = api(w);
  const r = get({ action: 'getIntervention', id: 'FI-252' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.actions.length, 1);
  const a = r.data.actions[0];
  assert.equal(a.id, action.nid);
  assert.deepEqual([a.title, a.type, a.time, a.description, a.tools], ['Action exemple', 'Maintenance physique', '15min', 'Voici la description', 'Tournevis']);
  assert.deepEqual(a.files.map((f) => [f.name, f.kind]), [['plan.pdf', 'pdf']]);
  assert.deepEqual(a.links.map((l) => [l.label, l.items]), [['Casiers et Racks KO', ['Casier 85']], ['Tickets', ['Ticket 10/11/2026']]]);
});

test('actionComment : état + texte dans les commentaires de l’action, rien d’autre modifié, sans doublon', () => {
  const { w, action } = seed(); const { post } = api(w);
  const body = { action: 'actionComment', id: 'e1', missionId: PAGE, pageId: action.nid, reference: 'FI-282', name: 'Mathis M', state: 'done', text: 'Remplacé sur place' };
  const r = post(body);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(w.comments.length, 1);
  const txt = w.comments[0].rich_text.map((x) => x.plain_text || x.text.content).join('');
  assert.equal(txt, '[Mathis M] État : Terminée · FI-282\nRemplacé sur place');
  assert.equal(post(body).data.duplicate, true);
  assert.equal(w.comments.length, 1);
  assert.equal(w.calls.filter((c) => c.method === 'PATCH').length, 0);
  assert.equal(post({ ...body, id: 'e2', state: '', text: 'Juste une remarque' }).ok, true);
  assert.match(w.comments[1].rich_text.map((x) => x.plain_text || x.text.content).join(''), /^\[Mathis M\] Commentaire · FI-282\nJuste/);
});

test('actionComment : refus (action non liée, état inconnu, vide, auteur manquant)', () => {
  const { w, action, other } = seed(); const { post } = api(w);
  const ok = { action: 'actionComment', missionId: PAGE, pageId: action.nid, name: 'Ana', state: 'doing' };
  assert.equal(post({ ...ok, id: 'a', pageId: other.nid }).error.code, 'FORBIDDEN');
  assert.equal(post({ ...ok, id: 'b', state: 'fini' }).error.code, 'BAD_REQUEST');
  assert.equal(post({ ...ok, id: 'c', state: '', text: ' ' }).error.code, 'BAD_REQUEST');
  assert.equal(post({ ...ok, id: 'd', name: '' }).error.code, 'AUTHOR_REQUIRED');
  assert.equal(w.comments.length, 0);
});

test('missionMedia : fichier d’une action liée servi si `mission` est fourni et cohérent', () => {
  const { w, action, other } = seed(); const { get } = api(w);
  const r = get({ action: 'missionMedia', page: action.nid, mission: PAGE, key: 'p:Datasheet / Plans:0', mode: 'data' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(get({ action: 'missionMedia', page: other.nid, mission: PAGE, key: 'p:x:0' }).error.code, 'FORBIDDEN');
});
