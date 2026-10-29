<script setup>
// Commentaires des techniciens sur une fiche méthode : liste + saisie. Les envois passent par la file d'attente locale.
import { ref, computed } from 'vue'
import { enqueue, pendingEntries, retryEntry, discardEntry } from '../lib/outboxApp.js'
import { named, displayName } from '../lib/session.js'

const props = defineProps({
  pageId: { type: String, required: true },
  comments: { type: Array, default: () => [] },
  enabled: { type: Boolean, default: false }
})

const MAX = 1000
const text = ref('')
const busy = ref(false)
const mine = computed(() => pendingEntries.value.filter((e) => e.kind === 'method_comment' && e.payload.pageId === props.pageId))
const left = computed(() => MAX - text.value.length)

async function send() {
  const t = text.value.trim()
  if (!t || busy.value || !named.value) return
  busy.value = true
  try {
    await enqueue('method_comment', { pageId: props.pageId, text: t, name: displayName.value })
    text.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="cm card" aria-labelledby="cm-title">
    <h3 id="cm-title" class="cm__title">Commentaires <span v-if="comments.length" class="chip">{{ comments.length }}</span></h3>

    <p v-if="!enabled" class="note small">
      Les commentaires ne sont pas encore activés : ajoutez à la base Notion une colonne de type <strong>Texte</strong> nommée « Commentaires ».
    </p>
    <template v-else>
      <p v-if="!comments.length && !mine.length" class="muted small">Aucun commentaire. Une astuce, une pièce, une erreur dans la fiche ? Dites-le ici : l’équipe le verra.</p>
      <ul class="cm__list">
        <li v-for="(c, i) in comments" :key="i" class="cm__item">
          <p class="cm__meta small muted"><strong>{{ c.by || 'Notion' }}</strong><span v-if="c.at"> · {{ c.at }}</span></p>
          <p class="cm__text">{{ c.text }}</p>
        </li>
        <li v-for="e in mine" :key="e.id" class="cm__item cm__item--pending">
          <p class="cm__meta small muted"><strong>{{ e.payload.name }}</strong> · {{ e.status === 'failed' ? 'Non envoyé' : 'En attente d’envoi' }}</p>
          <p class="cm__text">{{ e.payload.text }}</p>
          <p v-if="e.status === 'failed'" class="small alert">{{ e.lastError && e.lastError.message }}</p>
          <p v-if="e.status === 'failed'" class="cm__row">
            <button type="button" class="btn btn--ghost" @click="retryEntry(e.id)">Réessayer</button>
            <button type="button" class="btn btn--ghost" @click="discardEntry(e.id)">Supprimer</button>
          </p>
        </li>
      </ul>

      <form v-if="named" class="cm__form" @submit.prevent="send">
        <label for="cm-text" class="sr-only">Votre commentaire</label>
        <textarea id="cm-text" v-model="text" class="input cm__ta" rows="3" :maxlength="MAX" placeholder="Ajouter un commentaire…"></textarea>
        <div class="cm__row">
          <span class="small muted">{{ left }} caractères restants · signé {{ displayName }}</span>
          <button class="btn" :disabled="!text.trim() || busy">Publier</button>
        </div>
      </form>
      <p v-else class="note small">Renseignez votre prénom et nom dans <router-link to="/reglages">Réglages</router-link> pour commenter.</p>
    </template>
  </section>
</template>

<style scoped>
.cm { margin-top: var(--s-6); }
.cm__title { margin: 0 0 var(--s-3); display: flex; align-items: center; gap: var(--s-2); }
.cm__list { list-style: none; margin: 0 0 var(--s-4); padding: 0; display: grid; gap: var(--s-3); }
.cm__item { padding: var(--s-3); background: var(--surface-2); border-radius: var(--radius); border-left: 4px solid var(--ring); }
.cm__item--pending { border-left-color: var(--line-strong); opacity: 0.85; }
.cm__meta { margin: 0 0 var(--s-1); }
.cm__text { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.cm__ta { width: 100%; resize: vertical; min-height: 80px; }
.cm__row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; margin: var(--s-2) 0 0; }
</style>
