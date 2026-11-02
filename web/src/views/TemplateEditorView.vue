<script setup>
// Préparer le template d'un compte rendu (profil support) : le contenu de la page Notion de la mission,
// bloc par bloc, sans écrire de JSON. Pensé pour l'ordinateur ; s'empile sur téléphone.
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { api } from '../lib/api.js'
import { online } from '../lib/online.js'
import { normalizeReference } from '../lib/ref.js'
import { DEFAULT_PREFIX } from '../config.js'
import { toCode, fromCode } from '../lib/templateCode.js'
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
const serverItems = ref([])           // blocs tels que Notion les a (pour retrouver les blocs en mode code)
const MODE_KEY = 'ouidrop.tpl.mode'
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'code' ? 'code' : 'visual' } catch { return 'visual' } }
const mode = ref(readMode())          // visual | code
const codeText = ref('')
const codeErrors = ref([])            // [{ line, message }] : erreurs de syntaxe
const codeLines = ref([])             // première ligne de chaque élément (pour situer les erreurs de validation)
const copied = ref(false)

const errors = computed(() => validateItems(items.value))
// Erreurs du mode code : syntaxe, puis règles du template, avec le numéro de ligne.
const codeProblems = computed(() => {
  if (codeErrors.value.length) return codeErrors.value
  return items.value.map((it, n) => (errors.value[it.key] ? { line: codeLines.value[n] || 1, message: errors.value[it.key] } : null)).filter(Boolean)
})
const errorCount = computed(() => Object.keys(errors.value).length)
const dirty = computed(() => state.value === 'ready' && signature(items.value) !== baseline.value)
const removed = computed(() => removedCount(original.value, items.value))

function adopt(data) {
  mission.value = { reference: data.reference, title: data.title, url: data.url, container: data.container, outside: data.outside }
  items.value = fromServer(data.items)
  original.value = data.items.map((i) => ({ ref: i.ref }))
  serverItems.value = fromServer(data.items)
  baseline.value = signature(items.value)
  codeErrors.value = []
  if (mode.value === 'code') showCode()
}

function showCode() {
  codeText.value = toCode(items.value)
  codeErrors.value = []
  codeLines.value = fromCode(codeText.value, serverItems.value).lines
}

// Frappe dans le code : relu à chaque modification ; les éléments ne changent que si le code est valide.
function onCode() {
  saveMsg.value = ''
  const r = fromCode(codeText.value, serverItems.value)
  codeErrors.value = r.errors
  codeLines.value = r.lines
  if (!r.errors.length) items.value = r.items
}

async function setMode(m) {
  if (m === mode.value) return
  if (m === 'visual' && codeErrors.value.length) {
    if (!window.confirm('Le code contient des erreurs : repasser en mode sans code abandonne ces dernières modifications. Continuer ?')) return
  }
  mode.value = m
  try { localStorage.setItem(MODE_KEY, m) } catch { /* mode non mémorisé */ }
  if (m === 'code') showCode()
  else codeErrors.value = []
}

