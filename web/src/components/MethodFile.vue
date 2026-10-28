<script setup>
// Fichier d'une fiche (PDF « Support », pièce jointe) : ouvert depuis la copie de l'appareil si elle existe.
import { ref } from 'vue'
import { methods } from '../lib/methodsApp.js'

const props = defineProps({
  pageId: { type: String, required: true },
  mediaKey: { type: String, required: true },
  name: { type: String, default: 'Fichier' }
})
const busy = ref(false)
const message = ref('')

async function open() {
  message.value = ''
  busy.value = true
  try {
    const r = await methods.getMedia(props.pageId, props.mediaKey)
    if (r.blob) {
      const url = URL.createObjectURL(r.blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 120000)
    } else if (r.tooLarge) {
      window.open(r.url, '_blank', 'noopener')
    } else {
      message.value = r.error === 'OFFLINE' ? 'Fichier non disponible hors ligne.' : 'Fichier indisponible pour le moment.'
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <span class="mfile">
    <button type="button" class="btn btn--ghost" :disabled="busy" @click="open">{{ busy ? 'Ouverture…' : name }}</button>
    <span v-if="message" class="small muted" role="status">{{ message }}</span>
  </span>
</template>

<style scoped>
.mfile { display: inline-flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
</style>
