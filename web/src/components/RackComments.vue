<script setup>
// Commentaires Notion d'un rack / casier (c'est là que l'équipe note ses diagnostics) : lecture pour tous,
// ajout depuis l'application pour le profil « support technique » (envoi par la file d'attente locale).
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '../lib/api.js'
import { online } from '../lib/online.js'
import { enqueue, pendingEntries, retryEntry, discardEntry, doneTick } from '../lib/outboxApp.js'
import { named, displayName, hasRole } from '../lib/session.js'

const props = defineProps({ pageId: { type: String, required: true } })

const MAX = 1000
const comments = ref(null)
const loading = ref(false)
const error = ref('')
const text = ref('')
const busy = ref(false)
const canWrite = computed(() => hasRole('support'))
const mine = computed(() => pendingEntries.value.filter((e) => e.kind === 'rack_comment' && e.payload.pageId === props.pageId))

const MESSAGES = {
  COMMENTS_FORBIDDEN: 'Notion refuse l’accès aux commentaires : donnez à l’intégration les capacités « Read comments » et « Insert comments ».'
}

async function load() {
  if (!online.value) { error.value = comments.value ? '' : 'Les commentaires Notion se lisent avec du réseau.'; return }
  loading.value = true
  error.value = ''
  try {
    comments.value = (await api.rackComments({ pageId: props.pageId })).comments
  } catch (e) {
    error.value = MESSAGES[e.code] || e.message
  } finally {
    loading.value = false
  }
}

async function send() {
  const t = text.value.trim()
  if (!t || busy.value || !named.value) return
  busy.value = true
  try {
    await enqueue('rack_comment', { pageId: props.pageId, text: t, name: displayName.value })
    text.value = ''
  } finally {
    busy.value = false
  }
}

onMounted(load)
watch(online, (on) => { if (on) load() })
watch(doneTick, load)
</script>

<template>
  <section class="rc" aria-label="Commentaires Notion">
    <h4 class="rc__title">Commentaires Notion <span v-if="comments && comments.length" class="chip">{{ comments.length }}</span></h4>

    <p v-if="loading && !comments" class="muted small" role="status">Chargement…</p>
    <p v-if="error" class="alert small" role="alert">{{ error }}</p>
    <p v-else-if="comments && !comments.length && !mine.length" class="muted small">Aucun commentaire sur cette page Notion.</p>

    <ul v-if="(comments && comments.length) || mine.length" class="rc__list">
      <li v-for="(c, i) in comments || []" :key="c.id || i" class="rc__item">
        <p class="rc__meta small muted"><strong>{{ c.by }}</strong><span v-if="c.at"> · {{ c.at }}</span></p>
        <p class="rc__text">{{ c.text }}</p>
      </li>
      <li v-for="e in mine" :key="e.id" class="rc__item rc__item--pending">
        <p class="rc__meta small muted"><strong>{{ e.payload.name }}</strong> · {{ e.status === 'failed' ? 'Non envoyé' : 'En attente d’envoi' }}</p>
        <p class="rc__text">{{ e.payload.text }}</p>
        <template v-if="e.status === 'failed'">
          <p class="small alert">{{ e.lastError && e.lastError.message }}</p>
          <p class="rc__row">
            <button type="button" class="btn btn--ghost" @click="retryEntry(e.id)">Réessayer</button>
            <button type="button" class="btn btn--ghost" @click="discardEntry(e.id)">Supprimer</button>
          </p>
        </template>
      </li>
    </ul>

    <form v-if="canWrite && named" class="rc__form" @submit.prevent="send">
      <label :for="'rc-' + pageId" class="sr-only">Votre commentaire</label>
      <textarea :id="'rc-' + pageId" v-model="text" class="input rc__ta" rows="2" :maxlength="MAX" placeholder="Ajouter un commentaire sur la page Notion…"></textarea>
      <div class="rc__row">
        <span class="small muted">signé {{ displayName }}</span>
        <button class="btn" :disabled="!text.trim() || busy">Publier</button>
      </div>
    </form>
    <p v-else-if="canWrite" class="note small">Renseignez votre nom dans <router-link to="/reglages">Réglages</router-link> pour commenter.</p>
  </section>
</template>

<style scoped>
.rc { margin-top: var(--s-3); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.rc__title { margin: 0 0 var(--s-2); display: flex; align-items: center; gap: var(--s-2); font-size: 18px; }
.rc__list { list-style: none; margin: 0 0 var(--s-3); padding: 0; display: grid; gap: var(--s-2); }
.rc__item { padding: var(--s-2) var(--s-3); background: var(--surface-2); border-radius: var(--radius); border-left: 4px solid var(--ring); }
.rc__item--pending { border-left-color: var(--line-strong); opacity: 0.85; }
.rc__meta { margin: 0 0 var(--s-1); }
.rc__text { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.rc__ta { width: 100%; resize: vertical; min-height: 64px; }
.rc__row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; margin: var(--s-2) 0 0; }
</style>
