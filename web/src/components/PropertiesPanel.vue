<script setup>
// Propriétés Notion de la mission, en lecture seule : repliables d'un appui sur le
// titre, réorganisables et masquables via « Personnaliser ». Les choix sont propres
// à l'appareil (voir lib/propPrefs.js) ; ils ne modifient jamais Notion.
import { computed, ref, watch } from 'vue'
import { formatPropertyValue, isEmptyProperty } from '../lib/format.js'
import FileTiles from './FileTiles.vue'
import { loadPrefs, savePrefs, splitVisible, moveProperty, setHidden, resetPrefs } from '../lib/propPrefs.js'

const props = defineProps({
  properties: { type: Array, required: true },
  pageId: { type: String, default: '' }        // page de la mission : sert à relire les fichiers des champs
})

const prefs = ref(loadPrefs())
const editing = ref(false)
const showEmpty = ref(false)               // « Champs vides » : repliés tant qu'on ne les demande pas

watch(prefs, (p) => savePrefs(p), { deep: true })

const split = computed(() => splitVisible(props.properties, prefs.value))
const hiddenLabels = computed(() => new Set(prefs.value.hidden))

const filled = computed(() => split.value.visible.filter((p) => !isEmptyProperty(p)))
const empty = computed(() => split.value.visible.filter((p) => isEmptyProperty(p)))

const summary = computed(() => {
  const n = filled.value.length
  const e = empty.value.length
  const h = split.value.hidden.length
  return `${n} champ${n > 1 ? 's' : ''}` + (e ? ` · ${e} vide${e > 1 ? 's' : ''}` : '') + (h ? ` · ${h} masqué${h > 1 ? 's' : ''}` : '')
})

function toggleCollapsed() {
  prefs.value = { ...prefs.value, collapsed: !prefs.value.collapsed }
  if (prefs.value.collapsed) editing.value = false
}
const move = (label, delta) => (prefs.value = moveProperty(props.properties, prefs.value, label, delta))
const setVisible = (label, visible) => (prefs.value = setHidden(prefs.value, label, !visible))
const reset = () => (prefs.value = resetPrefs(prefs.value))
</script>