async function copyCode() {
  try { await navigator.clipboard.writeText(codeText.value); copied.value = true; setTimeout(() => (copied.value = false), 1800) } catch { copied.value = false }
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
  if (mode.value === 'code' && codeProblems.value.length) return
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

async function doImport(replace) {
  const reference = normalizeReference(importRef.value, DEFAULT_PREFIX)
  if (!reference) { importMsg.value = 'Indiquez une référence, par exemple FI-240.'; return }
  importing.value = true; importMsg.value = ''
  try {
    const data = await api.templateGet(reference)
    if (replace && items.value.length && !window.confirm('Remplacer tout le template de cette mission par celui de ' + data.reference + ' ? Les blocs actuels seront supprimés de Notion à l’enregistrement.')) return
    // « Remplacer » : les blocs d'images, fichiers… de cette page restent (ils ne se copient pas) ; on ne retire que le reste.
    const keep = replace ? items.value.filter((i) => i.t === 'locked') : items.value
    const added = forImport(data.items, replace ? [] : items.value)
    const skipped = data.items.length - added.length
    items.value = replace ? added.concat(keep) : items.value.concat(added)
    if (mode.value === 'code') showCode()
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
      <div class="te__mode" role="group" aria-label="Mode d’édition">
        <button type="button" class="te__seg" :class="{ 'te__seg--on': mode === 'visual' }" :aria-pressed="mode === 'visual'" @click="setMode('visual')"><NavIcon name="edit" :size="18" /> Sans code</button>
        <button type="button" class="te__seg" :class="{ 'te__seg--on': mode === 'code' }" :aria-pressed="mode === 'code'" @click="setMode('code')"><NavIcon name="code" :size="18" /> Code</button>
      </div>
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
      Ouvrez la mission dont vous voulez préparer le compte rendu : le template d’une fiche déjà créée se modifie, une page vide se remplit de zéro, et vous pouvez aussi reprendre le template d’une autre mission. Besoin d’un coup de main ? Touchez le <strong>?</strong> en haut à droite.
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
          <button type="button" class="btn te__b" :disabled="saving || !online || !dirty || (mode === 'code' && codeProblems.length > 0)" @click="save">
            <NavIcon name="save" :size="18" /> {{ saving ? 'Enregistrement…' : 'Enregistrer dans Notion' }}
          </button>
        </div>
      </div>

      <form v-if="importOpen" class="te__import card te__gap" @submit.prevent="doImport(false)">
        <label for="te-imp" class="small">Reprendre le template d’une autre mission :</label>
        <div class="te__open te__open--wrap">
          <input id="te-imp" v-model="importRef" class="input te__ref" placeholder="Référence, par exemple FI-240" autocomplete="off" autocapitalize="characters" />
          <button type="submit" class="btn btn--ghost" :disabled="importing || !online">{{ importing ? 'Lecture…' : 'Ajouter à la suite' }}</button>
          <button type="button" class="btn btn--ghost" :disabled="importing || !online" @click="doImport(true)">Tout remplacer</button>
        </div>
      </form>
      <p v-if="importMsg" class="note small te__gap" role="status">{{ importMsg }}</p>

      <p v-if="saveMsg" class="note te__gap" role="status">{{ saveMsg }}</p>
      <ul v-if="saveWarn.length" class="alert te__gap te__warn" role="alert"><li v-for="(w, i) in saveWarn" :key="i">{{ w }}</li></ul>
      <p v-if="mission.outside" class="note small te__gap">
        {{ mission.outside }} bloc{{ mission.outside > 1 ? 's' : '' }} de la page se trouve{{ mission.outside > 1 ? 'nt' : '' }} en dehors du toggle « Template » : à modifier dans Notion.
      </p>
      <p v-if="showErrors && errorCount && mode === 'visual'" class="alert te__gap" role="alert">{{ errorCount }} élément{{ errorCount > 1 ? 's' : '' }} à corriger avant d’enregistrer (signalé{{ errorCount > 1 ? 's' : '' }} en dessous).</p>

      <div v-if="mode === 'visual'" class="te__cols te__gap">
        <ol class="te__list" aria-label="Éléments du template">
          <li v-if="!items.length" class="te__none card">
            <p><strong>Ce template est vide.</strong> Partez de zéro avec le menu « Ajouter », ou reprenez celui d’une autre mission.</p>
            <p class="te__row"><button type="button" class="btn btn--ghost te__b" @click="importOpen = true"><NavIcon name="import" :size="18" /> Reprendre un template existant</button></p>
          </li>
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

      <section v-else class="te__code te__gap" aria-label="Template en code">
        <textarea
          v-model="codeText" class="input te__area" :class="{ 'te__area--err': codeProblems.length }" spellcheck="false" autocomplete="off" autocapitalize="off"
          aria-label="Code du template" aria-describedby="te-code-state" @input="onCode"
        ></textarea>
        <div id="te-code-state" class="te__state" role="status">
          <p v-if="!codeProblems.length" class="note small">✓ Code valide · {{ items.length }} élément{{ items.length > 1 ? 's' : '' }}{{ dirty ? ' · modifications à enregistrer' : '' }}</p>
          <ul v-else class="alert small te__warn" role="alert">
            <li v-for="(p, i) in codeProblems.slice(0, 8)" :key="i"><strong>Ligne {{ p.line }}</strong> : {{ p.message }}</li>
            <li v-if="codeProblems.length > 8">… et {{ codeProblems.length - 8 }} autre{{ codeProblems.length - 8 > 1 ? 's' : '' }}.</li>
          </ul>
          <button type="button" class="btn btn--ghost te__b" @click="copyCode"><NavIcon name="copy" :size="18" /> {{ copied ? 'Copié' : 'Copier le code' }}</button>
        </div>
      </section>
    </template>

    <TemplateHelp v-if="showHelp" @close="showHelp = false" />
  </section>
</template>

<style scoped>
.te__top { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-3); }
.te__title { margin: 0; }
.te__mode { display: inline-flex; margin-left: auto; border: 1px solid var(--line-strong); border-radius: 999px; overflow: hidden; background: var(--surface); }
.te__seg { display: inline-flex; align-items: center; gap: var(--s-2); min-height: 40px; padding: 0 var(--s-4); border: 0; background: transparent; color: var(--accent); font: 600 var(--fs-small)/1 var(--f-body); cursor: pointer; }
.te__seg--on { background: var(--accent); color: var(--surface); }
.te__seg:not(.te__seg--on):hover { background: var(--surface-2); }
.te__open--wrap { flex-wrap: wrap; }
.te__row { margin: var(--s-2) 0 0; }
.te__code { display: grid; gap: var(--s-3); }
.te__area { width: 100%; min-height: 55vh; padding: var(--s-3); font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; white-space: pre; overflow: auto; resize: vertical; }
.te__area--err { border-color: var(--danger); }
.te__state { display: grid; gap: var(--s-2); justify-items: start; }
.te__state > * { margin: 0; max-width: 100%; }
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
