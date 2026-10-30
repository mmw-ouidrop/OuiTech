<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { racks } from '../lib/racksApp.js'
import { getRacksSite } from '../db.js'
import { splitByKind, overlayPending, needsDiagnosis, KIND_LABELS } from '../lib/racks.js'
import { pendingEntries, doneTick } from '../lib/outboxApp.js'
import { named } from '../lib/session.js'
import { online } from '../lib/online.js'
import { formatDateTime } from '../lib/format.js'
import RackItem from '../components/RackItem.vue'

const props = defineProps({ site: { type: String, required: true } })

const data = ref(null)
const loading = ref(true)
const error = ref('')
const stale = ref('')
const tab = ref('casier')
const hideDone = ref(false)
const all = ref(false)          // true : tous les états (KO, Diag tech, Remis, Dead…)
const stateFilter = ref('')     // en mode « tous les états » : un état précis, '' = tous

const states = computed(() => (data.value ? data.value.states : []))
const meta = computed(() => ({ diagState: data.value ? data.value.diagState : '', koStates: data.value ? data.value.koStates || [] : [] }))
const items = computed(() => overlayPending(data.value ? data.value.items : [], pendingEntries.value, states.value, (ts) => formatDateTime(ts), meta.value))
const byState = computed(() => items.value.filter((i) => !all.value || !stateFilter.value || i.state === stateFilter.value))
const groups = computed(() => splitByKind(byState.value))
const tabs = computed(() => ['casier', 'rack', 'autre'].filter((k) => k !== 'autre' || groups.value.autre.length))
const shown = computed(() => groups.value[tab.value].filter((i) => !hideDone.value || needsDiagnosis(i)))
const todo = (k) => groups.value[k].filter(needsDiagnosis).length
const siteTitle = computed(() => (data.value ? data.value.site.title : ''))
const stateChips = computed(() => {
  const present = new Set(items.value.map((i) => i.state).filter(Boolean))
  const order = (data.value && data.value.stateOptions) || []
  return [...order.filter((o) => present.has(o)), ...[...present].filter((o) => !order.includes(o))]
})
const countOf = (st) => items.value.filter((i) => i.state === st).length

const MESSAGES = {
  OFFLINE_EMPTY: 'Ce site n’est pas encore sur l’appareil et il n’y a pas de réseau. Ouvrez-le une première fois avec du réseau.',
  NOTION_FORBIDDEN: 'Notion refuse l’accès à la base des racks et casiers.'
}

async function load() {
  loading.value = true
  error.value = ''
  stale.value = ''
  try {
    const r = await racks.loadSite(props.site, { all: all.value })
    data.value = r.data
    if (r.error === 'OFFLINE_EMPTY') error.value = all.value ? 'La liste de tous les états n’est pas encore sur l’appareil : ouvrez-la une première fois avec du réseau.' : MESSAGES.OFFLINE_EMPTY
    else if (r.error) stale.value = 'Liste affichée depuis la copie de l’appareil (le serveur ne répond pas).'
    // Onglet de départ : celui qui contient du travail.
    if (r.data && !groups.value[tab.value].length) tab.value = ['casier', 'rack', 'autre'].find((k) => groups.value[k].length) || 'casier'
  } catch (e) {
    error.value = MESSAGES[e.code] || e.message
  } finally {
    loading.value = false
  }
}

function toggleAll() {
  all.value = !all.value
  stateFilter.value = ''
  load()
}

// Un envoi vient de partir : les copies locales du site ont été mises à jour, on les relit sans réseau.
watch(doneTick, async () => {
  const rec = await getRacksSite(all.value ? props.site + ':all' : props.site)
  if (rec) data.value = rec
})
onMounted(load)
watch(() => props.site, () => { all.value = false; stateFilter.value = ''; load() })
watch(online, (on) => { if (on) load() })
</script>

<template>
  <router-link class="back" :to="{ name: 'racks' }">← Tous les sites</router-link>
  <h2 class="title">{{ siteTitle || 'Site' }}</h2>

  <p v-if="loading && !data" class="muted" role="status">Chargement…</p>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-else-if="stale" class="note small" role="status">{{ stale }}</p>

  <template v-if="data">
    <p v-if="!named" class="note small">Renseignez votre prénom et nom dans <router-link to="/reglages">Réglages</router-link> pour enregistrer des diagnostics.</p>

    <div class="toolbar">
      <label class="check">
        <input type="checkbox" :checked="all" @change="toggleAll" />
        <span>Afficher tous les états</span>
      </label>
      <label v-if="groups[tab].length" class="check">
        <input v-model="hideDone" type="checkbox" />
        <span>Masquer ceux déjà diagnostiqués</span>
      </label>
    </div>

    <div v-if="all && stateChips.length" class="filters" role="group" aria-label="Filtrer par état">
      <button type="button" class="fchip" :class="{ 'fchip--on': !stateFilter }" :aria-pressed="!stateFilter" @click="stateFilter = ''">Tous ({{ items.length }})</button>
      <button v-for="st in stateChips" :key="st" type="button" class="fchip" :class="{ 'fchip--on': stateFilter === st }" :aria-pressed="stateFilter === st" @click="stateFilter = st">{{ st }} ({{ countOf(st) }})</button>
    </div>

    <div class="tabs" role="tablist" aria-label="Type d’élément">
      <button
        v-for="k in tabs" :key="k" type="button" role="tab" class="tab" :class="{ 'tab--on': tab === k }"
        :aria-selected="tab === k" @click="tab = k"
      >
        <span class="tab__name">{{ KIND_LABELS[k] }}</span>
        <span class="tab__count">{{ groups[k].length }}</span>
        <span v-if="todo(k)" class="tab__todo small">{{ todo(k) }} à voir</span>
      </button>
    </div>

    <p v-if="!groups[tab].length" class="card muted">Aucun {{ tab === 'rack' ? 'rack' : tab === 'casier' ? 'casier' : 'élément' }}{{ all ? '' : ' KO' }} sur ce site.</p>
    <p v-else-if="!shown.length" class="card muted">Tout est diagnostiqué ici. ✓</p>

    <ul class="list">
      <RackItem
        v-for="it in shown" :key="it.id" :item="it" :states="states" :state-options="data.stateOptions || []"
        :diag-state="data.diagState || 'Diag tech'" :ko-states="data.koStates || ['KO']"
      />
    </ul>
  </template>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; min-height: var(--tap); color: var(--accent); text-decoration: none; }
.title { margin: var(--s-2) 0 var(--s-3); overflow-wrap: anywhere; }
.tabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: var(--s-2); margin: var(--s-3) 0; }
.tab { display: grid; justify-items: center; gap: 2px; min-height: 76px; padding: var(--s-2); border: 2px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); color: var(--text); cursor: pointer; }
.tab--on { border-color: var(--accent); background: var(--btn-bg); color: var(--btn-text); }
.tab__name { font-weight: 700; }
.tab__count { font: 700 30px/1 var(--f-display); }
.check { display: flex; align-items: center; gap: var(--s-3); min-height: var(--tap); cursor: pointer; }
.check input { width: 22px; height: 22px; accent-color: var(--accent); }
.list { list-style: none; margin: var(--s-2) 0 0; padding: 0; display: grid; gap: var(--s-3); }
.filters { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-2) 0; }
.fchip { min-height: 40px; padding: 0 var(--s-3); border: 2px solid var(--line-strong); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; font-weight: 700; cursor: pointer; }
.fchip--on { border-color: var(--accent); background: var(--btn-bg); color: var(--btn-text); }
.toolbar { display: flex; flex-wrap: wrap; gap: var(--s-4); align-items: center; }
</style>
