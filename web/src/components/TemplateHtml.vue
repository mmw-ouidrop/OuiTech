<script setup>
// Bloc de code « HTML » du template Notion, affiché tel quel dans un cadre isolé (iframe « sandbox ») :
// il ne peut ni lire l'application, ni ses données, ni envoyer de requêtes (politique CSP). Les images, vidéos et polices
// en https fonctionnent (avec du réseau) ; styles et petits scripts intégrés fonctionnent aussi, hors ligne compris.
// La hauteur suit le contenu.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { buildSrcdoc } from '../lib/htmlFrame.js'

const props = defineProps({ html: { type: String, required: true } })
const frame = ref(null)
const height = ref(60)
const srcdoc = computed(() => buildSrcdoc(props.html))

function onMessage(e) {
  if (!frame.value || e.source !== frame.value.contentWindow) return
  const d = e.data
  if (d && d.type === 'ouitech-height' && Number.isFinite(d.h)) height.value = Math.min(Math.max(Math.ceil(d.h), 20), 4000)
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <iframe
    ref="frame" class="th" title="Contenu personnalisé" :srcdoc="srcdoc" :style="{ height: height + 'px' }"
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" loading="lazy"
  ></iframe>
</template>

<style scoped>
.th { display: block; width: 100%; border: 0; margin: var(--s-3) 0; background: transparent; color-scheme: normal; }
</style>
