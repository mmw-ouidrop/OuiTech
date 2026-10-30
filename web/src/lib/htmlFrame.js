// Document complet d'un bloc HTML de template, pour un iframe « sandbox » (sans accès à l'application).
// Aucune dépendance à Vue : testable seul.

// Pas de requêtes réseau (fetch, XHR, formulaires) ; images / médias / polices / cadres en https ou data seulement.
export const FRAME_CSP = [
  "default-src 'none'",
  "img-src https: data: blob:",
  "media-src https: data: blob:",
  "font-src https: data:",
  "style-src 'unsafe-inline' https:",
  "script-src 'unsafe-inline'",
  "frame-src https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

const BASE_CSS = ':root{color-scheme:light dark}html,body{margin:0;padding:0}body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}img,video,iframe,svg,table{max-width:100%}img,video{height:auto}'

// Le script envoie la hauteur du contenu au parent (le cadre n'a pas de défilement propre).
const RESIZE = '(function(){function s(){var h=Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0);parent.postMessage({type:"ouitech-height",h:h},"*")}addEventListener("load",s);addEventListener("resize",s);if(window.ResizeObserver){new ResizeObserver(s).observe(document.documentElement)}setInterval(s,1000);s()})();'

export function buildSrcdoc(html) {
  const body = String(html || '')
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">' +
    `<style>${BASE_CSS}</style></head><body>${body}<script>${RESIZE}</script></body></html>`
}
