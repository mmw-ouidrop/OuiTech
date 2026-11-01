<script setup>
// Fichiers d'un champ de la mission (colonne « Fichiers et médias » de Notion) : petits carrés cliquables.
//  · photo / vidéo : s'ouvre dans une fenêtre d'aperçu (flèches pour passer au suivant) ;
//  · PDF et autres fichiers : s'ouvrent dans un nouvel onglet ;
//  · les miniatures sont gardées sur l'appareil (lisibles hors ligne) ; une vidéo se lit en ligne.
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { missionMedia } from '../lib/methodsApp.js'
import { embedUrl } from '../lib/methods.js'
import { online } from '../lib/online.js'

const props = defineProps({
  pageId: { type: String, required: true },
  files: { type: Array, required: true },     // [{ key, name, kind: 'image'|'video'|'pdf'|'file', url? }]
  service: { type: Object, default: null }
})
const svc = computed(() => props.service || missionMedia)
const MAX_THUMBS = 24

const thumbs = reactive({})          // clé → adresse de la miniature (copie locale ou lien externe)
const failed = reactive({})          // clé → motif : miniature indisponible
const viewer = ref(-1)               // rang dans `previewable` ; -1 = fenêtre fermée
const viewerUrl = ref('')
const viewerState = ref('')          // '' | loading | offline | error
const message = ref('')
const fallback = ref(null)           // { url, name } : fenêtre bloquée par le navigateur, lien à toucher
const busyKey = ref('')
const closeBtn = ref(null)
let urls = []                        // adresses locales à libérer en quittant l'écran
let opener = null

const previewable = computed(() => props.files.filter((f) => f.kind === 'image' || f.kind === 'video'))
const current = computed(() => previewable.value[viewer.value] || null)
const embed = computed(() => (current.value && current.value.kind === 'video' && current.value.url ? embedUrl(current.value.url) : null))

const extOf = (name) => ((String(name).match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || '').toUpperCase()
const badge = (f) => (f.kind === 'video' ? 'VIDÉO' : f.kind === 'pdf' ? 'PDF' : extOf(f.name) || 'FICHIER')
const verb = (f) => (f.kind === 'image' ? 'Voir la photo' : f.kind === 'video' ? 'Voir la vidéo' : 'Ouvrir')

// Un type MIME absent ou générique rend parfois l'image illisible : on lui redonne un type d'image.
const asImage = (blob) => (blob.type && blob.type.startsWith('image/') ? blob : new Blob([blob], { type: 'image/jpeg' }))

// → { src } | { error: 'offline' | 'error' }
async function imageSrc(f) {
  if (thumbs[f.key]) return { src: thumbs[f.key] }
  if (f.url) return { src: f.url }
  const r = await svc.value.getMedia(props.pageId, f.key)
  if (r.blob) {
    const u = URL.createObjectURL(asImage(r.blob))
    urls.push(u)
    thumbs[f.key] = u
    return { src: u }
  }
  if (r.tooLarge) return { src: r.url }
  return { error: r.error === 'OFFLINE' ? 'offline' : 'error' }
}

async function loadThumbs() {
  for (const f of props.files.filter((x) => x.kind === 'image').slice(0, MAX_THUMBS)) {
    if (thumbs[f.key]) continue
    const r = await imageSrc(f)
    if (r.error) failed[f.key] = r.error
    else delete failed[f.key]
  }
}

async function show() {
  const f = current.value
  if (!f) return
  const at = viewer.value
  viewerUrl.value = ''
  viewerState.value = 'loading'
  let url = ''
  let err = ''
  if (f.kind === 'image') {
    const r = await imageSrc(f)
    url = r.src || ''
    err = r.error || ''
  } else if (f.url) {
    url = f.url
  } else {
    const r = await svc.value.getFreshUrl(props.pageId, f.key)
    url = r.url || ''
    err = r.error === 'OFFLINE' ? 'offline' : 'error'
  }
  if (at !== viewer.value) return                  // on est passé à un autre fichier entre-temps
  viewerUrl.value = url
  viewerState.value = url ? '' : err || 'error'
}

function openViewer(f) {
  opener = document.activeElement
  viewer.value = previewable.value.indexOf(f)
  return show()
}
function close() {
  viewer.value = -1
  viewerUrl.value = ''
  if (opener && opener.focus) opener.focus({ preventScroll: true })
}
function step(delta) {
  const n = previewable.value.length
  if (n < 2) return
  viewer.value = (viewer.value + delta + n) % n
  show()
}

// PDF et autres fichiers : l'onglet est ouvert tout de suite (geste de l'utilisateur, sinon le navigateur le bloque),
// puis dirigé vers le fichier une fois récupéré.
async function openTab(f) {
  if (f.url) { window.open(f.url, '_blank', 'noopener'); return }
  busyKey.value = f.key
  const w = window.open('', '_blank')
  try {
    const r = await svc.value.getMedia(props.pageId, f.key)
    let url = ''
    if (r.blob) {
      url = URL.createObjectURL(f.kind === 'pdf' ? new Blob([r.blob], { type: 'application/pdf' }) : r.blob)
      setTimeout(() => URL.revokeObjectURL(url), 600000)
    } else if (r.tooLarge) {
      url = r.url
    }
    if (!url) {
      if (w) w.close()
      message.value = r.error === 'OFFLINE' ? 'Fichier non disponible hors ligne.' : 'Fichier indisponible pour le moment.'
    } else if (w) {
      w.location.href = url
    } else {
      fallback.value = { url, name: f.name }
    }
  } finally {
    busyKey.value = ''
  }
}

function open(f) {
  message.value = ''
  fallback.value = null
  if (f.kind === 'image' || f.kind === 'video') return openViewer(f)
  return openTab(f)
}

function onKey(e) {
  if (!current.value) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}

watch(current, async (c, old) => {
  if (c && !old) { await nextTick(); closeBtn.value && closeBtn.value.focus() }
})
watch(online, (on) => { if (on) loadThumbs() })      // de retour en ligne : les miniatures manquantes sont retentées
onMounted(() => { window.addEventListener('keydown', onKey); loadThumbs() })
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  urls.forEach((u) => URL.revokeObjectURL(u))
  urls = []
})
</script>

