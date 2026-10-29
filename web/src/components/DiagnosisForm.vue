<script setup>
// Diagnostic d'un rack / casier KO : un état à choisir (gros boutons), un commentaire facultatif.
import { ref } from 'vue'

const props = defineProps({
  states: { type: Array, required: true },       // [{ id, label }]
  initial: { type: String, default: '' },
  busy: { type: Boolean, default: false }
})
const emit = defineEmits(['submit', 'cancel'])

const state = ref(props.initial)
const comment = ref('')
const MAX = 1000

function submit() {
  if (!state.value) return
  emit('submit', { state: state.value, comment: comment.value.trim() })
}
</script>

<template>
  <form class="dg" @submit.prevent="submit">
    <fieldset class="dg__set">
      <legend class="dg__legend">Votre diagnostic</legend>
      <div class="dg__grid">
        <label v-for="s in states" :key="s.id" class="dg__opt" :class="{ 'dg__opt--on': state === s.id }">
          <input v-model="state" class="sr-only" type="radio" name="dg-state" :value="s.id" />
          <span>{{ s.label }}</span>
        </label>
      </div>
    </fieldset>
    <div class="field">
      <label for="dg-comment">Commentaire (facultatif)</label>
      <textarea id="dg-comment" v-model="comment" class="input dg__ta" rows="3" :maxlength="MAX" placeholder="Ce que vous avez constaté ou fait…"></textarea>
    </div>
    <p class="small muted">L’état dans Notion ne change pas : l’équipe vérifie votre diagnostic avant toute remise en service.</p>
    <div class="dg__actions">
      <button class="btn" :disabled="!state || busy">{{ busy ? 'Enregistrement…' : 'Enregistrer' }}</button>
      <button type="button" class="btn btn--ghost" @click="emit('cancel')">Annuler</button>
    </div>
  </form>
</template>

<style scoped>
.dg { margin-top: var(--s-3); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.dg__set { border: 0; padding: 0; margin: 0 0 var(--s-3); min-width: 0; }
.dg__legend { font-weight: 700; margin-bottom: var(--s-2); padding: 0; }
.dg__grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); }
.dg__opt { display: grid; place-items: center; text-align: center; min-height: 60px; padding: var(--s-2) var(--s-3); border: 2px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); font-weight: 700; cursor: pointer; }
.dg__opt:focus-within { outline: 3px solid var(--ring); outline-offset: 2px; }
.dg__opt--on { border-color: var(--accent); background: var(--btn-bg); color: var(--btn-text); }
.dg__ta { width: 100%; resize: vertical; min-height: 80px; }
.dg__actions { display: flex; gap: var(--s-3); flex-wrap: wrap; }
</style>
