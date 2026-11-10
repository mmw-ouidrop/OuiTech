<script setup>
// Actions à réaliser sur la machine (pages Notion liées à la fiche) : le technicien lit la consigne, choisit un état
// et/ou écrit un commentaire. Tout est déposé dans les commentaires de la page Action, via la file d'envoi (hors ligne OK).
import { reactive, ref, computed, watch, onMounted } from 'vue'
import FileTiles from './FileTiles.vue'
import DictationButton from './DictationButton.vue'
import { enqueue, pendingEntries, retryEntry, doneTick } from '../lib/outboxApp.js'
import { named, displayName } from '../lib/session.js'
import { getIntervention, logActionEntry, missionMediaStore } from '../db.js'
import { api } from '../lib/api.js'
import { online } from '../lib/online.js'
import { createMediaService } from '../lib/methods.js'
import { mergeText } from '../lib/dictation.js'
import { ACTION_STATES, stateLabel, currentState, progress } from '../lib/actions.js'
import { formatDateTime } from '../lib/format.js'

const props = defineProps({
  missionId: { type: String, required: true },
  reference: { type: String, required: true },
  actions: { type: Array, default: () => [] }
})

const MAX = 1500
const log = ref({})
const drafts = reactive({})            // actionId → { state, text }
const busy = reactive({})
const open = reactive({})
const service = computed(() => createMediaService({
  store: missionMediaStore,
  api: { media: (a) => api.missionMedia({ ...a, mission: props.missionId }) },
  isOnline: () => online.value
}))

const draft = (id) => (drafts[id] = drafts[id] || { state: '', text: '' })
const stat = computed(() => progress(props.actions, log.value))
const failedIds = computed(() => new Set(pendingEntries.value.filter((e) => e.status === 'failed').map((e) => e.id)))
const isFailed = (entryId) => failedIds.value.has(entryId)

async function reload() {
  const rec = await getIntervention(props.missionId)
  log.value = (rec && rec.actionLog) || {}
}
onMounted(reload)
watch(doneTick, reload)
watch(() => props.missionId, reload)

function pick(a, value) {
  const d = draft(a.id)
  d.state = d.state === value ? '' : value
}

let base = ''
const onListening = (id) => (on) => { if (on) base = draft(id).text }
const onDictation = (id) => (session) => { draft(id).text = mergeText(base, session.split('\n').join(' ')).slice(0, MAX) }

async function send(a) {
  const d = draft(a.id)
  const text = d.text.trim()
  if ((!d.state && !text) || busy[a.id] || !named.value) return
  busy[a.id] = true
  try {
    const at = Date.now()
    const entry = await enqueue('action_comment', {
      missionId: props.missionId, pageId: a.id, reference: props.reference, state: d.state, text, name: displayName.value, at
    })
    log.value = (await logActionEntry(props.missionId, a.id, { id: entry.id, state: d.state, text, by: displayName.value, at })) || log.value
    d.state = ''
    d.text = ''
  } finally {
    busy[a.id] = false
  }
}
const sentLabel = (e) => (e.sent ? 'Envoyé' : isFailed(e.id) ? 'Non envoyé' : 'En attente d’envoi')
</script>

