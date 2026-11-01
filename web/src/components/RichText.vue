<script setup>
// Texte enrichi (fiches, contenu des CR) : gras, italique, souligné, barré, code, liens, couleurs de Notion.
// `text` : texte brut dont les adresses deviennent des liens.
import { computed } from 'vue'
import { linkifySegments } from '../lib/methods.js'

const props = defineProps({
  segments: { type: Array, default: null },
  text: { type: String, default: '' }
})
const list = computed(() => (props.segments && props.segments.length ? props.segments : linkifySegments(props.text)))
const safe = (url) => /^https?:\/\//i.test(url) || /^mailto:/i.test(url)

// Couleur de Notion : « red » (texte) ou « red_background » (surlignage). Noms inconnus : ignorés.
const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
function colorClass(c) {
  if (!c || typeof c !== 'string') return ''
  const bg = c.endsWith('_background')
  const name = bg ? c.slice(0, -11) : c
  return COLORS.includes(name) ? (bg ? 'rt-bg rt-bg-' : 'rt-c rt-c-') + name : ''
}
const cls = (s) => [colorClass(s.col), { 'rt--b': s.b, 'rt--i': s.i, 'rt--s': s.s, 'rt--u': s.u }]
</script>

<template>
  <template v-for="(s, i) in list" :key="i">
    <a v-if="s.h && safe(s.h)" :href="s.h" target="_blank" rel="noopener noreferrer" class="rt" :class="cls(s)">{{ s.t }}</a>
    <code v-else-if="s.c" class="rt-code" :class="cls(s)">{{ s.t }}</code>
    <span v-else class="rt" :class="cls(s)">{{ s.t }}</span>
  </template>
</template>

<style scoped>
.rt--b { font-weight: 700; }
.rt--i { font-style: italic; }
.rt--s { text-decoration: line-through; }
.rt--u { text-decoration: underline; }
.rt--s.rt--u { text-decoration: underline line-through; }
a.rt { color: var(--accent); text-decoration: underline; overflow-wrap: anywhere; }
a.rt.rt--s { text-decoration: underline line-through; }
.rt-code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.92em; background: var(--surface-2); padding: 1px 6px; border-radius: 4px; }
.rt-bg { padding: 0 3px; border-radius: 3px; }
.rt-c-gray { color: var(--rt-gray); } .rt-c-brown { color: var(--rt-brown); } .rt-c-orange { color: var(--rt-orange); }
.rt-c-yellow { color: var(--rt-yellow); } .rt-c-green { color: var(--rt-green); } .rt-c-blue { color: var(--rt-blue); }
.rt-c-purple { color: var(--rt-purple); } .rt-c-pink { color: var(--rt-pink); } .rt-c-red { color: var(--rt-red); }
.rt-bg-gray { background: var(--rt-gray-bg); } .rt-bg-brown { background: var(--rt-brown-bg); } .rt-bg-orange { background: var(--rt-orange-bg); }
.rt-bg-yellow { background: var(--rt-yellow-bg); } .rt-bg-green { background: var(--rt-green-bg); } .rt-bg-blue { background: var(--rt-blue-bg); }
.rt-bg-purple { background: var(--rt-purple-bg); } .rt-bg-pink { background: var(--rt-pink-bg); } .rt-bg-red { background: var(--rt-red-bg); }
</style>
