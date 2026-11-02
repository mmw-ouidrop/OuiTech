<script setup>
// Préparer le template d'un compte rendu (profil support) : le contenu de la page Notion de la mission,
// bloc par bloc, sans écrire de JSON. Pensé pour l'ordinateur ; s'empile sur téléphone.
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { api } from '../lib/api.js'
import { online } from '../lib/online.js'
import { normalizeReference } from '../lib/ref.js'
import { DEFAULT_PREFIX } from '../config.js'
import { FIELD_KINDS, LAYOUT_KINDS, createItem, duplicateItem, forImport, fromServer, insertAfter, moveItem, removedCount, signature, syncAutoId, toPayload, validateItems } from '../lib/templateEditor.js'
import NavIcon from '../components/NavIcon.vue'
import TemplateItemCard from '../components/TemplateItemCard.vue'
import TemplateHelp from '../components/TemplateHelp.vue'

const props = defineProps({ reference: { type: String, default: '' } })
const router = useRouter()

const input = ref(props.reference || '')
const mission = ref(null)             // { reference, title, url, container, outside }
const items = ref([])
const original = ref([])              // éléments tels qu'enregistrés (pour compter les suppressions)
const baseline = ref('')              // signature des éléments enregistrés
const state = ref('idle')             // idle | loading | ready | error
const error = ref('')
const saving = ref(false)
const saveMsg = ref('')
const saveWarn = ref([])
const showHelp = ref(false)
const showErrors = ref(false)
const selectedKey = ref('')
const importRef = ref('')
const importOpen = ref(false)
const importMsg = ref('')
const importing = ref(false)

const errors = computed(() => validateItems(items.value))
const errorCount = computed(() => Object.keys(errors.value).length)
const dirty = computed(() => state.value === 'ready' && signature(items.value) !== baseline.value)
const removed = computed(() => removedCount(original.value, items.value))

function adopt(data) {
  mission.value = { reference: data.reference, title: data.title, url: data.url, container: data.container, outside: data.outside }
  items.value = fromServer(data.items)
  original.value = data.items.map((i) => ({ ref: i.ref }))
  baseline.value = signature(items.value)
}

async function open(refText) {
  const reference = normalizeReference(refText, DEFAULT_PREFIX)
  if (!reference) { error.value = 'Indiquez une référence de mission, par exemple FI-252.'; state.value = 'error'; return }
  if (dirty.value && !window.confirm('Des modifications ne sont pas enregistrées. Ouvrir une autre mission quand même ?')) return
  state.value = 'loading'; error.value = ''; saveMsg.value = ''; saveWarn.value = []; showErrors.value = false
  try {
    adopt(await api.templateGet(reference))
    input.value = reference
    state.value = 'ready'
    if (props.reference !== reference) router.replace({ name: 'modeles', params: { reference } })
  } catch (e) {
    state.value = 'error'
    error.value = e.code === 'NOT_FOUND' ? `Aucune mission « ${reference} ».` : e.code === 'NETWORK' ? 'Pas de réseau : l’éditeur demande une connexion.' : e.message
  }
}

onMounted(() => { if (props.reference) open(props.reference) })

/* ───────────────────────────── Modifications ───────────────────────────── */

function patchItem(item, p) {
  Object.assign(item, p)
  syncAutoId(items.value, item)
  saveMsg.value = ''
}
function add(kind) {
  const it = createItem(kind, items.value)
  items.value = insertAfter(items.value, selectedKey.value, it)
  selectedKey.value = it.key
  saveMsg.value = ''
  nextTick(() => {
    const el = document.querySelector(`[data-key="${it.key}"]`)
    if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); const f = el.querySelector('input, textarea'); f && f.focus({ preventScroll: true }) }
  })
}
function move(item, delta) {
  items.value = moveItem(items.value, items.value.indexOf(item), delta)
  saveMsg.value = ''
}
function duplicate(item) { items.value = duplicateItem(items.value, item.key); saveMsg.value = '' }
function remove(item) {
  if (item.t === 'locked' && !window.confirm(`Supprimer ce bloc (${item.label}) de la page Notion à l’enregistrement ?`)) return
  items.value = items.value.filter((i) => i !== item)
  saveMsg.value = ''
}