<template>
  <section class="card panel" aria-labelledby="info-title">
    <header class="panel__head">
      <h3 id="info-title" class="panel__title">
        <button
          type="button"
          class="panel__toggle"
          :aria-expanded="!prefs.collapsed"
          aria-controls="info-body"
          @click="toggleCollapsed"
        >
          <svg class="panel__chevron" :class="{ 'panel__chevron--closed': prefs.collapsed }" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Mission</span>
        </button>
      </h3>
      <span class="small muted panel__summary">{{ summary }}</span>
      <button v-if="!prefs.collapsed" type="button" class="panel__edit" :aria-pressed="editing" @click="editing = !editing">
        {{ editing ? 'Terminé' : 'Personnaliser' }}
      </button>
    </header>

    <div v-show="!prefs.collapsed" id="info-body" class="panel__body">
      <dl v-if="!editing" class="props">
        <template v-for="p in filled" :key="p.label">
          <dt>{{ p.label }}</dt>
          <dd>
            <FileTiles v-if="p.files && p.files.length && pageId" :page-id="pageId" :files="p.files" />
            <template v-else>{{ formatPropertyValue(p) }}</template>
          </dd>
        </template>
      </dl>
      <p v-if="!editing && !split.visible.length" class="small muted">Tous les champs sont masqués.</p>
      <p v-else-if="!editing && !filled.length" class="small muted">Aucun champ renseigné.</p>

      <div v-if="!editing && empty.length" class="empties">
        <button type="button" class="empties__btn" :aria-expanded="showEmpty" aria-controls="info-empty" @click="showEmpty = !showEmpty">
          <svg class="panel__chevron" :class="{ 'panel__chevron--closed': !showEmpty }" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Champs vides ({{ empty.length }})</span>
        </button>
        <dl v-show="showEmpty" id="info-empty" class="props props--empty">
          <template v-for="p in empty" :key="p.label">
            <dt>{{ p.label }}</dt>
            <dd class="muted">—</dd>
          </template>
        </dl>
      </div>

      <template v-if="editing">
        <p class="small muted">
          Montez, descendez ou masquez les champs. Ce réglage est propre à cet appareil et ne modifie pas Notion.
        </p>
        <ul class="edit">
          <li v-for="(p, i) in split.all" :key="p.label" class="edit__row" :class="{ 'edit__row--off': hiddenLabels.has(p.label) }">
            <label class="edit__show">
              <input type="checkbox" :checked="!hiddenLabels.has(p.label)" @change="setVisible(p.label, $event.target.checked)" />
              <span class="edit__label">
                <strong>{{ p.label }}</strong>
                <span class="small muted edit__preview">{{ formatPropertyValue(p) }}</span>
              </span>
            </label>
            <span class="edit__moves">
              <button type="button" class="icon-btn" :disabled="i === 0" :aria-label="`Monter « ${p.label} »`" @click="move(p.label, -1)">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="icon-btn" :disabled="i === split.all.length - 1" :aria-label="`Descendre « ${p.label} »`" @click="move(p.label, 1)">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            </span>
          </li>
        </ul>
        <button type="button" class="btn btn--ghost" @click="reset">Rétablir l'ordre d'origine</button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.panel__head { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
.panel__title { margin: 0; font-size: var(--fs-h4); line-height: var(--lh-h4); }
.panel__toggle {
  display: inline-flex; align-items: center; gap: var(--s-2);
  min-height: var(--tap); padding: 0 var(--s-2) 0 0; margin: 0;
  border: 0; background: transparent; color: var(--heading); cursor: pointer;
  font: inherit; text-align: left;
}
.panel__chevron { transition: transform .15s; flex: none; }
.panel__chevron--closed { transform: rotate(-90deg); }
.panel__summary { flex: 1 1 auto; }
.panel__edit {
  min-height: var(--tap); padding: 0 var(--s-3);
  border: 2px solid var(--accent); border-radius: var(--radius); background: transparent; color: var(--accent);
  font: 700 var(--fs-cta)/1 var(--f-display); letter-spacing: .02em; text-transform: uppercase; cursor: pointer;
}
.panel__edit:hover, .panel__edit[aria-pressed='true'] { background: var(--surface-2); color: var(--heading); border-color: var(--heading); }
.panel__body { margin-top: var(--s-3); }

.empties { margin-top: var(--s-4); border-top: 1px solid var(--line); padding-top: var(--s-2); }
.empties__btn { display: inline-flex; align-items: center; gap: var(--s-2); min-height: var(--tap); padding: 0; border: 0; background: transparent; color: var(--accent); font: 600 var(--fs-small)/1.3 var(--f-body); cursor: pointer; }
.props--empty { margin-top: var(--s-2); }
.props { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px var(--s-4); margin: 0; }
.props dt { font: 600 var(--fs-small)/1.3 var(--f-body); color: var(--heading); margin-top: var(--s-3); }
.props dt:first-child { margin-top: 0; }
.props dd { margin: 0; overflow-wrap: anywhere; }
@media (min-width: 560px) {
  .props { grid-template-columns: minmax(120px, 1fr) 2fr; }
  .props dt { margin-top: 0; padding-top: var(--s-2); }
  .props dd { padding-top: var(--s-2); }
}

.edit { list-style: none; margin: var(--s-3) 0; padding: 0; border-top: 1px solid var(--line); }
.edit__row { display: flex; align-items: center; gap: var(--s-2); border-bottom: 1px solid var(--line); }
.edit__row--off .edit__label { opacity: .55; }
.edit__show { display: flex; align-items: center; gap: var(--s-3); flex: 1 1 auto; min-width: 0; min-height: var(--tap); cursor: pointer; }
.edit__show input { width: 24px; height: 24px; flex: none; accent-color: var(--accent); }
.edit__label { display: grid; min-width: 0; }
.edit__preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.edit__moves { display: flex; flex: none; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; padding: 0;
  border: 0; border-radius: var(--radius); background: transparent; color: var(--accent); cursor: pointer;
}
.icon-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--heading); }
.icon-btn:disabled { opacity: .3; cursor: not-allowed; }
</style>
