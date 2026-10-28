// Connexion à deux niveaux (Auth.gs) : mots de passe, session signée, expiration, révocation, blocage.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, PW_TECH, PW_SUPPORT } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));
const world = () => { const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s)); return w; };
const login = (raw, over = {}) => raw.post({ action: 'login', password: PW_TECH, firstName: 'Karim', lastName: 'Benali', clientId: 'dev-1', ...over });

test('chaque mot de passe donne son niveau ; la session sert ensuite de laissez-passer', () => {
  const w = world(); const { raw } = api(w);
  const t = login(raw);
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(t.data.role, 'tech');
  assert.ok(t.data.expiresAt - t.data.issuedAt === 30 * 86400000, '30 jours par défaut');
  const s = login(raw, { password: PW_SUPPORT });
  assert.equal(s.data.role, 'support');

  const ok = raw.get({ action: 'session', session: t.data.session });
  assert.equal(ok.ok, true); assert.equal(ok.data.role, 'tech');
  assert.equal(raw.get({ action: 'getIntervention', id: 'FI-252', session: s.data.session }).ok, true);
});

test('sans session, mauvaise session ou session trafiquée : aucune donnée', () => {
  const w = world(); const { raw } = api(w);
  assert.equal(raw.get({ action: 'getIntervention', id: 'FI-252' }).error.code, 'UNAUTHORIZED');
  assert.equal(raw.get({ action: 'getReport', pageId: 'x', session: 'v1.a.b' }).error.code, 'UNAUTHORIZED');
  assert.equal(raw.post({ action: 'syncReport', notionPageId: 'x' }).error.code, 'UNAUTHORIZED');
  const good = login(raw).data.session;
  const [v, p, sig] = good.split('.');
  // niveau modifié à la main (tech → support) : la signature ne correspond plus
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), r: 'support' })).toString('base64url');
  assert.equal(raw.get({ action: 'session', session: `${v}.${forged}.${sig}` }).error.code, 'UNAUTHORIZED');
  assert.equal(raw.get({ action: 'session', session: `${v}.${p}.${sig.slice(0, -2)}xx` }).error.code, 'UNAUTHORIZED');
  assert.equal(raw.get({ action: 'session', session: good }).ok, true);
  // le mot de passe n'est pas un laissez-passer
  assert.equal(raw.get({ action: 'session', session: PW_TECH }).error.code, 'UNAUTHORIZED');
});

test('mauvais mot de passe, nom manquant, aucun mot de passe configuré', () => {
  const w = world(); const { raw } = api(w);
  assert.equal(login(raw, { password: 'nope' }).error.code, 'BAD_PASSWORD');
  assert.equal(login(raw, { password: '' }).error.code, 'BAD_PASSWORD');
  assert.equal(login(raw, { firstName: ' ' }).error.code, 'NAME_REQUIRED');
  assert.equal(login(raw, { lastName: '' }).error.code, 'NAME_REQUIRED');
  // espaces autour du mot de passe (copier-coller) tolérés
  assert.equal(login(raw, { password: `  ${PW_TECH}\n` }).ok, true);
  w.props = { PASSWORD_TECH: '', PASSWORD_SUPPORT: '' };
  assert.equal(login(raw).error.code, 'CONFIG_MISSING');
  // seul le niveau tech configuré : le niveau support n'existe pas
  w.props = { PASSWORD_SUPPORT: '' };
  assert.equal(login(raw, { password: PW_SUPPORT }).error.code, 'BAD_PASSWORD');
});

test('blocage : 5 échecs par appareil, les autres appareils restent servis', () => {
  const w = world(); const { raw } = api(w);
  for (let i = 0; i < 5; i++) assert.equal(login(raw, { password: 'x' + i }).error.code, 'BAD_PASSWORD');
  const blocked = login(raw);                                       // même le BON mot de passe est refusé
  assert.equal(blocked.error.code, 'TOO_MANY_ATTEMPTS');
  assert.equal(blocked.error.retryAfterSec, 600);
  assert.equal(login(raw, { clientId: 'dev-2' }).ok, true, 'un autre appareil n’est pas bloqué');
  w.flushCache();                                                   // 10 min plus tard (cache expiré)
  assert.equal(login(raw).ok, true);
});

