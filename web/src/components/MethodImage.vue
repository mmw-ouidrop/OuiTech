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
let objectUrl = ''

function release() {
  if (objectUrl && typeof URL !== 'undefined') URL.revokeObjectURL(objectUrl)
  objectUrl = ''
}

async function load() {
  status.value = 'loading'
  const r = await (props.service || methods).getMedia(props.pageId, props.mediaKey)
  if (r.blob) {
    release()
    objectUrl = URL.createObjectURL(r.blob)
    src.value = objectUrl
    status.value = 'ok'
  } else if (r.tooLarge) {
    bigUrl.value = r.url
    status.value = 'big'
  } else {
    status.value = r.error === 'OFFLINE' ? 'offline' : 'error'
  }
}

onMounted(load)
onBeforeUnmount(release)
// De retour en ligne : une image qui manquait est retentée.
watch(online, (on) => { if (on && (status.value === 'offline' || status.value === 'error')) load() })
</script>

<template>
  <figure class="mimg" :class="{ 'mimg--hero': hero }">
    <button v-if="status === 'ok'" type="button" class="mimg__btn" :aria-label="caption ? 'Agrandir : ' + caption : 'Agrandir l’image'" @click="zoom = true">
      <img :src="src" :alt="caption" loading="lazy" />
    </button>
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
.mimg__btn { display: block; width: 100%; padding: 0; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--surface-2); cursor: zoom-in; }
.mimg img { display: block; width: 100%; height: auto; max-height: 70vh; object-fit: contain; }
.mimg--hero .mimg__btn { border-radius: var(--radius); }
.mimg__ph { padding: var(--s-4); border: 1px dashed var(--line-strong); border-radius: var(--radius); color: var(--text-muted); text-align: center; }
.mimg__ph a, .linkish { color: var(--accent); text-decoration: underline; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; }
.zoom { position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.92); display: grid; place-items: center; padding: var(--s-3); }
.zoom img { max-width: 100%; max-height: 100%; object-fit: contain; }
.zoom__close { position: absolute; top: var(--s-3); right: var(--s-3); width: var(--tap); height: var(--tap); border-radius: 999px; border: 0; font-size: 28px; line-height: 1; background: #fff; color: #000; cursor: pointer; }
</style>
