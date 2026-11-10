import test from 'node:test'
import assert from 'node:assert/strict'
import { kindOf, prepareAttachment, MAX_FILE_BYTES, sizeLabel } from '../src/lib/attachments.js'
import { buildReport } from '../src/lib/reportPdf.js'

test('kindOf', () => {
  assert.equal(kindOf('image/heic', 'a.heic'), 'image')
  assert.equal(kindOf('video/mp4', 'a.mp4'), 'video')
  assert.equal(kindOf('', 'plan.PDF'), 'pdf')
  assert.equal(kindOf('application/zip', 'a.zip'), 'file')
})

test('prepareAttachment : PDF et vidéo gardés tels quels, refus au-delà de 20 Mo ou type inconnu', async () => {
  const pdf = new File(['%PDF'], 'rapport.pdf', { type: 'application/pdf' })
  const r = await prepareAttachment(pdf, 'f1')
  assert.equal(r.fileName, 'rapport.pdf')
  assert.equal(r.blob.type, 'application/pdf')
  const mov = new File(['x'], 'film.mov', { type: '' })
  assert.equal((await prepareAttachment(mov, 'f1')).blob.type, 'video/quicktime')
  const big = { name: 'gros.mp4', type: 'video/mp4', size: MAX_FILE_BYTES + 1 }
  await assert.rejects(prepareAttachment(big, 'f1'), (e) => e.code === 'TOO_LARGE' && /20 Mo/.test(e.message))
  await assert.rejects(prepareAttachment(new File(['x'], 'a.zip', { type: 'application/zip' }), 'f1'), (e) => e.code === 'UNSUPPORTED_TYPE')
  assert.equal(sizeLabel(1572864), '1,5 Mo')
})

test('buildReport : sections, valeurs, photos et fichiers listés', () => {
  const rec = {
    reference: 'FI-1', title: 'Test', readOnlyData: [{ label: 'Client', type: 'text', value: 'ACME' }, { label: 'Vide', type: 'text', value: '' }],
    templateBlocks: [
      { kind: 'section', blockId: 's1', level: 1, text: 'NAV' },
      { kind: 'component', blockId: 'c1', id: 'etat', type: 'text', label: 'État' },
      { kind: 'component', blockId: 'c2', id: 'photo', type: 'image_upload', label: 'Photos' }
    ],
    fields: { etat: { v: 'Neuf', at: 1 } }, custom: {}, shared: { photos: { photo: [{ mediaId: 'zz', by: 'x', at: 1 }] } }
  }
  const rows = [
    { mediaId: 'a', blockId: 'photo', mimeType: 'image/jpeg', fileName: 'a.jpg', size: 10, uploadStatus: 'queued' },
    { mediaId: 'b', blockId: 'photo', mimeType: 'video/mp4', fileName: 'v.mp4', size: 3 * 1024 * 1024, uploadStatus: 'done' }
  ]
  const rep = buildReport(rec, rows)
  assert.equal(rep.props.length, 1)
  const sec = rep.sections.find((s) => s.text === 'NAV')
  assert.equal(sec.fields[0].text, 'Neuf')
  assert.equal(sec.fields[1].photos.length, 2)
  assert.equal(sec.fields[1].remote, 1)
})
