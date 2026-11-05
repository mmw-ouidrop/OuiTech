// ============================================================================
//  Dictée vocale des champs du CR (API Web Speech du navigateur).
//  · Chrome / Edge / Android et Safari (iOS ≥ 14.5) : disponible, mais la reconnaissance passe par le service vocal du
//    navigateur (Google, Apple) : il faut du réseau. Firefox : non pris en charge → le bouton micro n'apparaît pas.
//  · Un seul micro à la fois. Écoute continue : le technicien touche le micro, parle, dit « stop » ou « champ suivant ».
//  Les fonctions de texte sont pures (testées seules) ; `createDictation` est le seul code qui touche au navigateur.
// ============================================================================

const Recognition = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
export const dictationSupported = () => !!Recognition()

const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()

// Ordres vocaux : seulement quand TOUTE la phrase dite est l'ordre (un mot dans une phrase reste du texte).
const NEXT = ['suivant', 'champ suivant', 'passe au suivant', 'passer au suivant', 'au suivant']
const STOP = ['stop', 'arrete', 'arreter', 'arrete la dictee', 'termine', 'fin de la dictee', 'fin dictee', 'dictee terminee']
export function spokenCommand(text) {
  const t = strip(text)
  if (NEXT.includes(t)) return 'next'
  if (STOP.includes(t)) return 'stop'
  return null
}

// Ponctuation et retours à la ligne dits à voix haute (les accents ne comptent pas comme limites de mot).
const W = (words) => new RegExp(`(?<![\\p{L}\\d])(?:${words})(?![\\p{L}\\d])`, 'giu')
const MARKS = [
  [W('nouvelle ligne|à la ligne|retour à la ligne'), '\n'],
  [W('point d[\'’]interrogation'), '?'],
  [W('point d[\'’]exclamation'), '!'],
  [W('point final'), '.'],
  [W('deux[- ]points'), ':'],
  [W('point[- ]virgule'), ';'],
  [W('virgule'), ',']
]
export function cleanSpoken(text) {
  let t = String(text || '').trim()
  for (const [re, mark] of MARKS) t = t.replace(re, ` ${mark} `)
  return t
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]+([,.;:?!])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[,.;:?!\s]+(?=\S)/, (m) => (m.includes('\n') ? '\n' : ''))
    .trim()
}

// Ajoute `addition` à la fin de `current` avec le bon espacement (jamais d'espace avant une ponctuation ou après un retour à la ligne).
export function mergeText(current, addition) {
  const add = String(addition || '')
  if (!add) return String(current || '')
  const cur = String(current ?? '')
  if (!cur || /[\s\n]$/.test(cur) || /^[\n,.;:?!]/.test(add)) return cur + add
  return cur + ' ' + add
}

// Un nombre dit à voix haute : « douze virgule cinq » (le navigateur renvoie le plus souvent « 12,5 ») → 12.5 ; sinon null.
const WORDS = { zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 }
const NUMBER_WORDS = new RegExp(`\\b(?:${Object.keys(WORDS).join('|')})(?:\\s+(?:${Object.keys(WORDS).join('|')}))*\\b`, 'g')
export function numberFromSpeech(text) {
  let t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  t = t.replace(/\bmoins\b/g, '-').replace(/\bvirgule\b/g, ',').replace(/\bpoint\b/g, '.')
  t = t.replace(NUMBER_WORDS, (run) => String(run.split(/\s+/).reduce((sum, w) => sum + WORDS[w], 0)))
  t = t.replace(/\s*([,.])\s*(?=\d)/g, '$1').replace(/(\d)\s+(?=\d{3}\b)/g, '$1').replace(/-\s+(?=\d)/, '-')
  const m = t.match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  const n = Number(m[0].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function describeError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed': return 'Micro non autorisé : autorisez-le dans les réglages du navigateur, ou utilisez le micro du clavier.'
    case 'audio-capture': return 'Aucun micro détecté.'
    case 'network': return 'La dictée demande du réseau. Hors ligne, utilisez le micro du clavier.'
    case 'language-not-supported': return 'La langue de dictée n’est pas disponible sur cet appareil.'
    default: return 'La dictée s’est arrêtée.'
  }
}

/* ───────────────────────────── Navigateur ───────────────────────────── */

let active = null                         // un seul micro à la fois : { stop() }

// onFinal(texte) : phrase reconnue ; onInterim(texte) : brouillon en cours ; onEnd(raison) : micro coupé ('stop' | 'command' | 'error' | 'ended') ;
// onError(code) ; onCommand('next' | 'stop').
export function createDictation({ lang = 'fr-FR', onFinal, onInterim, onEnd, onError, onCommand } = {}) {
  const Rec = Recognition()
  if (!Rec) return null
  let rec = null
  let running = false
  let quietRuns = 0                       // écoutes consécutives sans aucun mot : on s'arrête (batterie)
  let heard = false
  let wake = null

  const releaseWake = () => { try { wake && wake.release && wake.release() } catch { /* ignoré */ } wake = null }
  const keepAwake = async () => {
    try { wake = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null } catch { wake = null }
  }
  const finish = (reason) => {
    if (!running) return
    running = false
    releaseWake()
    if (active === handle) active = null
    onEnd && onEnd(reason)
  }

  function boot() {
    rec = new Rec()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    heard = false
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0] ? r[0].transcript : ''
        if (!r.isFinal) { interim += t; continue }
        heard = true
        const cmd = spokenCommand(t)
        if (cmd) { onInterim && onInterim(''); onCommand && onCommand(cmd); handle.stop(cmd === 'next' ? 'command' : 'stop'); return }
        const clean = cleanSpoken(t)
        if (clean) onFinal && onFinal(clean)
      }
      onInterim && onInterim(interim.trim())
    }
    rec.onerror = (e) => {
      const code = e && e.error
      if (code === 'no-speech' || code === 'aborted') return           // silence : onend relance ou arrête
      onError && onError(code)
      handle.stop('error')
    }
    rec.onend = () => {
      onInterim && onInterim('')
      if (!running) return
      quietRuns = heard ? 0 : quietRuns + 1
      if (quietRuns >= 3) return finish('ended')                        // trois silences de suite
      try { boot(); rec.start() } catch { finish('ended') }              // le navigateur coupe seul après un silence : on relance
    }
  }

  const handle = {
    start() {
      if (running) return true
      if (active) active.stop('stop')
      try {
        running = true
        quietRuns = 0
        boot()
        rec.start()
        active = handle
        keepAwake()
        return true
      } catch (e) {
        running = false
        onError && onError(e && e.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed')
        return false
      }
    },
    stop(reason = 'stop') {
      if (!running) return
      const r = rec
      try { r && r.stop() } catch { /* déjà arrêté */ }
      finish(reason)
    },
    get listening() { return running }
  }
  return handle
}

export function stopAllDictation() {
  if (active) active.stop('stop')
}

// Passe au champ dictable suivant (ordre de la page) et y lance la dictée ; renvoie false s'il n'y en a plus.
export function startNextDictation(fromEl, root = globalThis.document) {
  if (!root) return false
  const all = [...root.querySelectorAll('[data-dictation]')].filter((b) => !b.disabled && b.offsetParent !== null)
  const i = all.indexOf(fromEl)
  const next = i >= 0 ? all[i + 1] : null
  if (!next) return false
  next.scrollIntoView && next.scrollIntoView({ block: 'center', behavior: 'smooth' })
  setTimeout(() => next.click(), 250)
  return true
}
