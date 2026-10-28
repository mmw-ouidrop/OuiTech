<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { methods } from '../lib/methodsApp.js'
import { listCachedMethodIds, methodsCacheStats, clearMethodsCache } from '../db.js'
import { groupMethods, statusTone } from '../lib/methods.js'
import { online } from '../lib/online.js'
import { formatDateTime } from '../lib/format.js'

const items = ref([])
const fetchedAt = ref(null)
const loading = ref(true)
const error = ref('')
const stale = ref('')
const query = ref('')
const cached = ref(new Set())
const stats = ref({ methods: 0, media: 0, bytes: 0 })
const dl = ref({ running: false, n: 0, total: 0, result: null })

const groups = computed(() => groupMethods(items.value, query.value))
const searching = computed(() => query.value.trim().length > 0)
const total = computed(() => items.value.length)
const mb = computed(() => (stats.value.bytes / 1048576).toFixed(1).replace('.', ','))

const MESSAGES = {
  OFFLINE_EMPTY: 'Pas de réseau et aucune fiche n’est encore sur cet appareil. Ouvrez cette page une première fois avec du réseau.',
  NOTION_FORBIDDEN: 'Notion refuse l’accès à la base des méthodes. Vérifiez que l’intégration est connectée à cette base.',
  CONFIG_MISSING: 'Configuration du serveur incomplète.'
}

async function refreshLocal() {
  cached.value = await listCachedMethodIds()
  stats.value = await methodsCacheStats()
}

async function load() {
  loading.value = true
  error.value = ''
  stale.value = ''
  try {
    const r = await methods.loadList()
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
  const result = await methods.prefetchAll(items.value, {
    onProgress: ({ n, total }) => { dl.value.n = n; dl.value.total = total }
  })
  dl.value = { ...dl.value, running: false, result }
  await refreshLocal()
}

async function clearAll() {
  if (!window.confirm('Retirer les fiches méthodes téléchargées de cet appareil ? Vos CR ne sont pas touchés.')) return
  await clearMethodsCache()
  items.value = []
  await load()
}

onMounted(load)
watch(online, (on) => { if (on && !dl.value.running) load() })
</script>

<template>
  <h2>Méthodes</h2>
  <p class="muted">Comment réparer, étape par étape. Ouvrez une fiche avec du réseau : elle reste ensuite lisible sans.</p>

  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-else-if="stale" class="note small" role="status">{{ stale }}</p>

  <div class="field search" v-if="total">
    <label for="mq" class="sr-only">Rechercher une méthode</label>
    <input id="mq" v-model="query" class="input" type="search" placeholder="Rechercher : lexium, courroie, snapper…" autocomplete="off" enterkeyhint="search" />
  </div>

  <p v-if="loading && !total" class="muted" role="status">Chargement des fiches…</p>

  <section v-for="g in groups" :key="g.group" class="group">
    <details :open="searching || groups.length === 1" class="group__box">
      <summary class="group__head">
        <span class="group__name">{{ g.group }}</span>
        <span class="chip">{{ g.items.length }}</span>
      </summary>
      <ul class="list">
        <li v-for="m in g.items" :key="m.id">
          <router-link :to="{ name: 'methode', params: { id: m.id } }" class="row">
            <span class="row__main">
              <span class="row__title">{{ m.title }}</span>
              <span v-if="m.summary" class="small muted row__sum">{{ m.summary }}</span>
              <span v-if="m.groups.length > 1" class="small muted">Aussi : {{ m.groups.filter((x) => x !== g.group).join(', ') }}</span>
            </span>
            <span class="row__side">
              <span v-if="m.status" class="chip" :class="'chip--' + statusTone(m.status)">{{ m.status }}</span>
              <span v-if="cached.has(m.id)" class="small muted" title="Disponible hors ligne">✓ hors ligne</span>
            </span>
          </router-link>
        </li>
      </ul>
    </details>
  </section>
  <p v-if="total && !groups.length" class="muted">Aucune méthode ne correspond à « {{ query }} ».</p>

  <section v-if="total" class="card offline" aria-labelledby="off-title">
    <h3 id="off-title">Hors ligne</h3>
    <p class="small muted">
      {{ cached.size }} fiche(s) sur {{ total }} disponible(s) sans réseau<span v-if="stats.media"> · {{ stats.media }} image(s) et fichier(s), {{ mb }} Mo</span>.
      <span v-if="fetchedAt"> Liste vérifiée le {{ formatDateTime(fetchedAt) }}.</span>
    </p>
    <p v-if="dl.running" class="small" role="status">Téléchargement… {{ dl.n }} / {{ dl.total }}</p>
    <p v-else-if="dl.result" class="small" role="status">
      Terminé : {{ dl.result.methods }} fiche(s), {{ dl.result.images }} nouveau(x) fichier(s)<span v-if="dl.result.tooLarge">, {{ dl.result.tooLarge }} trop volumineux (en ligne seulement)</span><span v-if="dl.result.failed">, {{ dl.result.failed }} échec(s) : réessayez</span>.
    </p>
    <div class="actions">
      <button class="btn" :disabled="!online || dl.running" @click="downloadAll">{{ dl.running ? 'Téléchargement…' : 'Tout télécharger pour le hors-ligne' }}</button>
      <button class="btn btn--ghost" :disabled="dl.running" @click="clearAll">Libérer l’espace</button>
    </div>
    <p v-if="!online" class="small muted">Disponible avec du réseau.</p>
  </section>
</template>

<style scoped>
.search { margin-top: var(--s-4); }
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
.row__sum { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row__side { display: grid; justify-items: end; gap: 4px; flex: none; }
.offline { margin-top: var(--s-6); }
.actions { display: flex; gap: var(--s-3); flex-wrap: wrap; }
</style>
