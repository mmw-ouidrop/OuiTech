<script setup>
// Image, vidéo ou fichier posé dans le contenu d'une page de mission : lisible hors ligne (copie sur l'appareil) quand
// il est hébergé par Notion ; un lien externe (YouTube, site…) est affiché tel quel.
import { computed } from 'vue'
import MethodImage from './MethodImage.vue'
import MethodVideo from './MethodVideo.vue'
import MethodFile from './MethodFile.vue'
import { missionMedia } from '../lib/methodsApp.js'

const props = defineProps({
  pageId: { type: String, required: true },
  item: { type: Object, required: true }       // { type, blockId, name, caption, url? }
})
const label = computed(() => props.item.name || props.item.caption || 'Fichier')
</script>

<template>
  <div class="tm">
    <template v-if="item.type === 'image'">
      <figure v-if="item.url" class="tm__ext">
        <img :src="item.url" :alt="item.caption" loading="lazy" referrerpolicy="no-referrer" />
        <figcaption v-if="item.caption" class="small muted">{{ item.caption }}</figcaption>
      </figure>
      <MethodImage v-else :page-id="pageId" :media-key="item.blockId" :caption="item.caption" :service="missionMedia" />
    </template>
    <MethodVideo v-else-if="item.type === 'video'" :page-id="pageId" :url="item.url || ''" :media-key="item.url ? '' : item.blockId" :caption="item.caption" :service="missionMedia" />
    <p v-else-if="item.url" class="tm__file">
      <a class="btn btn--ghost" :href="item.url" target="_blank" rel="noopener noreferrer">{{ label }}</a>
    </p>
    <p v-else class="tm__file"><MethodFile :page-id="pageId" :media-key="item.blockId" :name="label" :service="missionMedia" /></p>
  </div>
</template>

<style scoped>
.tm { margin: var(--s-3) 0; }
.tm__ext { margin: 0; }
.tm__ext img { display: block; width: 100%; height: auto; max-height: 70vh; object-fit: contain; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.tm__file { margin: 0; }
</style>
