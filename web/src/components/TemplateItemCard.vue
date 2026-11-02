<script setup>
// Un élément du template (un bloc de la page Notion) : ses réglages et ses boutons (monter, descendre, dupliquer, supprimer).
// Le composant ne modifie jamais l'élément : il envoie `patch` avec les champs changés.
import { ref, computed } from 'vue'
import NavIcon from './NavIcon.vue'
import { iconOf, kindLabel, TEXT_STYLES, CHOICE_TYPES } from '../lib/templateEditor.js'

const props = defineProps({
  item: { type: Object, required: true },
  first: { type: Boolean, default: false },
  last: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  error: { type: String, default: '' }
})
const emit = defineEmits(['patch', 'select', 'move', 'duplicate', 'remove'])

const editId = ref(false)
const uid = 'ic-' + Math.random().toString(36).slice(2, 8)
const isChoice = computed(() => props.item.t === 'field' && CHOICE_TYPES.includes(props.item.type))
const hasPlaceholder = computed(() => props.item.t === 'field' && ['text', 'textarea', 'number'].includes(props.item.type))
const optionsText = computed(() => (props.item.options || []).join('\n'))
const isNew = computed(() => !props.item.ref)
const patch = (o) => emit('patch', o)
const onId = (e) => patch({ id: e.target.value.trim(), idAuto: false })
</script>

<template>
  <article class="ic" :class="{ 'ic--sel': selected, 'ic--err': error, 'ic--locked': item.t === 'locked' }" @focusin="emit('select')" @click="emit('select')">
    <header class="ic__head">
      <span class="ic__kind"><NavIcon :name="iconOf(item)" :size="18" /><span>{{ kindLabel(item) }}</span></span>
      <span class="ic__tools">
        <button type="button" class="ic__btn" :disabled="first" aria-label="Monter" title="Monter" @click.stop="emit('move', -1)"><NavIcon name="up" :size="18" /></button>
        <button type="button" class="ic__btn" :disabled="last" aria-label="Descendre" title="Descendre" @click.stop="emit('move', 1)"><NavIcon name="down" :size="18" /></button>
        <button v-if="item.t !== 'locked'" type="button" class="ic__btn" aria-label="Dupliquer" title="Dupliquer" @click.stop="emit('duplicate')"><NavIcon name="copy" :size="18" /></button>
        <button type="button" class="ic__btn ic__btn--del" aria-label="Supprimer" title="Supprimer" @click.stop="emit('remove')"><NavIcon name="trash" :size="18" /></button>
      </span>
    </header>

    <div class="ic__body">
      <!-- Section -->
      <template v-if="item.t === 'section'">
        <div class="seg" role="group" aria-label="Taille du titre">
          <button v-for="l in [{ v: 1, t: 'Grand' }, { v: 2, t: 'Moyen' }, { v: 3, t: 'Petit' }]" :key="l.v" type="button" class="seg__b" :aria-pressed="item.level === l.v" @click="patch({ level: l.v })">{{ l.t }}</button>
        </div>
        <input class="input" :value="item.text" placeholder="Titre de la section" :aria-label="'Titre de la section'" @input="patch({ text: $event.target.value })" />
        <p v-if="item.fixed" class="hint small">Titre déroulant avec du contenu : son texte se modifie ici, le reste dans Notion.</p>
      </template>

      <!-- Consigne -->
      <template v-else-if="item.t === 'text'">
        <div class="seg" role="group" aria-label="Présentation">
          <button v-for="s in TEXT_STYLES" :key="s.id" type="button" class="seg__b" :aria-pressed="item.style === s.id" @click="patch({ style: s.id })">{{ s.label }}</button>
        </div>
        <textarea class="input" rows="2" :value="item.text" placeholder="Texte affiché au technicien" aria-label="Texte de la consigne" @input="patch({ text: $event.target.value })"></textarea>
        <p v-if="item.rich" class="hint small">La mise en forme faite dans Notion (gras, couleurs…) est conservée tant que vous ne modifiez pas le texte.</p>
      </template>

      <!-- Case à cocher native -->
      <template v-else-if="item.t === 'todo'">
        <input class="input" :value="item.text" placeholder="Texte de la case à cocher" aria-label="Texte de la case à cocher" @input="patch({ text: $event.target.value })" />
      </template>

      <!-- Champ -->
      <template v-else-if="item.t === 'field'">
        <input class="input ic__label" :value="item.label" placeholder="Libellé affiché au technicien" aria-label="Libellé du champ" @input="patch({ label: $event.target.value })" />
        <textarea v-if="isChoice" class="input" rows="4" :value="optionsText" :aria-label="'Choix proposés, un par ligne'" placeholder="Un choix par ligne (2 au moins)" @input="patch({ options: $event.target.value.split('\n') })"></textarea>
        <div v-if="hasPlaceholder" class="ic__row">
          <input class="input" :value="item.placeholder" placeholder="Texte d’aide dans le champ (facultatif)" aria-label="Texte d’aide" @input="patch({ placeholder: $event.target.value })" />
          <input v-if="item.type === 'number'" class="input ic__unit" :value="item.unit" placeholder="Unité (V, bar…)" aria-label="Unité" @input="patch({ unit: $event.target.value })" />
        </div>
        <div class="ic__row ic__row--meta">
          <label class="chk"><input type="checkbox" :checked="item.required" @change="patch({ required: $event.target.checked })" /><span>Obligatoire</span></label>
          <span class="idline small">
            <template v-if="editId && isNew">
              <label :for="uid + '-id'" class="sr-only">Identifiant</label>
              <input :id="uid + '-id'" class="input idline__in" :value="item.id" @input="onId" @blur="editId = false" />
            </template>
            <template v-else>
              Identifiant : <code>{{ item.id || '—' }}</code>
              <button v-if="isNew" type="button" class="linkish" @click.stop="editId = true">modifier</button>
              <NavIcon v-else name="lock" :size="14" title="Fixé : le changer ferait perdre les saisies déjà faites" />
            </template>
          </span>
        </div>
      </template>

      <hr v-else-if="item.t === 'divider'" class="ic__hr" />

      <template v-else-if="item.t === 'html'">
        <textarea class="input ic__code" rows="6" :value="item.html" spellcheck="false" placeholder="<div>…</div>" aria-label="Code HTML" @input="patch({ html: $event.target.value })"></textarea>
        <p class="hint small">Affiché tel quel, dans un cadre isolé (pas de scripts qui touchent à l’application).</p>
      </template>

      <template v-else-if="item.t === 'locked'">
        <p class="ic__lock"><strong>{{ item.label }}</strong><span v-if="item.preview" class="muted"> — {{ item.preview }}</span></p>
        <p class="hint small">Ce bloc se modifie dans Notion. Ici, il peut seulement être déplacé ou supprimé.</p>
      </template>
    </div>

    <p v-if="error" class="ic__err small" role="alert">⚠ {{ error }}</p>
  </article>
