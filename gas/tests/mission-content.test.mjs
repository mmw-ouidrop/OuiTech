// Images, vidéos, fichiers, liens et blocs HTML posés dans le contenu d'une page de mission (Code.gs).
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeWorld, run, api, PAGE, PNG_B64 } from './fake-notion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['Code.gs', 'Report.gs', 'Auth.gs', 'Methods.gs'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));

function setup() {
  const w = makeWorld(); SRC.forEach((s) => run(w.ctx, s));
  const rt = w.rt;
  w.addFile('https://files.test/schema.png', [137, 80, 78, 71]);
  w.addFile('https://files.test/notice.pdf', [37, 80, 68, 70], 'application/pdf');
  w.childrenOf(PAGE).forEach((b) => { b.archived = true; });
  w.seedChildren(PAGE, [
    { type: 'heading_1', heading_1: { rich_text: rt('Avant de commencer') } },
    { type: 'image', image: { type: 'file', file: { url: 'https://files.test/schema.png' }, caption: rt('Schéma de la borne') } },
    { type: 'file', file: { type: 'file', file: { url: 'https://files.test/notice.pdf' }, name: 'Notice.pdf' } },
    { type: 'video', video: { type: 'external', external: { url: 'https://youtu.be/abcdefghijk' }, caption: rt('Tuto') } },
    { type: 'image', image: { type: 'external', external: { url: 'http://insecure.test/a.png' } } },
    { type: 'bookmark', bookmark: { url: 'https://ouidrop.eu/doc', caption: rt('Documentation') } },
    { type: 'code', code: { language: 'html', rich_text: rt('<div style="color:red"><b>Attention</b> 230 V</div>') } },
    { type: 'code', code: { language: 'javascript', rich_text: rt('alert(1)') } }
  ]);
  return w;
}

test('le contenu de la page : images, vidéos, fichiers, liens et HTML sont lus dans l’ordre', () => {
  const w = setup(); const { get } = api(w);
  const r = get({ action: 'getIntervention', id: 'FI-252' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const tb = r.data.templateBlocks;
  assert.deepEqual(tb.map((b) => b.kind), ['section', 'media', 'media', 'media', 'link', 'html']);
  const [, img, pdf, vid, link, html] = tb;
  assert.deepEqual([img.type, img.caption, img.url], ['image', 'Schéma de la borne', undefined]);
  assert.deepEqual([pdf.type, pdf.name], ['file', 'Notice.pdf']);
  assert.deepEqual([vid.type, vid.url], ['video', 'https://youtu.be/abcdefghijk']);
  assert.deepEqual([link.url, link.text], ['https://ouidrop.eu/doc', 'Documentation']);
  assert.match(html.html, /Attention/);
  assert.equal(JSON.stringify(r.data.schema).includes('media'), false, 'ces blocs ne sont pas des champs du rapport');
});

test('missionMedia : fichier hébergé servi en base64, lien frais, blocs étrangers refusés', () => {
  const w = setup(); const { get } = api(w);
  const tb = get({ action: 'getIntervention', id: 'FI-252' }).data.templateBlocks;
  const img = tb.find((b) => b.kind === 'media' && b.type === 'image');
  const ok = get({ action: 'missionMedia', page: PAGE, key: img.blockId });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.mime, 'image/png');
  const fresh = get({ action: 'missionMedia', page: PAGE, key: img.blockId, mode: 'url' });
  assert.equal(fresh.data.url, 'https://files.test/schema.png');
  assert.equal(get({ action: 'missionMedia', page: PAGE, key: 'p:Medias:0' }).error.code, 'BAD_REQUEST');
  assert.equal(get({ action: 'missionMedia', page: 'zz', key: img.blockId }).error.code, 'BAD_REQUEST');
  const m = w.addMethod({ title: 'Autre base' });
  assert.equal(get({ action: 'missionMedia', page: m.nid, key: img.blockId }).error.code, 'NOT_FOUND');
  const head = tb.find((b) => b.kind === 'section');
  assert.equal(get({ action: 'missionMedia', page: PAGE, key: head.blockId }).error.code, 'NOT_FOUND');
});
