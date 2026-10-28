<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { liveQuery } from 'dexie'
import { listInterventions, findByReference, saveMission } from '../db.js'
import { api } from '../lib/api.js'
import { normalizeReference } from '../lib/ref.js'
import { formatDateTime, missionStatus } from '../lib/format.js'
import { online } from '../lib/online.js'
import { DEFAULT_PREFIX } from '../config.js'

const router = useRouter()
const input = ref('')
const loading = ref(false)
const error = ref('')
const missions = ref([])

let sub
onMounted(() => {
  // La liste se met à jour toute seule dès qu'une fiche change dans IndexedDB.
  sub = liveQuery(listInterventions).subscribe({ next: (rows) => (missions.value = rows) })
})
onUnmounted(() => sub && sub.unsubscribe())

async function open() {
  error.value = ''
  const reference = normalizeReference(input.value, DEFAULT_PREFIX)
  if (!reference) {
    error.value = 'ID non reconnu. Exemple : FI-252.'
    return
  }
  // Hors ligne d'abord : une mission déjà sur l'appareil s'ouvre sans réseau.
  if (await findByReference(reference)) return router.push({ name: 'mission', params: { reference } })

  if (!online.value) {
    error.value = "Pas de réseau. Cette mission n'est pas encore sur l'appareil."
    return
  }
  loading.value = true
  try {
    const mission = await api.getIntervention(reference)
    await saveMission(mission)
    router.push({ name: 'mission', params: { reference: mission.reference } })
  } catch (e) {
    error.value =
      e.code === 'NOT_FOUND' ? `Aucune mission « ${reference} ».` :
      e.code === 'NETWORK' ? "Pas de réseau. Cette mission n'est pas encore sur l'appareil." :
      e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <h2>Fiches et comptes rendus</h2>
  <p class="muted">Ouvrez une fiche d'intervention par son ID pour consulter ses informations et rédiger le compte rendu.</p>

  <form class="card" @submit.prevent="open" novalidate>
    <div class="field">
      <label for="ref">ID de la mission</label>
      <input
        id="ref" v-model="input" class="input input--code"
        placeholder="FI-252" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false"
        enterkeyhint="go" :aria-invalid="!!error" aria-describedby="ref-err"
      />
    </div>
    <p v-if="error" id="ref-err" class="alert" role="alert">{{ error }}</p>
    <button class="btn btn--block" :disabled="loading || !input.trim()">
      {{ loading ? 'Chargement…' : 'Charger la mission' }}
    </button>
  </form>

  <section v-if="missions.length" aria-labelledby="local-title" style="margin-top: var(--s-6)">
    <h3 id="local-title">Sur cet appareil</h3>
    <ul class="list">
      <li v-for="m in missions" :key="m.id">
        <router-link :to="{ name: 'mission', params: { reference: m.reference } }" class="row">
          <span class="row__main">
            <span class="row__ref">{{ m.reference }}</span>
            <span class="row__title">{{ m.title }}</span>
            <span class="small muted">Modifié {{ formatDateTime(m.lastUpdated) }}</span>
          </span>
          <span class="chip" :class="'chip--' + missionStatus(m).tone">{{ missionStatus(m).label }}</span>
        </router-link>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-3);
  min-height: var(--tap); padding: var(--s-3) var(--s-4);
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  color: var(--text); text-decoration: none;
}
.row:hover { border-color: var(--accent); }
.row__main { display: grid; min-width: 0; }
.row__ref { font: 700 28px/1 var(--f-display); letter-spacing: 0.02em; color: var(--heading); }
.row__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