<template>
  <section v-if="actions.length" class="acts card" aria-labelledby="acts-title">
    <h3 id="acts-title" class="acts__title">
      Actions à réaliser
      <span class="chip">{{ stat.done }} / {{ stat.total }}</span>
    </h3>
    <p v-if="!named" class="note small">Renseignez votre prénom et nom dans <router-link to="/reglages">Réglages</router-link> pour envoyer un état ou un commentaire.</p>

    <details v-for="a in actions" :key="a.id" class="act" :open="open[a.id]" @toggle="open[a.id] = $event.target.open">
      <summary class="act__sum">
        <span class="act__name">{{ a.title }}</span>
        <span v-if="currentState(log[a.id])" class="chip" :class="'chip--' + currentState(log[a.id])">{{ stateLabel(currentState(log[a.id])) }}</span>
        <span v-else class="chip chip--none">Sans état</span>
      </summary>

      <div class="act__body">
        <p class="act__meta small muted">
          <span v-if="a.type">{{ a.type }}</span><span v-if="a.time"> · ⏱ {{ a.time }}</span>
        </p>
        <p v-if="a.description" class="act__desc">{{ a.description }}</p>
        <p v-if="a.tools" class="act__tools small"><strong>Matériel / outillage :</strong> {{ a.tools }}</p>
        <div v-if="a.files && a.files.length" class="act__files">
          <FileTiles :page-id="a.id" :files="a.files" :service="service" />
        </div>
        <p v-for="l in a.links" :key="l.label" class="act__links small">
          <strong>{{ l.label }} :</strong>
          <span v-for="(it, i) in l.items" :key="i" class="chip chip--link">{{ it }}</span>
          <span v-if="l.total > l.items.length" class="muted"> + {{ l.total - l.items.length }}</span>
        </p>

        <fieldset class="act__states">
          <legend class="small muted">État de l’action</legend>
          <button v-for="s in ACTION_STATES" :key="s.value" type="button" class="act__state" :class="['act__state--' + s.value, { 'act__state--on': draft(a.id).state === s.value }]" :aria-pressed="draft(a.id).state === s.value" @click="pick(a, s.value)">
            {{ s.label }}
          </button>
        </fieldset>

        <div class="act__ta">
          <label :for="'act-' + a.id" class="sr-only">Commentaire sur l’action</label>
          <textarea :id="'act-' + a.id" v-model="draft(a.id).text" class="input" rows="3" :maxlength="MAX" placeholder="Commentaire (facultatif)…"></textarea>
          <DictationButton label="commentaire" @text="onDictation(a.id)($event)" @listening="onListening(a.id)($event)" />
        </div>
        <div class="act__row">
          <span class="small muted">Envoyé dans les commentaires de l’action</span>
          <button type="button" class="btn" :disabled="(!draft(a.id).state && !draft(a.id).text.trim()) || busy[a.id] || !named" @click="send(a)">Envoyer</button>
        </div>

        <ul v-if="(log[a.id] || []).length" class="act__log">
          <li v-for="e in [...log[a.id]].reverse()" :key="e.id" class="act__entry">
            <p class="small muted">
              <strong>{{ e.by }}</strong> · {{ formatDateTime(e.at) }} · <span :class="{ alert: isFailed(e.id) }">{{ sentLabel(e) }}</span>
              <button v-if="isFailed(e.id)" type="button" class="btn btn--ghost" @click="retryEntry(e.id)">Réessayer</button>
            </p>
            <p class="act__text"><span v-if="e.state" class="chip" :class="'chip--' + e.state">{{ stateLabel(e.state) }}</span> {{ e.text }}</p>
          </li>
        </ul>
      </div>
    </details>
  </section>
</template>

<style scoped>
.acts { margin-top: var(--s-4); display: grid; gap: var(--s-3); }
.acts__title { margin: 0; display: flex; align-items: center; gap: var(--s-2); }
.act { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.act__sum { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-3); cursor: pointer; font-weight: 600; flex-wrap: wrap; }
.act__name { flex: 1 1 12rem; overflow-wrap: anywhere; }
.act__body { padding: 0 var(--s-3) var(--s-3); display: grid; gap: var(--s-2); }
.act__meta, .act__desc, .act__tools, .act__links, .act__text { margin: 0; }
.act__desc, .act__text { white-space: pre-line; overflow-wrap: anywhere; }
.act__links { display: flex; flex-wrap: wrap; gap: var(--s-1); align-items: center; }
.act__states { border: 0; padding: 0; margin: 0; display: flex; gap: var(--s-2); flex-wrap: wrap; }
.act__states legend { width: 100%; padding: 0; margin-bottom: var(--s-1); }
.act__state { flex: 1 1 40%; min-height: 44px; border: 2px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
.act__state--on { background: var(--ring); color: #fff; border-color: var(--ring); }
.act__state--done.act__state--on { background: #1f7a3d; border-color: #1f7a3d; }
.act__state--blocked.act__state--on { background: #b3261e; border-color: #b3261e; }
.act__ta { display: flex; gap: var(--s-2); align-items: flex-start; }
.act__ta .input { flex: 1; resize: vertical; min-height: 80px; }
.act__row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; }
.act__log { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.act__entry { padding: var(--s-2); background: var(--surface); border-radius: var(--radius); border-left: 4px solid var(--ring); }
.chip--done { background: #1f7a3d; color: #fff; }
.chip--blocked { background: #b3261e; color: #fff; }
.chip--none { opacity: .6; }
</style>
