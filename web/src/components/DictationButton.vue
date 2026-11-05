<script setup>
// Micro de dictée d'un champ : on touche le micro, on parle ; « stop » ou un nouveau toucher l'arrête, « champ suivant » passe au champ d'après.
// Le composant ne connaît pas le champ : il émet le texte reconnu (`text`), le brouillon en cours (`interim`) et les messages (`message`).
// Il n'apparaît pas si le navigateur n'a pas de reconnaissance vocale (Firefox…).
import { ref, watch, onBeforeUnmount } from 'vue'
import NavIcon from './NavIcon.vue'
import { online } from '../lib/online.js'
import { dictationSupported, createDictation, describeError, startNextDictation } from '../lib/dictation.js'

const props = defineProps({
  disabled: Boolean,
  label: { type: String, default: '' }
})
const emit = defineEmits(['text', 'interim', 'message', 'listening'])

const supported = dictationSupported()
const listening = ref(false)
const btn = ref(null)
let dictation = null

function stop() {
  dictation && dictation.stop('stop')
}

function toggle() {
  if (listening.value) return stop()
  emit('message', '')
  if (!online.value) return emit('message', 'La dictée demande du réseau. Hors ligne, utilisez le micro du clavier.')
  dictation = createDictation({
    lang: 'fr-FR',
    onFinal: (t) => emit('text', t),
    onInterim: (t) => emit('interim', t),
    onError: (code) => emit('message', describeError(code)),
    onCommand: (c) => { if (c === 'next' && !startNextDictation(btn.value)) emit('message', 'C’était le dernier champ à dicter.') },
    onEnd: () => { listening.value = false; emit('listening', false); emit('interim', '') }
  })
  if (dictation && dictation.start()) { listening.value = true; emit('listening', true) }
}

watch(() => props.disabled, (d) => { if (d) stop() })
onBeforeUnmount(stop)
</script>

<template>
  <button
    v-if="supported" ref="btn" type="button" class="mic" :class="{ 'mic--on': listening }" data-dictation
    :disabled="disabled" :aria-pressed="listening"
    :aria-label="listening ? 'Arrêter la dictée' + (label ? ' : ' + label : '') : 'Dicter' + (label ? ' : ' + label : '')"
    :title="listening ? 'Arrêter la dictée' : 'Dicter à la voix'" @click="toggle"
  >
    <NavIcon name="mic" :size="22" />
  </button>
</template>

<style scoped>
.mic {
  flex: none; display: inline-grid; place-items: center; width: var(--tap); height: var(--tap); padding: 0;
  border: 2px solid var(--accent); border-radius: 999px; background: transparent; color: var(--accent); cursor: pointer;
}
.mic:hover:not(:disabled) { background: var(--surface-2); }
.mic:disabled { opacity: .4; cursor: not-allowed; }
.mic--on { background: var(--accent); color: var(--surface); animation: mic-pulse 1.4s ease-out infinite; }
@keyframes mic-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
@media (prefers-reduced-motion: reduce) { .mic--on { animation: none; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 35%, transparent); } }
</style>
