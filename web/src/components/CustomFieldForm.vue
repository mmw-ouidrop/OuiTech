<script setup>
// Ajout d'un champ par le technicien : fenêtre ouverte par le bouton flottant (ou par « Ajouter un champ » en bas du CR).
// Le champ s'insère sous le champ choisi (`anchorLabel`) ou tout en bas ; il est partagé avec les collègues, inscrit dans le rapport
// Notion, et se déplace ensuite avec les flèches.
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import NavIcon from './NavIcon.vue'
import DictationButton from './DictationButton.vue'
import { mergeText } from '../lib/dictation.js'

// `add` : fonction asynchrone fournie par l'écran ; elle lève une erreur lisible si l'ajout est refusé.
const props = defineProps({
  open: Boolean,
  anchorLabel: { type: String, default: '' },     // champ sous lequel on ajoute (vide : tout en bas)
  add: { type: Function, required: true }
})
const emit = defineEmits(['update:open'])

const TYPES = [
  { value: 'text', label: 'Texte court' },
  { value: 'textarea', label: 'Texte long' },
  { value: 'number', label: 'Nombre' },
  { value: 'checkbox', label: 'Case à cocher' },
  { value: 'radio_group', label: 'Choix unique' },
  { value: 'image_upload', label: 'Photos' }
]
const label = ref('')
const type = ref('text')
const optionsText = ref('')
const where = ref('end')            // 'after' (sous le champ choisi) | 'end' (tout en bas)
const error = ref('')
const busy = ref(false)
const labelInput = ref(null)

const close = () => emit('update:open', false)
const onDictation = (text) => { label.value = mergeText(label.value, text.split('\n').join(' ')).slice(0, 200) }
const onKey = (e) => { if (e.key === 'Escape') close() }

watch(() => props.open, (on) => {
  if (on) {
    error.value = ''
    where.value = props.anchorLabel ? 'after' : 'end'
    window.addEventListener('keydown', onKey)
    nextTick(() => labelInput.value && labelInput.value.focus())
  } else {
    window.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

async function submit() {
  error.value = ''
  busy.value = true
  const options = optionsText.value.split('\n').map((s) => s.trim()).filter(Boolean)
  try {
    await props.add({ label: label.value, type: type.value, options, where: props.anchorLabel ? where.value : 'end' })
    label.value = ''; optionsText.value = ''; type.value = 'text'
    close()
  } catch (e) {
    error.value = (e && e.message) || 'Ajout impossible.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cf" @click.self="close">
      <form class="cf__sheet" role="dialog" aria-modal="true" aria-labelledby="cf-title" novalidate @submit.prevent="submit">
        <header class="cf__head">
          <h2 id="cf-title" class="cf__title">Ajouter un champ</h2>
          <button type="button" class="cf__close" aria-label="Fermer" @click="close"><NavIcon name="close" :size="22" /></button>
        </header>

        <fieldset v-if="anchorLabel" class="cf__where">
          <legend class="cf__legend">Où l’ajouter ?</legend>
          <label class="cf__choice"><input v-model="where" type="radio" value="after" /> <span>Sous « {{ anchorLabel }} »</span></label>
          <label class="cf__choice"><input v-model="where" type="radio" value="end" /> <span>Tout en bas du compte rendu</span></label>
        </fieldset>
        <p v-else class="small muted cf__hint">Le champ sera ajouté tout en bas. Pour le placer ailleurs, touchez d’abord le champ au-dessus duquel il doit se trouver.</p>

        <div class="field">
          <label for="cf-label">Nom du champ</label>
          <div class="cf__row">
            <input id="cf-label" ref="labelInput" v-model="label" class="input" maxlength="200" autocomplete="off" />
            <DictationButton label="nom du champ" @text="onDictation" />
          </div>
        </div>

        <fieldset class="cf__types">
          <legend class="cf__legend">Type</legend>
          <label v-for="t in TYPES" :key="t.value" class="cf__type" :class="{ 'cf__type--on': type === t.value }">
            <input v-model="type" type="radio" name="cf-type" :value="t.value" /> <span>{{ t.label }}</span>
          </label>
        </fieldset>

        <div v-if="type === 'radio_group'" class="field">
          <label for="cf-opts">Choix (un par ligne, 2 minimum)</label>
          <textarea id="cf-opts" v-model="optionsText" class="input" rows="3"></textarea>
        </div>

        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <div class="cf__btns">
          <button class="btn" :disabled="!label.trim() || busy">{{ busy ? 'Ajout…' : 'Ajouter' }}</button>
          <button type="button" class="btn btn--ghost" @click="close">Annuler</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.cf { position: fixed; inset: 0; z-index: 120; display: flex; align-items: flex-end; justify-content: center; background: rgba(0, 0, 0, .5); }
.cf__sheet {
  width: min(100%, 520px); max-height: 92vh; overflow-y: auto; padding: var(--s-4); display: grid; gap: var(--s-3);
  background: var(--surface); color: var(--text); border-radius: var(--radius) var(--radius) 0 0; box-shadow: 0 -8px 24px rgba(0, 0, 0, .25);
  padding-bottom: calc(var(--s-4) + env(safe-area-inset-bottom, 0px));
}
@media (min-width: 700px) { .cf { align-items: center; } .cf__sheet { border-radius: var(--radius); } }
.cf__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.cf__title { margin: 0; }
.cf__close { display: grid; place-items: center; width: var(--tap); height: var(--tap); border: 1px solid var(--line-strong); border-radius: 999px; background: transparent; color: var(--accent); cursor: pointer; }
.cf__hint { margin: 0; }
.cf__row { display: flex; align-items: center; gap: var(--s-2); }
.cf__row .input { flex: 1 1 auto; min-width: 0; }
.cf__where, .cf__types { border: 0; margin: 0; padding: 0; min-width: 0; display: grid; gap: var(--s-2); }
.cf__legend { padding: 0; font: 600 var(--fs-small)/1.3 var(--f-body); color: var(--heading); margin-bottom: var(--s-1); }
.cf__choice { display: flex; align-items: center; gap: var(--s-3); min-height: var(--tap); padding: 0 var(--s-3); border: 2px solid var(--line-strong); border-radius: var(--radius); cursor: pointer; overflow-wrap: anywhere; }
.cf__choice:has(input:checked) { border-color: var(--accent); background: var(--surface-2); }
.cf__choice input, .cf__type input { accent-color: var(--accent); width: 20px; height: 20px; flex: none; }
.cf__types { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.cf__types .cf__legend { grid-column: 1 / -1; }
.cf__type { display: flex; align-items: center; gap: var(--s-2); min-height: var(--tap); padding: 0 var(--s-3); border: 2px solid var(--line-strong); border-radius: var(--radius); cursor: pointer; }
.cf__type--on { border-color: var(--accent); background: var(--surface-2); }
.cf__btns { display: flex; flex-wrap: wrap; gap: var(--s-2); }
</style>
