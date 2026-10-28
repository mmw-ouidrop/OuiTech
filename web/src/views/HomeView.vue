<script setup>
// Accueil : l'outil du technicien sur site. Accès rapide aux sections, reprise des fiches en cours,
// état de la synchronisation.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { liveQuery } from 'dexie'
import { listInterventions } from '../db.js'
import NavIcon from '../components/NavIcon.vue'
import { visibleNav } from '../lib/nav.js'
import { identity, role, roleLabel, engine, sessionExpired } from '../lib/session.js'
import { online } from '../lib/online.js'
import { missionStatus, formatDateTime } from '../lib/format.js'

const missions = ref([])
let sub
onMounted(() => { sub = liveQuery(listInterventions).subscribe({ next: (rows) => (missions.value = rows) }) })
onUnmounted(() => sub && sub.unsubscribe())

const tiles = computed(() => visibleNav(role.value).filter((n) => n.tile))
const recent = computed(() => missions.value.slice(0, 3))
const pending = computed(() => missions.value.filter((m) => m.needsSync === 1).length)
const hello = computed(() => (identity.value.firstName ? `Bonjour ${identity.value.firstName}` : 'Bonjour'))

const sending = ref(false)
async function sendAll() {
  sending.value = true
  try { await engine.syncPending() } finally { sending.value = false }
}
</script>

<template>
  <section class="hero">
    <h2 class="hero__hello">{{ hello }}</h2>
    <p class="hero__sub"><span class="chip">{{ roleLabel }}</span> Que faites-vous aujourd'hui ?</p>
  </section>

  <section class="card state" aria-label="État de l'application" aria-live="polite">
    <p class="state__line">
      <NavIcon :name="online ? 'wifi' : 'cloud'" />
      <span v-if="online">En ligne.</span>
      <span v-else><strong>Hors ligne.</strong> Tout fonctionne, les envois attendent le réseau.</span>
    </p>
    <p v-if="pending" class="state__line">
      <strong>{{ pending }}</strong> fiche{{ pending > 1 ? 's' : '' }} avec des saisies à envoyer.
      <button v-if="online && !sessionExpired" type="button" class="btn btn--ghost" :disabled="sending" @click="sendAll">{{ sending ? 'Envoi…' : 'Tout envoyer' }}</button>
    </p>
    <p v-else-if="missions.length" class="state__line small muted">Tout est à jour dans Notion.</p>
  </section>

  <nav class="tiles" aria-label="Sections">
    <router-link v-for="t in tiles" :key="t.id" :to="t.to" class="tile">
      <NavIcon :name="t.icon" :size="32" />
      <span class="tile__title">{{ t.label }}</span>
      <span class="tile__desc small">{{ t.desc }}</span>
      <span v-if="t.soon" class="tile__soon">Bientôt</span>
    </router-link>
  </nav>

  <section v-if="recent.length" class="recent" aria-labelledby="recent-title">
    <h3 id="recent-title">Reprendre</h3>
    <ul class="list">
      <li v-for="m in recent" :key="m.id">
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
    <p class="small"><router-link to="/fiches">Toutes les fiches de cet appareil</router-link></p>
  </section>
</template>

<style scoped>
.hero { margin-bottom: var(--s-4); }
.hero__hello { margin-bottom: var(--s-2); }
.hero__sub { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-3); margin: 0; color: var(--text-muted); }
.state { display: grid; gap: var(--s-2); margin-bottom: var(--s-5); }
.state__line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-3); margin: 0; }
.tiles { display: grid; gap: var(--s-3); grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: var(--s-6); }
@media (min-width: 720px) { .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.tile {
  position: relative; display: grid; align-content: start; gap: var(--s-1); min-height: 132px; padding: var(--s-4);
  border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); color: var(--accent); text-decoration: none;
}
.tile:hover { border-color: var(--accent); background: var(--surface-2); }
.tile__title { font: 700 24px/1.05 var(--f-display); color: var(--heading); margin-top: var(--s-2); }
.tile__desc { color: var(--text-muted); }
.tile__soon { position: absolute; top: var(--s-3); right: var(--s-3); font: 600 12px/1 var(--f-body); padding: 4px 8px; border-radius: 999px; background: var(--surface-2); color: var(--heading); border: 1px solid var(--line); }
.list { list-style: none; margin: 0 0 var(--s-3); padding: 0; display: grid; gap: var(--s-3); }
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