async function save() {
  showErrors.value = true
  if (errorCount.value) {
    const firstKey = items.value.find((i) => errors.value[i.key])
    const el = firstKey && document.querySelector(`[data-key="${firstKey.key}"]`)
    el && el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return
  }
  if (removed.value && !window.confirm(`${removed.value} bloc${removed.value > 1 ? 's seront supprimés' : ' sera supprimé'} de la page Notion. Continuer ?`)) return
  saving.value = true; saveMsg.value = ''; saveWarn.value = []
  try {
    const data = await api.templateSave({ id: mission.value.reference, items: toPayload(items.value) })
    adopt(data)
    const s = data.saved || {}
    const parts = []
    if (s.created) parts.push(`${s.created} ajouté${s.created > 1 ? 's' : ''}`)
    if (s.updated) parts.push(`${s.updated} modifié${s.updated > 1 ? 's' : ''}`)
    if (s.moved) parts.push(`${s.moved} déplacé${s.moved > 1 ? 's' : ''}`)
    if (s.deleted) parts.push(`${s.deleted} supprimé${s.deleted > 1 ? 's' : ''}`)
    saveMsg.value = parts.length ? `Enregistré dans Notion : ${parts.join(', ')}.` : 'Déjà à jour : rien à enregistrer.'
    saveWarn.value = (data.warnings || []).map((w) => w.message)
    showErrors.value = false
  } catch (e) {
    saveMsg.value = ''
    saveWarn.value = [e.code === 'TEMPLATE_CHANGED' || e.code === 'BAD_REQUEST' ? e.message
      : e.code === 'NETWORK' ? 'Pas de réseau : rien n’a été enregistré, vos modifications sont toujours à l’écran.'
      : `Enregistrement impossible : ${e.message}`]
  } finally {
    saving.value = false
  }
}

async function doImport() {
  const reference = normalizeReference(importRef.value, DEFAULT_PREFIX)
  if (!reference) { importMsg.value = 'Indiquez une référence, par exemple FI-240.'; return }
  importing.value = true; importMsg.value = ''
  try {
    const data = await api.templateGet(reference)
    const added = forImport(data.items, items.value)
    const skipped = data.items.length - added.length
    items.value = items.value.concat(added)
    importMsg.value = `${added.length} élément${added.length > 1 ? 's' : ''} repris de ${data.reference}` + (skipped ? ` (${skipped} média${skipped > 1 ? 's' : ''} ou bloc${skipped > 1 ? 's' : ''} verrouillé${skipped > 1 ? 's' : ''} non copié${skipped > 1 ? 's' : ''})` : '') + '. Pensez à enregistrer.'
    importRef.value = ''
    importOpen.value = false
  } catch (e) {
    importMsg.value = e.code === 'NOT_FOUND' ? `Aucune mission « ${reference} ».` : e.message
  } finally {
    importing.value = false
  }
}

/* ───────────────────────────── Sortie de page ───────────────────────────── */

