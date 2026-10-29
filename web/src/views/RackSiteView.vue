<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { racks } from '../lib/racksApp.js'
import { getRacksSite } from '../db.js'
import { splitByKind, overlayPending, diagTone, needsDiagnosis, KIND_LABELS } from '../lib/racks.js'
import { enqueue, pendingEntries, retryEntry, discardEntry, doneTick } from '../lib/outboxApp.js'
import { named, displayName } from '../lib/session.js'
import { online } from '../lib/online.js'
import { formatDateTime } from '../lib/format.js'
import DiagnosisForm from '../components/DiagnosisForm.vue'

const props = defineProps({ site: { type: String, required: true } })

const data = ref(null)
const loading = ref(true)
const error = ref('')
const stale = ref('')
const tab = ref('casier')
const openId = ref('')
const busy = ref(false)
const hideDone = ref(false)

const states = computed(() => (data.value ? data.value.states : []))
const items = computed(() => overlayPending(data.value ? data.value.items : [], pendingEntries.value, states.value, (ts) => formatDateTime(ts)))
const groups = computed(() => splitByKind(items.value))
const tabs = computed(() => ['casier', 'rack', 'autre'].filter((k) => k !== 'autre' || groups.value.autre.length))
const shown = computed(() => groups.value[tab.value].filter((i) => !hideDone.value || needsDiagnosis(i)))
const todo = (k) => groups.value[k].filter(needsDiagnosis).length
const siteTitle = computed(() => (data.value ? data.value.site.title : ''))

const MESSAGES = {
  OFFLINE_EMPTY: 'Ce site n’est pas encore sur l’appareil et il n’y a pas de réseau. Ouvrez-le une première fois avec du réseau.',
  NOTION_FORBIDDEN: 'Notion refuse l’accès à la base des racks et casiers.'
}

async function load() {
  loading.value = true
  error.value = ''
  stale.value = ''
  try {
    const r = await racks.loadSite(props.site)
    data.value = r.data
    if (r.error === 'OFFLINE_EMPTY') error.value = MESSAGES.OFFLINE_EMPTY
    else if (r.error) stale.value = 'Liste affichée depuis la copie de l’appareil (le serveur ne répond pas).'
    // Onglet de départ : celui qui contient du travail.
    if (r.data && !groups.value[tab.value].length) tab.value = ['casier', 'rack', 'autre'].find((k) => groups.value[k].length) || 'casier'
  } catch (e) {
    error.value = MESSAGES[e.code] || e.message
  } finally {
    loading.value = false
  }
}

async function save(item, { state, comment }) {
  busy.value = true
  try {
    await enqueue('rack_diag', { pageId: item.id, state, comment, name: displayName.value })
    openId.value = ''
  } finally {
    busy.value = false
  }
}

// Un envoi vient de partir : la copie locale du site a été mise à jour, on la relit sans réseau.
watch(doneTick, async () => {
  const rec = await getRacksSite(props.site)
  if (rec) data.value = rec
})
onMounted(load)
watch(() => props.site, load)
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

    <div class="tabs" role="tablist" aria-label="Type d’élément">
      <button
        v-for="k in tabs" :key="k" type="button" role="tab" class="tab" :class="{ 'tab--on': tab === k }"
        :aria-selected="tab === k" @click="tab = k; openId = ''"
      >
        <span class="tab__name">{{ KIND_LABELS[k] }}</span>
        <span class="tab__count">{{ groups[k].length }}</span>
        <span v-if="todo(k)" class="tab__todo small">{{ todo(k) }} à voir</span>
      </button>
    </div>

    <label v-if="groups[tab].length" class="check">
      <input v-model="hideDone" type="checkbox" />
      <span>Masquer ceux déjà diagnostiqués</span>
    </label>

    <p v-if="!groups[tab].length" class="card muted">Aucun {{ tab === 'rack' ? 'rack' : tab === 'casier' ? 'casier' : 'élément' }} KO sur ce site.</p>
    <p v-else-if="!shown.length" class="card muted">Tout est diagnostiqué ici. ✓</p>

    <ul class="list">
      <li v-for="it in shown" :key="it.id" class="item" :class="{ 'item--open': openId === it.id }">
        <button type="button" class="item__head" :aria-expanded="openId === it.id" @click="openId = openId === it.id ? '' : it.id">
          <span class="item__main">
            <span class="item__name">{{ it.title.trim() }}</span>
            <span v-if="it.cause.length" class="item__cause small muted">{{ it.cause.join(', ') }}</span>
          </span>
          <span v-if="it.diag" class="chip" :class="'chip--' + diagTone(it.diag.state, states)">{{ it.diag.state }}</span>
          <span v-else class="chip chip--danger">À diagnostiquer</span>
        </button>

        <div v-if="it.diag" class="item__diag small">
          <span class="muted">{{ it.diag.by }}<template v-if="it.diag.at"> · {{ it.diag.at }}</template></span>
          <span v-if="it.pending === 'pending'" class="chip">En attente d’envoi</span>
          <span v-if="it.pending === 'failed'" class="chip chip--danger">Non envoyé</span>
          <p v-if="it.diag.comment" class="item__comment">{{ it.diag.comment }}</p>
        </div>
        <div v-if="it.pending === 'failed'" class="item__fail small">
          <p class="alert">{{ it.pendingError && it.pendingError.message }}</p>
          <button type="button" class="btn btn--ghost" @click="retryEntry(it.pendingId)">Réessayer</button>
          <button type="button" class="btn btn--ghost" @click="discardEntry(it.pendingId)">Supprimer</button>
        </div>

        <template v-if="openId === it.id">
          <p v-if="!named" class="note small">Renseignez votre nom dans Réglages pour enregistrer.</p>
          <DiagnosisForm v-else :states="states" :busy="busy" @submit="save(it, $event)" @cancel="openId = ''" />
          <details v-if="it.history && it.history.length" class="item__hist small">
            <summary>Historique ({{ it.history.length }})</summary>
            <ul>
              <li v-for="(h, i) in it.history" :key="i"><strong>{{ h.state }}</strong> · {{ h.by }} · {{ h.at }}<span v-if="h.comment"> — {{ h.comment }}</span></li>
            </ul>
          </details>
        </template>
      </li>
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
.item { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); padding: var(--s-2) var(--s-3) var(--s-3); }
.item--open { border-color: var(--accent); }
.item__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); width: 100%; min-height: var(--tap); padding: var(--s-2) 0; background: none; border: 0; color: var(--text); text-align: left; cursor: pointer; font: inherit; }
.item__main { display: grid; min-width: 0; }
.item__name { font: 700 26px/1.1 var(--f-display); color: var(--heading); overflow-wrap: anywhere; }
.item__diag { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.item__comment { flex-basis: 100%; margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.item__fail { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; margin-top: var(--s-2); }
.item__fail .alert { flex-basis: 100%; margin: 0; }
.item__hist { margin-top: var(--s-3); }
.item__hist ul { margin: var(--s-2) 0 0; padding-left: var(--s-4); }
</style>
