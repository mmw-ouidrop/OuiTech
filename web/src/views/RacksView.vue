<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { racks } from '../lib/racksApp.js'
import { filterSites } from '../lib/racks.js'
import { online } from '../lib/online.js'
import { doneTick } from '../lib/outboxApp.js'
import { formatDateTime } from '../lib/format.js'

const data = ref(null)
const fetchedAt = ref(null)
const loading = ref(true)
const error = ref('')
const stale = ref('')
const query = ref('')

const sites = computed(() => filterSites(data.value ? data.value.sites : [], query.value))
const total = computed(() => (data.value ? data.value.total : 0))

const MESSAGES = {
  OFFLINE_EMPTY: 'Pas de réseau et aucune liste n’est encore sur cet appareil. Ouvrez cette page une première fois avec du réseau.',
  NOTION_FORBIDDEN: 'Notion refuse l’accès à la base des racks et casiers. Vérifiez que l’intégration y est connectée.',
  CONFIG_INVALID: 'Configuration de la base des racks incorrecte (voir la propriété RACKS_PROP_STATE).'
}

const countText = (s) => [
  s.casiers ? `${s.casiers} casier${s.casiers > 1 ? 's' : ''}` : '',
  s.racks ? `${s.racks} rack${s.racks > 1 ? 's' : ''}` : '',
  s.autres ? `${s.autres} autre${s.autres > 1 ? 's' : ''}` : ''
].filter(Boolean).join(' · ')

async function load() {
  loading.value = true
  error.value = ''
  stale.value = ''
  try {
    const r = await racks.loadOverview()
    data.value = r.data
    fetchedAt.value = r.fetchedAt
    if (r.error === 'OFFLINE_EMPTY') error.value = MESSAGES.OFFLINE_EMPTY
    else if (r.error) stale.value = 'Liste affichée depuis la copie de l’appareil (le serveur ne répond pas).'
  } catch (e) {
    error.value = MESSAGES[e.code] || e.message
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(online, (on) => { if (on) load() })
watch(doneTick, load)
</script>

<template>
  <h2>Racks et casiers KO</h2>
  <p class="muted">Choisissez le site où vous intervenez : vous verrez ses casiers et racks KO à diagnostiquer.</p>

  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-else-if="stale" class="note small" role="status">{{ stale }}</p>

  <div v-if="data && data.sites.length > 4" class="field search">
    <label for="rq" class="sr-only">Rechercher un site</label>
    <input id="rq" v-model="query" class="input" type="search" placeholder="Rechercher un site…" autocomplete="off" enterkeyhint="search" />
  </div>

  <p v-if="loading && !data" class="muted" role="status">Chargement…</p>
  <p v-if="data && !data.sites.length" class="card">Aucun rack ni casier KO. 🎉</p>

  <ul v-if="sites.length" class="list">
    <li v-for="s in sites" :key="s.id || 'none'">
      <router-link :to="{ name: 'rack-site', params: { site: s.id || 'none' } }" class="row">
        <span class="row__main">
          <span class="row__title">{{ s.title }}</span>
          <span class="small muted">{{ countText(s) }}</span>
        </span>
        <span class="row__side">
          <span class="row__num" aria-label="KO">{{ s.total }}</span>
          <span class="small muted">{{ s.diagnosed }}/{{ s.total }} diagnostiqué{{ s.diagnosed > 1 ? 's' : '' }}</span>
        </span>
      </router-link>
    </li>
  </ul>
  <p v-else-if="data && data.sites.length" class="muted">Aucun site ne correspond à « {{ query }} ».</p>

  <p v-if="fetchedAt" class="small muted foot">{{ total }} élément(s) KO · vérifié le {{ formatDateTime(fetchedAt) }}</p>
</template>

<style scoped>
.search { margin-top: var(--s-4); }
.list { list-style: none; margin: var(--s-4) 0 0; padding: 0; display: grid; gap: var(--s-3); }
.row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: 72px; padding: var(--s-3) var(--s-4); border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); color: var(--text); text-decoration: none; }
.row:hover { border-color: var(--accent); }
.row__main { display: grid; min-width: 0; gap: 2px; }
.row__title { font: 700 24px/1.1 var(--f-display); color: var(--heading); overflow-wrap: anywhere; }
.row__side { display: grid; justify-items: end; gap: 2px; flex: none; text-align: right; }
.row__num { font: 700 34px/1 var(--f-display); color: var(--heading); }
.foot { margin-top: var(--s-4); }
</style>
