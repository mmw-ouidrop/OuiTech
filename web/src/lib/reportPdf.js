// Données du compte rendu imprimable (PDF) : fonction pure, testée.
import { buildItems, fieldValue } from './shared.js'
import { formatFieldValue, formatPropertyValue, isEmptyProperty } from './format.js'
import { kindOf, sizeLabel } from './attachments.js'
import { stateLabel, currentState } from './actions.js'

// → { sections: [{ id, level, text, fields: [...] }] } ; les champs hors section sont dans une section sans titre.
// field : { id, label, type, text, photos: [{ mediaId, kind, fileName, size, row? }], remote: n }
export function buildReport(rec, rows = []) {
  const byField = {}
  for (const r of rows) if (r.uploadStatus !== 'failed') (byField[r.blockId] = byField[r.blockId] || []).push(r)
  const shared = (rec.shared && rec.shared.photos) || {}

  const sections = []
  let cur = { id: '', level: 0, text: '', fields: [] }
  sections.push(cur)
  for (const it of buildItems(rec)) {
    if (it.k === 'section') {
      cur = { id: it.id, level: it.level, text: it.text, fields: [] }
      sections.push(cur)
    } else if (it.k === 'field') {
      const mine = byField[it.id] || []
      const mineIds = new Set(mine.map((r) => r.mediaId))
      const files = mine.map((r) => ({ mediaId: r.mediaId, kind: kindOf(r.mimeType, r.fileName), fileName: r.fileName, size: r.size, row: r }))
      const remote = (shared[it.id] || []).filter((p) => !mineIds.has(p.mediaId)).length
      const isPhoto = it.type === 'image_upload'
      cur.fields.push({
        id: it.id, label: it.label || it.id, type: it.type,
        text: isPhoto ? '' : formatFieldValue(fieldValue(rec, it.id)),
        empty: isPhoto ? !files.length && !remote : (formatFieldValue(fieldValue(rec, it.id)) === '—'),
        photos: files, remote
      })
    }
  }
  return {
    reference: rec.reference,
    title: rec.title || rec.reference,
    props: (rec.readOnlyData || []).filter((p) => !isEmptyProperty(p)).map((p) => ({ label: p.label, text: formatPropertyValue(p) })),
    actions: (rec.actions || []).map((a) => {
      const log = (rec.actionLog && rec.actionLog[a.id]) || []
      return { id: a.id, title: a.title, type: a.type, time: a.time, state: stateLabel(currentState(log)) || 'Sans état', entries: log.map((e) => ({ state: stateLabel(e.state), text: e.text, by: e.by, at: e.at })) }
    }),
    sections: sections.filter((s) => s.text || s.fields.length)
  }
}

export const fileLine = (f) => `${f.kind === 'video' ? 'Vidéo' : f.kind === 'pdf' ? 'PDF' : 'Fichier'} : ${f.fileName}${f.size ? ' (' + sizeLabel(f.size) + ')' : ''}`
