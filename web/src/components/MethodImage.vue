<script setup>
// Image d'une fiche méthode : gardée sur l'appareil (lisible hors ligne), agrandissable.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { methods } from '../lib/methodsApp.js'
import { online } from '../lib/online.js'

const props = defineProps({
  pageId: { type: String, required: true },
  mediaKey: { type: String, required: true },
  caption: { type: String, default: '' },
  hero: { type: Boolean, default: false },
  service: { type: Object, default: null }      // catalogue d'origine (méthodes par défaut ; machines pour les photos de site)
})

const src = ref('')
const status = ref('loading')       // loading | ok | offline | big | error
const bigUrl = ref('')
const zoom = ref(false)
const broken = ref(false)          // l'image est arrivée mais le navigateur ne sait pas l'afficher (HEIC, fichier abîmé…)
let objectUrl = ''

function release() {
  if (objectUrl && typeof URL !== 'undefined') URL.revokeObjectURL(objectUrl)
  objectUrl = ''
}

// Un type MIME absent ou générique (« octet-stream ») rend parfois l'image illisible : on lui redonne un type d'image.
function asImage(blob) {
  if (blob.type && blob.type.startsWith('image/')) return blob
  return new Blob([blob], { type: 'image/jpeg' })
}

async function load() {
  status.value = 'loading'
  broken.value = false
  const r = await (props.service || methods).getMedia(props.pageId, props.mediaKey)
  if (r.blob) {
    release()
    objectUrl = URL.createObjectURL(asImage(r.blob))
    src.value = objectUrl
    status.value = 'ok'
  } else if (r.tooLarge) {
    bigUrl.value = r.url
    status.value = 'big'
  } else {
    status.value = r.error === 'OFFLINE' ? 'offline' : 'error'
  }
}

// Dernier recours : le fichier lui-même, dans un nouvel onglet.
function openRaw() {
  if (src.value) window.open(src.value, '_blank', 'noopener')
}

onMounted(load)
onBeforeUnmount(release)
// De retour en ligne : une image qui manquait est retentée.
watch(online, (on) => { if (on && (status.value === 'offline' || status.value === 'error')) load() })
</script>

<template>
  <figure class="mimg" :class="{ 'mimg--hero': hero }">
    <div v-if="status === 'ok' && !broken" class="mimg__frame">
      <!-- L'image n'est PAS dans un <button> et n'est pas « lazy » : l'image dicte sa hauteur (pas de hauteur nulle). -->
      <img :src="src" :alt="caption" decoding="async" @error="broken = true" />
      <button type="button" class="mimg__zoom" :aria-label="caption ? 'Agrandir : ' + caption : 'Agrandir l’image'" @click="zoom = true"></button>
    </div>
    <div v-else-if="status === 'ok'" class="mimg__ph" role="alert">
      Cette image ne peut pas être affichée ici (format non pris en charge).
      <button type="button" class="linkish" @click="openRaw">Ouvrir le fichier</button>
    </div>
    <div v-else-if="status === 'loading'" class="mimg__ph" role="status">Chargement de l’image…</div>
    <div v-else-if="status === 'big'" class="mimg__ph">
      <a :href="bigUrl" target="_blank" rel="noopener noreferrer">Ouvrir l’image (volumineuse)</a>
    </div>
    <div v-else class="mimg__ph">
      <template v-if="status === 'offline'">Image non disponible hors ligne.</template>
      <template v-else>Image indisponible. <button type="button" class="linkish" @click="load">Réessayer</button></template>
    </div>
    <figcaption v-if="caption" class="small muted">{{ caption }}</figcaption>

    <div v-if="zoom" class="zoom" role="dialog" aria-modal="true" aria-label="Image agrandie" @click="zoom = false">
      <img :src="src" :alt="caption" />
      <button type="button" class="zoom__close" aria-label="Fermer" @click.stop="zoom = false">×</button>
    </div>
  </figure>
</template>

<style scoped>
.mimg { margin: var(--s-3) 0; }
.mimg__frame { position: relative; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--surface-2); min-height: 80px; }
.mimg__frame img { display: block; width: 100%; height: auto; min-height: 80px; max-height: 70vh; object-fit: contain; }
.mimg__zoom { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.mimg__zoom:focus-visible { outline: 3px solid var(--ring); outline-offset: -3px; }
.mimg__ph { padding: var(--s-4); border: 1px dashed var(--line-strong); border-radius: var(--radius); color: var(--text-muted); text-align: center; }
.mimg__ph a, .linkish { color: var(--accent); text-decoration: underline; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; }
.zoom { position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.92); display: grid; place-items: center; padding: var(--s-3); }
.zoom img { max-width: 100%; max-height: 100%; object-fit: contain; }
.zoom__close { position: absolute; top: var(--s-3); right: var(--s-3); width: var(--tap); height: var(--tap); border-radius: 999px; border: 0; font-size: 28px; line-height: 1; background: #fff; color: #000; cursor: pointer; }
</style>
