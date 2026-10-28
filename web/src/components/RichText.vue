<script setup>
// Texte enrichi d'une fiche : gras, italique, code, liens. `text` : texte brut dont les adresses deviennent des liens.
import { computed } from 'vue'
import { linkifySegments } from '../lib/methods.js'

const props = defineProps({
  segments: { type: Array, default: null },
  text: { type: String, default: '' }
})
const list = computed(() => props.segments || linkifySegments(props.text))
const safe = (url) => /^https?:\/\//i.test(url) || /^mailto:/i.test(url)
</script>

<template>
  <template v-for="(s, i) in list" :key="i">
    <a v-if="s.h && safe(s.h)" :href="s.h" target="_blank" rel="noopener noreferrer" class="rt" :class="{ 'rt--b': s.b, 'rt--i': s.i }">{{ s.t }}</a>
    <code v-else-if="s.c" class="rt-code">{{ s.t }}</code>
    <span v-else class="rt" :class="{ 'rt--b': s.b, 'rt--i': s.i, 'rt--s': s.s, 'rt--u': s.u }">{{ s.t }}</span>
  </template>
</template>

<style scoped>
.rt--b { font-weight: 700; }
.rt--i { font-style: italic; }
.rt--s { text-decoration: line-through; }
.rt--u { text-decoration: underline; }
a.rt { color: var(--accent); text-decoration: underline; overflow-wrap: anywhere; }
.rt-code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.92em; background: var(--surface-2); padding: 1px 6px; border-radius: 4px; }
</style>
