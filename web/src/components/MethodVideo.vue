<script setup>
// Vidéo d'une fiche : lecteur intégré pour YouTube / Vimeo / Loom, sinon lien ; fichier hébergé par Notion : lien frais à la demande.
import { ref, computed, watch } from 'vue'
import { methods } from '../lib/methodsApp.js'
import { embedUrl } from '../lib/methods.js'
import { online } from '../lib/online.js'

const props = defineProps({
  pageId: { type: String, required: true },
  url: { type: String, default: '' },        // vidéo d'un service externe
  mediaKey: { type: String, default: '' },   // vidéo hébergée par Notion
  caption: { type: String, default: '' },
  active: { type: Boolean, default: true }     // faux : diapositive non affichée d'un carrousel (le lecteur s'arrête)
})

const embed = computed(() => (props.url ? embedUrl(props.url) : null))
const fileUrl = ref('')
const busy = ref(false)
const message = ref('')
const player = ref(null)
watch(() => props.active, (a) => { if (!a && player.value) player.value.pause() })

async function loadFile() {
  message.value = ''
  busy.value = true
  const r = await methods.getFreshUrl(props.pageId, props.mediaKey)
  busy.value = false
  if (r.url) fileUrl.value = r.url
  else message.value = r.error === 'OFFLINE' ? 'Les vidéos demandent du réseau.' : 'Vidéo indisponible pour le moment.'
}
</script>

<template>
  <figure class="mvid">
    <template v-if="embed">
      <div v-if="!active" class="mvid__ph">Vidéo en pause.</div>
      <iframe v-else-if="online" :src="embed" title="Vidéo" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
      <p v-else class="mvid__ph">Les vidéos demandent du réseau.</p>
    </template>
    <p v-else-if="url" class="mvid__ph"><a :href="url" target="_blank" rel="noopener noreferrer">Voir la vidéo</a></p>
    <template v-else>
      <video v-if="fileUrl" ref="player" :src="fileUrl" controls playsinline preload="metadata"></video>
      <div v-else class="mvid__ph">
        <button type="button" class="btn" :disabled="busy" @click="loadFile">{{ busy ? 'Chargement…' : 'Lire la vidéo' }}</button>
        <p v-if="message" class="small muted" role="status">{{ message }}</p>
      </div>
    </template>
    <figcaption v-if="caption" class="small muted">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.mvid { margin: var(--s-3) 0; }
.mvid iframe, .mvid video { display: block; width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: var(--radius); background: #000; }
.mvid__ph { padding: var(--s-4); border: 1px dashed var(--line-strong); border-radius: var(--radius); text-align: center; color: var(--text-muted); }
.mvid__ph a { color: var(--accent); text-decoration: underline; }
</style>
