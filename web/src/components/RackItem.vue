<script setup>
// Un rack / casier : nom, état Notion, dernier diagnostic ; déplié : saisie du diagnostic, historique,
// changement d'état (support) et commentaires Notion. Partagé par la liste d'un site et la recherche.
import { ref, computed } from 'vue'
import DiagnosisForm from './DiagnosisForm.vue'
import RackStateControl from './RackStateControl.vue'
import RackComments from './RackComments.vue'
import { diagTone, stateTone } from '../lib/racks.js'
import { enqueue, retryEntry, discardEntry } from '../lib/outboxApp.js'
import { named, displayName, hasRole } from '../lib/session.js'

const props = defineProps({
  item: { type: Object, required: true },
  states: { type: Array, default: () => [] },          // diagnostics possibles
  stateOptions: { type: Array, default: () => [] },    // états possibles de la colonne Notion
  diagState: { type: String, default: 'Diag tech' },
  koStates: { type: Array, default: () => ['KO'] },
  showSite: { type: Boolean, default: false }
})

const open = ref(false)
const busy = ref(false)
const isSupport = computed(() => hasRole('support'))
const tone = computed(() => stateTone(props.item.state, { diagState: props.diagState, koStates: props.koStates }))

async function saveDiag({ state, comment }) {
  busy.value = true
  try {
    await enqueue('rack_diag', { pageId: props.item.id, state, comment, name: displayName.value })
    open.value = false
  } finally {
    busy.value = false
  }
}

async function setState(state) {
  busy.value = true
  try {
    await enqueue('rack_state', { pageId: props.item.id, state, name: displayName.value })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <li class="item" :class="{ 'item--open': open }">
    <button type="button" class="item__head" :aria-expanded="open" @click="open = !open">
      <span class="item__main">
        <span class="item__name">{{ item.title.trim() }}</span>
        <span v-if="showSite" class="small muted">{{ item.siteTitle }}</span>
        <span v-if="item.cause && item.cause.length" class="item__cause small muted">{{ item.cause.join(', ') }}</span>
      </span>
      <span v-if="item.state" class="chip" :class="'chip--' + tone">{{ item.state }}</span>
    </button>

    <div v-if="item.diag" class="item__diag small">
      <span class="chip" :class="'chip--' + diagTone(item.diag.state, states)">{{ item.diag.state }}</span>
      <span class="muted">{{ item.diag.by }}<template v-if="item.diag.at"> · {{ item.diag.at }}</template></span>
      <span v-if="item.pending === 'pending'" class="chip">En attente d’envoi</span>
      <span v-if="item.pending === 'failed'" class="chip chip--danger">Non envoyé</span>
      <p v-if="item.diag.comment" class="item__comment">{{ item.diag.comment }}</p>
    </div>
    <p v-if="item.statePending" class="small muted">Changement d’état {{ item.statePending === 'failed' ? 'non envoyé' : 'en attente d’envoi' }}.</p>
    <div v-if="item.pending === 'failed' || item.statePending === 'failed'" class="item__fail small">
      <p class="alert">{{ (item.pendingError || item.statePendingError || {}).message }}</p>
      <button type="button" class="btn btn--ghost" @click="retryEntry(item.pending === 'failed' ? item.pendingId : item.statePendingId)">Réessayer</button>
      <button type="button" class="btn btn--ghost" @click="discardEntry(item.pending === 'failed' ? item.pendingId : item.statePendingId)">Supprimer</button>
    </div>

    <template v-if="open">
      <p v-if="!named" class="note small">Renseignez votre nom dans <router-link to="/reglages">Réglages</router-link> pour enregistrer.</p>
      <DiagnosisForm v-else :states="states" :busy="busy" @submit="saveDiag" @cancel="open = false" />
      <RackStateControl v-if="isSupport && named && stateOptions.length" :state="item.state" :options="stateOptions" :busy="busy" @apply="setState" />
      <details v-if="item.history && item.history.length" class="item__hist small">
        <summary>Historique ({{ item.history.length }})</summary>
        <ul>
          <li v-for="(h, i) in item.history" :key="i"><strong>{{ h.state }}</strong> · {{ h.by }} · {{ h.at }}<span v-if="h.comment"> — {{ h.comment }}</span></li>
        </ul>
      </details>
      <RackComments :page-id="item.id" />
    </template>
  </li>
</template>

<style scoped>
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