const warnLeave = (e) => { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', warnLeave))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnLeave))
onBeforeRouteLeave(() => (dirty.value ? window.confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?') : true))
watch(() => props.reference, (r) => { if (r && mission.value && r !== mission.value.reference) open(r) })
</script>

<template>
  <section class="te">
    <header class="te__top">
      <h2 class="te__title">Modèles de CR</h2>
      <button type="button" class="te__icon" aria-label="Aide : préparer un template" title="Aide" @click="showHelp = true"><NavIcon name="help" :size="26" /></button>
    </header>

    <form class="te__open card" @submit.prevent="open(input)">
      <label for="te-ref" class="sr-only">Référence de la mission</label>
      <input id="te-ref" v-model="input" class="input te__ref" placeholder="Référence de la mission, par exemple FI-252" autocomplete="off" autocapitalize="characters" />
      <button type="submit" class="btn" :disabled="state === 'loading' || !online">{{ state === 'loading' ? 'Ouverture…' : 'Ouvrir' }}</button>
    </form>
    <p v-if="!online" class="note small te__gap" role="status">Pas de réseau : l’éditeur demande une connexion.</p>
    <p v-if="state === 'error'" class="alert te__gap" role="alert">{{ error }}</p>

    <p v-if="state === 'idle'" class="te__empty muted">
      Ouvrez la mission dont vous voulez préparer le compte rendu. Besoin d’un coup de main ? Touchez le <strong>?</strong> en haut à droite.
    </p>

    <template v-if="state === 'ready' && mission">
      <div class="te__bar card te__gap">
        <div class="te__who">
          <strong>{{ mission.reference }}</strong>
          <span v-if="mission.title" class="muted"> · {{ mission.title }}</span>
          <a v-if="mission.url" :href="mission.url" target="_blank" rel="noopener noreferrer" class="te__ext" aria-label="Ouvrir la page dans Notion" title="Ouvrir dans Notion"><NavIcon name="external" :size="18" /></a>
        </div>
        <div class="te__actions">
          <button type="button" class="btn btn--ghost te__b" @click="importOpen = !importOpen"><NavIcon name="import" :size="18" /> Reprendre</button>
          <button type="button" class="btn te__b" :disabled="saving || !online || !dirty" @click="save">
            <NavIcon name="save" :size="18" /> {{ saving ? 'Enregistrement…' : 'Enregistrer dans Notion' }}
          </button>
        </div>
      </div>

      <form v-if="importOpen" class="te__import card te__gap" @submit.prevent="doImport">
        <label for="te-imp" class="small">Copier les éléments d’une autre mission, à la suite de ceux-ci :</label>
        <div class="te__open">
          <input id="te-imp" v-model="importRef" class="input te__ref" placeholder="Référence, par exemple FI-240" autocomplete="off" autocapitalize="characters" />
          <button type="submit" class="btn btn--ghost" :disabled="importing">{{ importing ? 'Lecture…' : 'Reprendre' }}</button>
        </div>
      </form>
      <p v-if="importMsg" class="note small te__gap" role="status">{{ importMsg }}</p>

      <p v-if="saveMsg" class="note te__gap" role="status">{{ saveMsg }}</p>
      <ul v-if="saveWarn.length" class="alert te__gap te__warn" role="alert"><li v-for="(w, i) in saveWarn" :key="i">{{ w }}</li></ul>
      <p v-if="mission.outside" class="note small te__gap">
        {{ mission.outside }} bloc{{ mission.outside > 1 ? 's' : '' }} de la page se trouve{{ mission.outside > 1 ? 'nt' : '' }} en dehors du toggle « Template » : à modifier dans Notion.
      </p>
      <p v-if="showErrors && errorCount" class="alert te__gap" role="alert">{{ errorCount }} élément{{ errorCount > 1 ? 's' : '' }} à corriger avant d’enregistrer (signalé{{ errorCount > 1 ? 's' : '' }} en dessous).</p>

      <div class="te__cols te__gap">
        <ol class="te__list" aria-label="Éléments du template">
          <li v-if="!items.length" class="te__none card">Le template est vide. Ajoutez un premier élément avec le menu « Ajouter ».</li>
          <li v-for="(it, i) in items" :key="it.key" :data-key="it.key">
            <TemplateItemCard
              :item="it" :first="i === 0" :last="i === items.length - 1" :selected="selectedKey === it.key" :error="showErrors || it.ref ? errors[it.key] || '' : ''"
              @select="selectedKey = it.key" @patch="patchItem(it, $event)" @move="move(it, $event)" @duplicate="duplicate(it)" @remove="remove(it)"
            />
          </li>
        </ol>

        <aside class="te__side card" aria-label="Ajouter un élément">
          <h3 class="te__h">Ajouter</h3>
          <p class="small muted te__hint">{{ selectedKey ? 'Après l’élément sélectionné.' : 'À la fin du template.' }}</p>
          <p class="te__cat small">Mise en page</p>
          <div class="pal">
            <button v-for="k in LAYOUT_KINDS" :key="k.id" type="button" class="pal__b" :title="k.help" @click="add(k.id)"><NavIcon :name="k.icon" :size="22" /><span>{{ k.label }}</span></button>
          </div>
          <p class="te__cat small">Champs à remplir</p>
          <div class="pal">
            <button v-for="k in FIELD_KINDS" :key="k.type" type="button" class="pal__b" :title="k.help" @click="add(k.type)"><NavIcon :name="k.icon" :size="22" /><span>{{ k.label }}</span></button>
          </div>
        </aside>
      </div>
    </template>

    <TemplateHelp v-if="showHelp" @close="showHelp = false" />
  </section>
</template>

<style scoped>
.te__top { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-3); }
.te__title { margin: 0; }
.te__icon { display: grid; place-items: center; width: var(--tap); height: var(--tap); border: 2px solid var(--accent); border-radius: 999px; background: transparent; color: var(--accent); cursor: pointer; }
.te__icon:hover { background: var(--surface-2); color: var(--heading); }
.te__gap { margin-top: var(--s-3); }
.te__open { display: flex; gap: var(--s-2); align-items: center; }
.te__ref { flex: 1 1 auto; min-width: 0; }
.te__empty { margin-top: var(--s-5); max-width: 52ch; }
.te__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); position: sticky; top: 64px; z-index: 10; }
.te__who { min-width: 0; overflow-wrap: anywhere; }
.te__ext { display: inline-grid; place-items: center; width: 32px; height: 32px; vertical-align: middle; color: var(--accent); }
.te__actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.te__b { display: inline-flex; align-items: center; gap: var(--s-2); }
.te__warn { margin-left: 0; padding-left: calc(var(--s-4) + 1em); }
.te__cols { display: grid; gap: var(--s-4); align-items: start; }
.te__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); min-width: 0; }
.te__none { color: var(--text-muted); }
.te__side { order: -1; }
.te__h { margin: 0 0 var(--s-1); font-size: 20px; }
.te__hint { margin: 0 0 var(--s-2); }
.te__cat { margin: var(--s-3) 0 var(--s-1); font-weight: 700; color: var(--heading); text-transform: uppercase; letter-spacing: .04em; }
.pal { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--s-2); }
.pal__b { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 72px; padding: var(--s-2); border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); color: var(--accent); font: 500 var(--fs-small)/1.2 var(--f-body); text-align: center; cursor: pointer; }
.pal__b span { color: var(--text); }
.pal__b:hover { background: var(--surface-2); border-color: var(--accent); }

/* Ordinateur : la liste à gauche, le menu d'ajout qui suit le défilement à droite */
@media (min-width: 900px) {
  .te__cols { grid-template-columns: minmax(0, 1fr) 300px; }
  .te__side { order: 0; position: sticky; top: 150px; max-height: calc(100vh - 170px); overflow-y: auto; }
  .pal { grid-template-columns: repeat(2, 1fr); }
}
</style>
