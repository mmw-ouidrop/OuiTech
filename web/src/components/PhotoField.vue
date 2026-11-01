<script setup>
// Photos d'un champ « image_upload ». Les miennes s'affichent depuis le Blob local (donc même
// hors ligne) ; celles des collègues arrivent sans image (le serveur ne diffuse pas de lien) :
// on montre qui l'a prise et quand.
import { computed, onBeforeUnmount, watch } from 'vue'
import { formatTime, personName } from '../lib/format.js'

const props = defineProps({
  id: { type: String, required: true },
  rows: { type: Array, default: () => [] },        // lignes media_queue de ce champ
  remote: { type: Array, default: () => [] },      // photos du rapport partagé { mediaId, by, at }
  max: { type: Number, default: 0 },               // 0 = illimité
  disabled: Boolean,
  busy: Boolean
})
const emit = defineEmits(['add', 'remove'])

const urls = new Map()
function urlFor(row) {
  if (!urls.has(row.mediaId)) urls.set(row.mediaId, URL.createObjectURL(row.fileBlob))
  return urls.get(row.mediaId)
}
function sweep() {
  const live = new Set(props.rows.map((r) => r.mediaId))
  for (const [k, u] of urls) if (!live.has(k)) { URL.revokeObjectURL(u); urls.delete(k) }
}
watch(() => props.rows, sweep)
onBeforeUnmount(() => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear() })

const STATUS = {
  queued: 'En attente d’envoi',
  uploaded: 'Envoi en cours',
  done: 'Dans Notion ✓',
  failed: 'Refusée'
}
const mineIds = computed(() => new Set(props.rows.map((r) => r.mediaId)))
const others = computed(() => props.remote.filter((p) => !mineIds.value.has(p.mediaId)))
const count = computed(() => props.rows.filter((r) => r.uploadStatus !== 'failed').length + others.value.length)
const full = computed(() => props.max > 0 && count.value >= props.max)

function pick(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''             // permet de reprendre la même photo
  if (files.length) emit('add', files)
}
</script>

<template>
  <div class="photos">
    <ul v-if="rows.length || others.length" class="photos__grid">
      <li v-for="r in rows" :key="r.mediaId" class="photo" :class="{ 'photo--failed': r.uploadStatus === 'failed' }">
        <img :src="urlFor(r)" alt="Photo prise sur cet appareil" loading="lazy" />
        <span class="photo__state small">{{ STATUS[r.uploadStatus] || '' }}</span>
        <button v-if="!disabled" type="button" class="photo__del" :aria-label="'Supprimer cette photo'" @click="emit('remove', r.mediaId)">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>
        </button>
      </li>
      <li v-for="p in others" :key="p.mediaId" class="photo photo--remote">
        <span class="photo__ph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 7h3l2-2h6l2 2h3v12H4z M12 17a4 4 0 100-8 4 4 0 000 8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
        </span>
        <span class="photo__state small">{{ personName(p.by) || 'Auteur inconnu' }} · {{ formatTime(p.at) }}</span>
      </li>
    </ul>
    <p v-else class="small muted">Aucune photo pour l’instant.</p>

    <label v-if="!disabled" class="btn btn--ghost photos__add" :class="{ 'photos__add--off': full || busy }">
      <input type="file" accept="image/*" multiple class="sr-only" :disabled="full || busy" @change="pick" />
      {{ busy ? 'Traitement…' : full ? 'Maximum atteint' : 'Ajouter des photos' }}
    </label>
    <p v-if="max > 0" class="small muted">{{ count }} / {{ max }} photo{{ max > 1 ? 's' : '' }}</p>
  </div>
</template>

<style scoped>
.photos { display: grid; gap: var(--s-3); }
.photos__grid { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.photo { position: relative; display: grid; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); overflow: hidden; }
.photo img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.photo__state { padding: var(--s-1) var(--s-2); color: var(--text); }
.photo--failed { border-color: var(--danger); border-width: 2px; }
.photo--remote { min-height: 96px; align-content: center; justify-items: center; color: var(--text-muted); }
.photo__ph { padding-top: var(--s-3); }
.photo__del {
  position: absolute; top: 4px; right: 4px; width: 44px; height: 44px; display: grid; place-items: center;
  border: 0; border-radius: 999px; background: var(--btn-bg); color: var(--btn-text); cursor: pointer;
}
.photos__add { justify-self: start; position: relative; }
.photos__add--off { opacity: .5; cursor: not-allowed; }
.photos__add:focus-within { box-shadow: var(--focus); }
</style>
