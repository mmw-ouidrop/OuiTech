// Pièces jointes d'un CR : photos (HEIC compris), PDF, vidéos. 20 Mo maximum par fichier
// (limite de l'API fichiers de Notion).
import { prepareImage } from './image.js'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const ACCEPT = 'image/*,.heic,.heif,application/pdf,.pdf,video/*'

const HEIC_RE = /\.(heic|heif)$/i
const EXT_MIME = { pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', '3gp': 'video/3gpp' }

export function sizeLabel(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`
}

export function kindOf(mime = '', name = '') {
  if (/^image\//.test(mime)) return 'image'
  if (/^video\//.test(mime)) return 'video'
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  return 'file'
}

function mimeOf(file) {
  if (file.type) return file.type
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return EXT_MIME[ext] || ''
}

function fail(code, message) { return Object.assign(new Error(message), { code }) }

// HEIC : d'abord le décodeur du navigateur (Safari/iOS), sinon conversion JS à la demande.
async function imageToJpeg(file) {
  try {
    return await prepareImage(file)
  } catch (e) {
    if (!(HEIC_RE.test(file.name) || /hei[cf]/i.test(file.type))) throw e
  }
  let out
  try {
    const { default: heic2any } = await import('heic2any')
    out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })
  } catch {
    throw fail('IMAGE_UNSUPPORTED', `« ${file.name} » : conversion HEIC impossible sur cet appareil (réessayez avec un réseau, ou prenez la photo en JPEG).`)
  }
  return prepareImage(Array.isArray(out) ? out[0] : out)
}

// → { blob, fileName }. Lève une Error au message lisible si le fichier est refusé.
export async function prepareAttachment(file, fieldId, now = Date.now) {
  const mime = mimeOf(file)
  const kind = kindOf(mime, file.name)
  const isHeic = HEIC_RE.test(file.name) || /hei[cf]/i.test(mime)
  if (kind === 'image' || isHeic) {
    if (file.size > MAX_FILE_BYTES) throw fail('TOO_LARGE', `« ${file.name} » dépasse 20 Mo (${sizeLabel(file.size)}).`)
    return { blob: await imageToJpeg(file), fileName: `${fieldId}-${now()}.jpg` }
  }
  if (kind !== 'pdf' && kind !== 'video') throw fail('UNSUPPORTED_TYPE', `« ${file.name} » : seuls les photos, PDF et vidéos sont acceptés.`)
  if (file.size > MAX_FILE_BYTES) throw fail('TOO_LARGE', `« ${file.name} » dépasse 20 Mo (${sizeLabel(file.size)}). Raccourcissez la vidéo ou compressez le fichier.`)
  const blob = file.type ? file : new Blob([file], { type: mime })
  return { blob, fileName: file.name }
}