<template>
  <div class="ft">
    <ul class="ft__grid">
      <li v-for="f in files" :key="f.key" class="ft__item">
        <button type="button" class="ft__tile" :class="'ft__tile--' + f.kind" :disabled="busyKey === f.key" :aria-label="verb(f) + ' : ' + f.name" :title="f.name" @click="open(f)">
          <img v-if="f.kind === 'image' && thumbs[f.key] && failed[f.key] !== 'broken'" class="ft__img" :src="thumbs[f.key]" alt="" @error="failed[f.key] = 'broken'" />
          <template v-else>
            <svg v-if="f.kind === 'video'" class="ft__ico" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" /><path d="M10 8.5v7l6-3.5z" fill="currentColor" /></svg>
            <svg v-else-if="f.kind === 'image'" class="ft__ico" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2" /><circle cx="9" cy="10" r="1.8" fill="currentColor" /><path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
            <svg v-else class="ft__ico" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M6 3h8l5 5v13H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
            <span class="ft__badge">{{ busyKey === f.key ? '…' : badge(f) }}</span>
          </template>
        </button>
        <span class="ft__name small">{{ f.name }}</span>
      </li>
    </ul>
    <p v-if="message" class="small muted ft__msg" role="status">{{ message }}</p>
    <p v-if="fallback" class="small ft__msg" role="status">Votre navigateur a bloqué la fenêtre : <a :href="fallback.url" target="_blank" rel="noopener noreferrer">ouvrir {{ fallback.name }}</a></p>

    <Teleport to="body">
      <div v-if="current" class="vw" role="dialog" aria-modal="true" :aria-label="current.name" @click.self="close">
        <header class="vw__bar" @click.self="close">
          <span class="vw__title">{{ current.name }}<span v-if="previewable.length > 1" class="vw__count"> · {{ viewer + 1 }}/{{ previewable.length }}</span></span>
          <button ref="closeBtn" type="button" class="vw__btn" aria-label="Fermer l’aperçu" @click="close">×</button>
        </header>
        <div class="vw__body" @click.self="close">
          <p v-if="viewerState === 'loading'" class="vw__msg" role="status">Chargement…</p>
          <p v-else-if="viewerState === 'offline'" class="vw__msg" role="alert">{{ current.kind === 'video' ? 'Les vidéos demandent du réseau.' : 'Photo non disponible hors ligne.' }}</p>
          <p v-else-if="viewerState" class="vw__msg" role="alert">Fichier indisponible pour le moment.</p>
          <template v-else-if="current.kind === 'image'">
            <img :src="viewerUrl" :alt="current.name" class="vw__img" />
          </template>
          <iframe v-else-if="embed" :src="embed" class="vw__video" title="Vidéo" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
          <video v-else :src="viewerUrl" class="vw__video" controls playsinline autoplay></video>
        </div>
        <footer v-if="previewable.length > 1" class="vw__nav">
          <button type="button" class="vw__btn" aria-label="Précédent" @click="step(-1)">‹</button>
          <button type="button" class="vw__btn" aria-label="Suivant" @click="step(1)">›</button>
        </footer>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ft__grid { list-style: none; display: flex; flex-wrap: wrap; gap: var(--s-3); margin: 0; padding: 0; }
.ft__item { width: 88px; }
.ft__tile {
  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  width: 88px; height: 88px; padding: 0; overflow: hidden;
  border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface-2); color: var(--accent); cursor: pointer;
}
.ft__tile:hover:not(:disabled) { border-color: var(--accent); }
.ft__tile:disabled { opacity: .6; cursor: progress; }
.ft__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ft__badge { font: 700 12px/1 var(--f-display); letter-spacing: .04em; color: var(--heading); text-transform: uppercase; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ft__name { margin-top: 4px; color: var(--text-muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; line-height: 1.25; }
.ft__msg { margin: var(--s-2) 0 0; }

.vw { position: fixed; inset: 0; z-index: 200; background: rgba(0, 0, 0, 0.94); color: #fff; }
.vw__bar { position: absolute; top: 0; left: 0; right: 0; height: 56px; display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: 0 var(--s-3); }
.vw__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.vw__count { font-weight: 400; opacity: .8; }
.vw__body { position: absolute; top: 56px; bottom: 64px; left: 0; right: 0; display: grid; place-items: center; padding: 0 var(--s-2); }
.vw__img { max-width: 100%; max-height: 100%; object-fit: contain; }
.vw__video { width: 100%; max-height: 100%; aspect-ratio: 16 / 9; border: 0; background: #000; }
.vw__msg { margin: 0; padding: var(--s-4); text-align: center; }
.vw__nav { position: absolute; bottom: 0; left: 0; right: 0; height: 64px; display: flex; align-items: center; justify-content: center; gap: var(--s-5); }
.vw__btn { width: var(--tap); height: var(--tap); border-radius: 999px; border: 0; background: #fff; color: #000; font-size: 28px; line-height: 1; cursor: pointer; }
.vw__btn:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
</style>
