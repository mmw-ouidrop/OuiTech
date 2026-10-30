<script>
let seq = 0
</script>

<script setup>
// Profil « support technique » : valider ou changer l'état Notion d'un rack / casier (ex. « Diag tech » → « Remis »).
import { ref, watch } from 'vue'

const props = defineProps({
  state: { type: String, default: '' },
  options: { type: Array, required: true },
  busy: { type: Boolean, default: false }
})
const emit = defineEmits(['apply'])
const uid = 'sc-' + ++seq
const choice = ref(props.state)
watch(() => props.state, (v) => { choice.value = v })
</script>

<template>
  <form class="sc" @submit.prevent="emit('apply', choice)">
    <label class="sc__lbl" :for="uid">État dans Notion (support)</label>
    <div class="sc__row">
      <select :id="uid" v-model="choice" class="input sc__sel">
        <option v-for="o in options" :key="o" :value="o">{{ o }}</option>
      </select>
      <button class="btn" :disabled="busy || !choice || choice === state">Appliquer</button>
    </div>
  </form>
</template>

<style scoped>
.sc { margin-top: var(--s-3); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.sc__lbl { display: block; font-weight: 700; margin-bottom: var(--s-2); }
.sc__row { display: flex; gap: var(--s-3); flex-wrap: wrap; }
.sc__sel { flex: 1 1 160px; min-width: 0; }
</style>
