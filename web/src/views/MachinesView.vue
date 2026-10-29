<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { machines } from '../lib/methodsApp.js'
import { machinesCatalog } from '../db.js'
import { groupMachines, machineTone, inactiveCount } from '../lib/machines.js'
import { online } from '../lib/online.js'
import { formatDateTime } from '../lib/format.js'

const items = ref([])
const fetchedAt = ref(null)
const loading = ref(true)
const error = ref('')
const stale = ref('')
const query = ref('')
const showInactive = ref(false)
const cached = ref(new Set())
const stats = ref({ items: 0, media: 0, bytes: 0 })
const dl = ref({ running: false, n: 0, total: 0, result: null })

const groups = computed(() => groupMachines(items.value, query.value, { showInactive: showInactive.value }))
const searching = computed(() => query.value.trim().length > 0)
const total = computed(() => items.value.length)
const hidden = computed(() => (showInactive.value ? 0 : inactiveCount(items.value)))
const mb = computed(() => (stats.value.bytes / 1048576).toFixed(1).replace('.', ','))

const MESSAGES = {
  OFFLINE_EMPTY: 'Pas de réseau et aucune machine n’est encore sur cet appareil. Ouvrez cette page une première fois avec du réseau.',
  NOTION_FORBIDDEN: 'Notion refuse l’accès à la base des machines. Vérifiez que l’intégration est connectée à cette base.'
}

async function refreshLocal() {
  cached.value = await machinesCatalog.listCachedIds()
  stats.value = await machinesCatalog.stats()
}

async function load() {
  loading.value = true
  error.value = ''
  stale.value = ''
  try {
    const r = await machines.loadList()
    items.value = r.items
    fetchedAt.value = r.fetchedAt
    if (r.error === 'OFFLINE_EMPTY') error.value = MESSAGES.OFFLINE_EMPTY
    else if (r.error) stale.value = 'Liste affichée depuis la copie de l’appareil (le serveur ne répond pas).'
  } catch (e) {
    error.value = MESSAGES[e.code] || e.message
  } finally {
    loading.value = false
  }
  await refreshLocal()
}

async function downloadAll() {
  dl.value = { running: true, n: 0, total: items.value.length, result: null }
  const result = await machines.prefetchAll(items.value, { onProgress: ({ n, total }) => { dl.value.n = n; dl.value.total = total } })
  dl.value = { ...dl.value, running: false, result }
  await refreshLocal()
}

async function clearAll() {
  if (!window.confirm('Retirer les machines téléchargées de cet appareil ? Vos CR ne sont pas touchés.')) return
  await machinesCatalog.clear()
  items.value = []
  await load()
}

onMounted(load)
watch(online, (on) => { if (on && !dl.value.running) load() })
</script>

<template>
  <h2>Liste des machines</h2>
  <p class="muted">Adresse, accès, Wi-Fi et infos utiles de chaque site. Ouvrez une machine avec du réseau : elle reste ensuite lisible sans.</p>

  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-else-if="stale" class="note small" role="status">{{ stale }}</p>

  <div v-if="total" class="tools">
    <div class="field search">
      <label for="mcq" class="sr-only">Rechercher une machine</label>
      <input id="mcq" v-model="query" class="input" type="search" placeholder="Rechercher : ville, nom, projet…" autocomplete="off" enterkeyhint="search" />
    </div>
    <label v-if="inactiveCount(items)" class="check">
      <input v-model="showInactive" type="checkbox" />
      <span>Afficher les machines hors exploitation ({{ inactiveCount(items) }})</span>
    </label>
  </div>

  <p v-if="loading && !total" class="muted" role="status">Chargement des machines…</p>

  <section v-for="g in groups" :key="g.group" class="group">
    <details open class="group__box">
      <summary class="group__head">
        <span class="group__name">{{ g.group }}</span>
        <span class="chip">{{ g.items.length }}</span>
      </summary>
      <ul class="list">
        <li v-for="m in g.items" :key="m.id">
          <router-link :to="{ name: 'machine', params: { id: m.id } }" class="row">
            <span class="row__main">
              <span class="row__title">{{ m.title }}</span>
              <span class="small muted">{{ [m.city, m.project].filter(Boolean).join(' · ') || m.address }}</span>
            </span>
            <span class="row__side">
              <span v-if="m.active === false" class="chip">Hors exploitation</span>
              <span v-else-if="m.status" class="chip" :class="'chip--' + machineTone(m.status)">{{ m.status }}</span>
              <span v-if="cached.has(m.id)" class="small muted" title="Disponible hors ligne">✓ hors ligne</span>
            </span>
          </router-link>
        </li>
      </ul>
    </details>
  </section>
  <p v-if="total && !groups.length" class="muted">Aucune machine ne correspond à « {{ query }} ».</p>
  <p v-if="hidden && groups.length" class="small muted">{{ hidden }} machine(s) hors exploitation masquée(s).</p>

  <section v-if="total" class="card offline" aria-labelledby="mc-off-title">
    <h3 id="mc-off-title">Hors ligne</h3>
    <p class="small muted">
      {{ cached.size }} machine(s) sur {{ total }} disponible(s) sans réseau<span v-if="stats.media"> · {{ stats.media }} photo(s), {{ mb }} Mo</span>.
      <span v-if="fetchedAt"> Liste vérifiée le {{ formatDateTime(fetchedAt) }}.</span>
    </p>
    <p class="small muted">Les codes (boîte à clés, Wi-Fi) téléchargés sont gardés sur cet appareil : verrouillez-le.</p>
    <p v-if="dl.running" class="small" role="status">Téléchargement… {{ dl.n }} / {{ dl.total }}</p>
    <p v-else-if="dl.result" class="small" role="status">
      Terminé : {{ dl.result.items }} machine(s), {{ dl.result.images }} nouvelle(s) photo(s)<span v-if="dl.result.failed">, {{ dl.result.failed }} échec(s) : réessayez</span>.
    </p>
    <div class="actions">
      <button class="btn" :disabled="!online || dl.running" @click="downloadAll">{{ dl.running ? 'Téléchargement…' : 'Tout télécharger pour le hors-ligne' }}</button>
      <button class="btn btn--ghost" :disabled="dl.running" @click="clearAll">Libérer l’espace</button>
    </div>
    <p v-if="!online" class="small muted">Disponible avec du réseau.</p>
  </section>
</template>

<style scoped>
.tools { margin-top: var(--s-4); }
.check { display: flex; align-items: center; gap: var(--s-3); min-height: var(--tap); cursor: pointer; }
.check input { width: 22px; height: 22px; accent-color: var(--accent); }
.group { margin-top: var(--s-3); }
.group__box { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.group__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--tap); padding: var(--s-2) var(--s-4); cursor: pointer; list-style: none; }
.group__head::-webkit-details-marker { display: none; }
.group__name { font: 700 26px/1 var(--f-display); letter-spacing: 0.02em; color: var(--heading); }
.list { list-style: none; margin: 0; padding: 0 var(--s-3) var(--s-3); display: grid; gap: var(--s-2); }
.row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--tap); padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); color: var(--text); text-decoration: none; }
.row:hover { border-color: var(--accent); }
.row__main { display: grid; min-width: 0; gap: 2px; }
.row__title { font-weight: 600; overflow-wrap: anywhere; }
.row__side { display: grid; justify-items: end; gap: 4px; flex: none; }
.offline { margin-top: var(--s-6); }
.actions { display: flex; gap: var(--s-3); flex-wrap: wrap; }
</style>
