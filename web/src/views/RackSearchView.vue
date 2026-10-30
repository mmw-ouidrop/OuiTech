<script setup>
// Recherche d'un rack / casier par son numéro, avec filtres : site, état, type. Accessible depuis le bouton loupe de l'en-tête.
import { ref, computed, onMounted, watch } from 'vue'
import { racks } from '../lib/racksApp.js'
import { overlayPending } from '../lib/racks.js'
import { pendingEntries, doneTick } from '../lib/outboxApp.js'
import { online } from '../lib/online.js'
import { formatDateTime } from '../lib/format.js'
import RackItem from '../components/RackItem.vue'

const q = ref('')
const site = ref('')
const state = ref('')        // '' = à traiter (KO + Diag tech) · '*' = tous · sinon un état
const kind = ref('')
const sites = ref([])
const res = ref(null)
const loading = ref(false)
const error = ref('')
let timer = null
let seq = 0

const meta = computed(() => ({ diagState: res.value ? res.value.diagState : '', koStates: res.value ? res.value.koStates || [] : [] }))
const items = computed(() => overlayPending(res.value ? res.value.items : [], pendingEntries.value, res.value ? res.value.states : [], (ts) => formatDateTime(ts), meta.value))
const hasCriteria = computed(() => !!(q.value.trim() || site.value || kind.value || state.value === '*'))
const options = computed(() => (res.value && res.value.stateOptions) || [])

async function run() {
  if (!hasCriteria.value) { res.value = res.value ? { ...res.value, items: [] } : null; error.value = ''; return }
  const mine = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await racks.search({ q: q.value.trim(), site: site.value, state: state.value, kind: kind.value })
    if (mine === seq) res.value = r
  } catch (e) {
    if (mine === seq) error.value = e.message
  } finally {
    if (mine === seq) loading.value = false
  }
}

// Saisie : on attend la fin de la frappe.
function later() { clearTimeout(timer); timer = setTimeout(run, 350) }
function reset() { q.value = ''; site.value = ''; state.value = ''; kind.value = ''; run() }

onMounted(async () => {
  const o = await racks.loadOverview().catch(() => null)
  sites.value = o && o.data ? o.data.sites.filter((s) => s.id).sort((a, b) => a.title.localeCompare(b.title, 'fr')) : []
  // Au premier affichage : les éléments à traiter (sans critère, on ne liste rien).
})
watch([site, state, kind], run)
watch(online, (on) => { if (on) run() })
watch(doneTick, run)
</script>

<template>
  <h2>Rechercher un rack / casier</h2>

  <form class="sf" role="search" @submit.prevent="run">
    <div class="field">
      <label for="sq">Numéro ou nom</label>
      <input id="sq" v-model="q" class="input sf__q" type="search" inputmode="search" placeholder="ex. 14, 110, rack 1141…" autocomplete="off" enterkeyhint="search" autofocus @input="later" />
    </div>
    <div class="sf__grid">
      <div class="field">
        <label for="ss">Site</label>
        <select id="ss" v-model="site" class="input">
          <option value="">Tous les sites</option>
          <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.title }}</option>
          <option value="none">Sans site</option>
        </select>
      </div>
      <div class="field">
        <label for="se">État</label>
        <select id="se" v-model="state" class="input">
          <option value="">À traiter (KO, Diag tech)</option>
          <option value="*">Tous les états</option>
          <option v-for="o in options" :key="o" :value="o">{{ o }}</option>
        </select>
      </div>
      <div class="field">
        <label for="sk">Type</label>
        <select id="sk" v-model="kind" class="input">
          <option value="">Casiers et racks</option>
          <option value="casier">Casiers</option>
          <option value="rack">Racks</option>
        </select>
      </div>
    </div>
    <button type="button" class="btn btn--ghost" @click="reset">Effacer</button>
  </form>

  <p v-if="res && res.offline" class="note small" role="status">Hors ligne : recherche limitée aux {{ res.sitesOnDevice }} site(s) déjà ouverts sur cet appareil.</p>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="loading" class="muted" role="status">Recherche…</p>
  <p v-else-if="!hasCriteria" class="muted">Tapez un numéro, ou choisissez un site, un état ou un type.</p>
  <p v-else-if="res && !items.length && !error" class="card muted">Aucun résultat.</p>

  <ul v-if="items.length" class="list">
    <RackItem
      v-for="it in items" :key="it.id" :item="it" :show-site="true" :states="res.states || []" :state-options="options"
      :diag-state="res.diagState || 'Diag tech'" :ko-states="res.koStates || ['KO']"
    />
  </ul>
  <p v-if="res && res.truncated" class="small muted">Beaucoup de résultats : seuls les 100 premiers sont affichés, précisez la recherche.</p>
</template>

<style scoped>
.sf { display: grid; gap: var(--s-3); margin: var(--s-3) 0 var(--s-4); }
.sf__q { width: 100%; font-size: 22px; min-height: 56px; }
.sf__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--s-3); }
.sf .btn { justify-self: start; }
.list { list-style: none; margin: var(--s-3) 0 0; padding: 0; display: grid; gap: var(--s-3); }
</style>
