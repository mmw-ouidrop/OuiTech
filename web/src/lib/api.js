// Client du middleware Google Apps Script (voir gas/Code.gs).
//
// Particularités GAS :
//  - GET sans en-tête personnalisé et POST en `text/plain` : ce sont des requêtes
//    « simples » qui évitent le preflight CORS (GAS ne répond pas aux OPTIONS) ;
//  - GAS répond toujours HTTP 200 ; le résultat est dans { ok, data | error }.
import { GAS_URL } from '../config.js'
import { getSession, reportAuthFailure, isRejectCode } from './auth.js'

export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.extra = extra
  }
}

async function request(url, init, timeoutMs) {
  if (!GAS_URL) {
    throw new ApiError('CONFIG', "L'application n'est pas configurée (VITE_GAS_URL).")
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, redirect: 'follow' })
  } catch (err) {
    throw new ApiError(
      ctrl.signal.aborted ? 'TIMEOUT' : 'NETWORK',
      ctrl.signal.aborted ? 'Le serveur met trop de temps à répondre.' : 'Pas de réseau.'
    )
  } finally {
    clearTimeout(timer)
  }

  let body
  let text = ''
  try {
    text = await res.text()
    body = JSON.parse(text)
  } catch {
    // Apps Script répond par une page HTML quand l'exécution est interrompue (durée max, quota,
    // autorisation manquante…) : on garde un extrait pour que l'erreur affichée permette de diagnostiquer.
    const kind = (res.headers && res.headers.get && res.headers.get('content-type')) || ''
    const extract = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    throw new ApiError('BAD_RESPONSE', `Réponse inattendue du serveur (HTTP ${res.status}${kind ? ', ' + kind.split(';')[0] : ''})${extract ? ' : ' + extract : ''}`)
  }
  if (!body || body.ok !== true) {
    const e = (body && body.error) || {}
    const { code, message, ...extra } = e
    // Le serveur refuse la session (expirée, révoquée) : on la retire et l'interface renvoie à la connexion.
    if (isRejectCode(code)) reportAuthFailure(code)
    throw new ApiError(code || 'SERVER', message || 'Erreur du serveur.', extra)
  }
  return body.data
}

const get = (params, timeoutMs = 30000) => {
  const q = new URLSearchParams({ ...params, session: getSession() })
  return request(`${GAS_URL}?${q}`, { method: 'GET' }, timeoutMs)
}

const post = (payload, timeoutMs) =>
  request(
    GAS_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ session: getSession(), ...payload })
    },
    timeoutMs
  )

export const api = {
  // Connexion : mot de passe + prénom/nom. Renvoie { session, role, issuedAt, expiresAt, serverNow }.
  login: ({ password, firstName, lastName, clientId }) => post({ action: 'login', password, firstName, lastName, clientId }, 30000),

  // La session est-elle toujours valable ? { role, expiresAt, serverNow }
  session: () => get({ action: 'session' }, 15000),

  getIntervention: (id) => get({ action: 'getIntervention', id }),

  // fileData : base64 sans préfixe. Renvoie { fileId, … }.
  uploadMedia: ({ fileData, fileName, mimeType, mediaId, reference }) =>
    post({ action: 'uploadMedia', fileData, fileName, mimeType, mediaId, reference }, 90000),

  // Relève légère des modifications des collègues (aucun appel à Notion tant que rien n'a bougé).
  getReport: ({ pageId, sinceRev, clientId, name }) =>
    get({ action: 'getReport', pageId, sinceRev: String(sinceRev ?? ''), clientId, name }, 20000),

  // Peut durer longtemps (transfert des photos vers Notion) : le GAS s'arrête à 6 min.
  syncReport: (payload) => post({ action: 'syncReport', ...payload }, 330000)
}