test('un succès remet le compteur de l’appareil à zéro', () => {
  const w = world(); const { raw } = api(w);
  for (let i = 0; i < 4; i++) login(raw, { password: 'x' });
  assert.equal(login(raw).ok, true);
  for (let i = 0; i < 4; i++) assert.equal(login(raw, { password: 'x' }).error.code, 'BAD_PASSWORD');
});

test('blocage global : 60 échecs en une heure, tous appareils', () => {
  const w = world(); const { raw } = api(w);
  for (let i = 0; i < 60; i++) login(raw, { password: 'x', clientId: 'bot-' + i });
  assert.equal(login(raw, { clientId: 'honnete' }).error.code, 'TOO_MANY_ATTEMPTS');
});

test('expiration et révocation : durée SESSION_DAYS, SESSION_EPOCH déconnecte tout le monde', () => {
  const w = world(); const { raw } = api(w);
  w.props = { SESSION_DAYS: '2' };
  const s = login(raw).data;
  assert.equal(s.expiresAt - s.issuedAt, 2 * 86400000);
  w.now += 2 * 86400000 - 1000;
  assert.equal(raw.get({ action: 'session', session: s.session }).ok, true);
  w.now += 2000;
  assert.equal(raw.get({ action: 'session', session: s.session }).error.code, 'SESSION_EXPIRED');

  const w2 = world(); const r2 = api(w2).raw;
  const s2 = login(r2).data.session;
  w2.props = { SESSION_EPOCH: '2' };
  assert.equal(r2.get({ action: 'session', session: s2 }).error.code, 'SESSION_EXPIRED');
  assert.equal(login(r2).ok, true, 'se reconnecter avec la nouvelle époque fonctionne');
  assert.equal(r2.get({ action: 'session', session: login(r2).data.session }).ok, true);
});

test('la clé de signature est créée une fois, puis conservée ; une autre clé invalide les sessions', () => {
  const w = world();
  assert.equal(w.stored.SESSION_SECRET, undefined);
  const { raw } = api(w);                                            // première connexion → la clé est créée
  const s = login(raw).data.session;
  const key = w.stored.SESSION_SECRET;
  assert.ok(key && key.length >= 64);
  login(raw, { clientId: 'dev-9' });
  assert.equal(w.stored.SESSION_SECRET, key);
  w.stored.SESSION_SECRET = 'autre-cle-' + 'x'.repeat(60);
  // (le cache d'exécution du simulateur est par appel de doGet : l'exécution suivante relit la propriété)
  run(w.ctx, 'SESSION_SECRET_CACHE_ = null');
  assert.equal(raw.get({ action: 'session', session: s }).error.code, 'UNAUTHORIZED');
});

test('niveaux : authorize_ refuse un niveau insuffisant', () => {
  const w = world(); const { raw } = api(w);
  const tech = login(raw).data.session;
  const sup = login(raw, { password: PW_SUPPORT }).data.session;
  const call = (s, min) => run(w.ctx, `(function(){ try { authorize_(${JSON.stringify(s)}, ${JSON.stringify(min)}); return 'ok' } catch (e) { return e.code } })()`);
  assert.equal(call(tech, 'tech'), 'ok');
  assert.equal(call(tech, 'support'), 'FORBIDDEN_ROLE');
  assert.equal(call(sup, 'tech'), 'ok');
  assert.equal(call(sup, 'support'), 'ok');
});

test('les réponses n’exposent jamais les mots de passe ni la clé', () => {
  const w = world(); const { raw } = api(w);
  const all = JSON.stringify([login(raw), login(raw, { password: 'x' }), raw.get({ action: 'session', session: 'v1.a.b' })]);
  assert.ok(!all.includes(PW_TECH) && !all.includes(PW_SUPPORT) && !all.includes(w.stored.SESSION_SECRET));
});