</template>

<style scoped>
.ic { border: 1px solid var(--line); border-left: 4px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); padding: var(--s-2) var(--s-3) var(--s-3); }
.ic--sel { border-left-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.ic--err { border-left-color: var(--danger); }
.ic--locked { background: var(--surface-2); }
.ic__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); margin-bottom: var(--s-2); }
.ic__kind { display: inline-flex; align-items: center; gap: var(--s-2); font: 600 var(--fs-small)/1.2 var(--f-body); color: var(--text-muted); }
.ic__tools { display: flex; gap: 2px; }
.ic__btn { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: var(--radius); background: transparent; color: var(--accent); cursor: pointer; }
.ic__btn:hover:not(:disabled) { background: var(--surface-2); color: var(--heading); }
.ic__btn:disabled { opacity: .3; cursor: default; }
.ic__btn--del:hover:not(:disabled) { color: var(--danger); }
.ic__body { display: grid; gap: var(--s-2); }
.ic__label { font-weight: 600; }
.ic__row { display: flex; gap: var(--s-2); flex-wrap: wrap; align-items: center; }
.ic__row > .input { flex: 1 1 200px; width: auto; }
.ic__unit { flex: 0 1 140px !important; }
.ic__row--meta { justify-content: space-between; }
.chk { display: inline-flex; align-items: center; gap: var(--s-2); min-height: 36px; cursor: pointer; }
.chk input { width: 20px; height: 20px; accent-color: var(--accent); }
.idline { color: var(--text-muted); display: inline-flex; align-items: center; gap: var(--s-2); }
.idline code { background: var(--surface-2); padding: 1px 6px; border-radius: 4px; }
.idline__in { min-height: 36px; width: 220px; }
.linkish { color: var(--accent); text-decoration: underline; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; }
.seg { display: flex; flex-wrap: wrap; gap: 4px; }
.seg__b { min-height: 34px; padding: 0 var(--s-3); border: 1px solid var(--line-strong); border-radius: 999px; background: transparent; color: var(--text); font: 500 var(--fs-small)/1 var(--f-body); cursor: pointer; }
.seg__b[aria-pressed='true'] { background: var(--btn-bg); color: var(--btn-text); border-color: var(--btn-bg); }
.ic__code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14px; }
.ic__hr { border: 0; border-top: 2px dashed var(--line-strong); margin: var(--s-2) 0; }
.ic__lock { margin: 0; overflow-wrap: anywhere; }
.hint { margin: 0; color: var(--text-muted); }
.ic__err { margin: var(--s-2) 0 0; color: var(--text); font-weight: 600; }
</style>
