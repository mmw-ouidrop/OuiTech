<script setup>
// Copie une valeur (code, mot de passe Wi-Fi…) dans le presse-papiers ; repli pour les navigateurs sans API moderne.
import { ref } from 'vue'

const props = defineProps({
  value: { type: String, required: true },
  label: { type: String, default: 'Copier' }
})
const done = ref(false)
let timer

async function copy() {
  let ok = false
  try {
    await navigator.clipboard.writeText(props.value)
    ok = true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = props.value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { ok = document.execCommand('copy') } catch { ok = false }
    document.body.removeChild(ta)
  }
  done.value = ok
  clearTimeout(timer)
  timer = setTimeout(() => (done.value = false), 2000)
}
</script>

<template>
  <button type="button" class="btn btn--ghost copy" @click="copy">
    <span aria-live="polite">{{ done ? 'Copié ✓' : label }}</span>
  </button>
</template>

<style scoped>
.copy { min-width: 96px; }
</style>
