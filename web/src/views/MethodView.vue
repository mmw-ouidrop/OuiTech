<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { methods } from '../lib/methodsApp.js'
import { groupNodes, statusTone } from '../lib/methods.js'
import { online } from '../lib/online.js'
import { formatDateTime } from '../lib/format.js'
import RichText from '../components/RichText.vue'
import MethodImage from '../components/MethodImage.vue'
import MethodVideo from '../components/MethodVideo.vue'
import MethodFile from '../components/MethodFile.vue'
import MethodNodes from '../components/MethodNodes.vue'

const props = defineProps({ id: { type: String, required: true } })

const method = ref(null)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const prefetch = ref({ running: false, done: 0, total: 0, tooLarge: 0, failed: 0 })

const KIND_LABEL = { materials: 'Matériel', tools: 'Outils', steps: 'Étapes', before: 'Avant de commencer', summary: 'Résumé', photos: 'Photos' }
const sections = computed(() => (method.value ? method.value.sections.filter((s) => s.nodes.length || s.title) : []))
const withTitles = computed(() => sections.value.filter((s) => s.title))
const skipKey = computed(() => (method.value && method.value.hero && !method.value.hero.key.startsWith('p:') ? method.value.hero.key : ''))
const hasBody = computed(() => sections.value.some((s) => s.nodes.length))
const modeOf = (s) => (s.kind === 'materials' || s.kind === 'tools' ? 'checklist' : s.kind === 'steps' ? 'steps' : 'default')

const MESSAGES = {
  OFFLINE_EMPTY: 'Cette fiche n’est pas encore sur l’appareil et il n’y a pas de réseau. Ouvrez-la une première fois avec du réseau.',
  NOT_FOUND: 'Cette fiche n’existe plus ou n’est pas publiée.',
  NOTION_FORBIDDEN: 'Notion refuse l’accès à cette fiche.'
}

async function load() {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const r = await methods.loadMethod(props.id)
    if (!r.method) { error.value = MESSAGES.OFFLINE_EMPTY; return }
    method.value = r.method
    if (r.error) notice.value = 'Fiche affichée depuis la copie de l’appareil (le serveur ne répond pas).'
    else if (r.fromCache) notice.value = 'Hors ligne : fiche affichée depuis la copie de l’appareil.'
    keepOffline()
  } catch (e) {
    error.value = MESSAGES[e.code] || e.message
  } finally {
    loading.value = false
  }
}

// En ligne, les images de la fiche sont gardées sur l'appareil pour la prochaine fois sans réseau.
async function keepOffline() {
  if (!online.value || !method.value || prefetch.value.running) return
  prefetch.value = { running: true, done: 0, total: 0, tooLarge: 0, failed: 0 }
  const r = await methods.prefetch(method.value, { onProgress: (p) => (prefetch.value = { ...prefetch.value, ...p, running: true }) })
  prefetch.value = { ...prefetch.value, ...r, running: false }
}

function jump(i) {
  nextTick(() => {
    const el = document.getElementById('sec-' + i)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
const secIndex = (s) => sections.value.indexOf(s)

onMounted(load)
watch(() => props.id, load)
watch(online, (on) => { if (on) load() })
</script>

<template>
  <router-link class="back" :to="{ name: 'methodes' }">← Toutes les méthodes</router-link>

  <p v-if="loading && !method" class="muted" role="status">Chargement…</p>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>

  <article v-if="method">
    <h2 class="title">{{ method.title }}</h2>
    <p class="chips">
      <span v-for="g in method.groups" :key="g" class="chip chip--info">{{ g }}</span>
      <span v-if="method.status" class="chip" :class="'chip--' + statusTone(method.status)">{{ method.status }}</span>
    </p>
    <p v-if="method.updated" class="small muted">Mise à jour le {{ formatDateTime(Date.parse(method.updated)) }}</p>
    <p v-if="notice" class="note small" role="status">{{ notice }}</p>
    <p v-if="method.status === 'A mettre à jour' || method.status === 'En cours'" class="note small">Cette fiche est encore en cours de rédaction : vérifiez avec le support en cas de doute.</p>

    <!-- Bandeau : photo / vidéo principale -->
    <template v-if="method.hero">
      <MethodVideo v-if="method.hero.kind === 'video'" :page-id="method.id" :media-key="method.hero.key" />
      <MethodImage v-else :page-id="method.id" :media-key="method.hero.key" hero />
    </template>

    <section v-if="method.notes" class="note notes" aria-label="À savoir">
      <p class="notes__label small">À savoir</p>
      <p class="notes__text"><RichText :text="method.notes" /></p>
    </section>
    <p v-if="method.errors" class="small"><strong>Erreurs associées :</strong> {{ method.errors }}</p>

    <!-- Documents -->
    <section v-if="method.links.length || method.support.length" class="docs" aria-label="Documents">
      <a v-for="l in method.links" :key="l.url" class="btn btn--ghost" :href="l.url" target="_blank" rel="noopener noreferrer">{{ l.label }}</a>
      <MethodFile v-for="s in method.support" :key="s.key" :page-id="method.id" :media-key="s.key" :name="'Support : ' + s.name" />
    </section>
    <p v-if="method.links.length && !online" class="small muted">Les documents en ligne demandent du réseau.</p>

    <!-- Sommaire -->
    <nav v-if="withTitles.length > 2" class="toc" aria-label="Sommaire">
      <button v-for="s in withTitles" :key="secIndex(s)" type="button" class="chip chip--info toc__btn" @click="jump(secIndex(s))">{{ s.title }}</button>
    </nav>

    <p v-if="!hasBody && !method.notes && !method.links.length" class="card muted">Cette fiche n’a pas encore de contenu.</p>

    <section v-for="(s, i) in sections" :id="'sec-' + i" :key="i" class="sec card" :class="'sec--' + s.kind">
      <h3 v-if="s.title" class="sec__title">
        <span v-if="KIND_LABEL[s.kind] && KIND_LABEL[s.kind] !== s.title" class="small chip">{{ KIND_LABEL[s.kind] }}</span>
        {{ s.title }}
      </h3>
      <MethodNodes :nodes="s.nodes" :page-id="method.id" :mode="modeOf(s)" :skip-key="skipKey" />
    </section>

    <p v-for="w in method.warnings" :key="w.code" class="note small">{{ w.message }}</p>

    <p v-if="prefetch.running" class="small muted" role="status">Mise en mémoire pour le hors-ligne…</p>
    <p v-else-if="prefetch.done || prefetch.skipped" class="small muted">✓ Cette fiche est disponible sans réseau<span v-if="prefetch.tooLarge"> (sauf {{ prefetch.tooLarge }} fichier(s) volumineux)</span>.</p>
    <p v-if="prefetch.failed && !prefetch.running" class="small muted">{{ prefetch.failed }} image(s) n’ont pas pu être gardées. <button class="linkish" @click="keepOffline">Réessayer</button></p>
  </article>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; min-height: var(--tap); color: var(--accent); text-decoration: none; }
.title { margin: var(--s-2) 0; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-2) 0; }
.notes { margin: var(--s-3) 0; }
.notes__label { margin: 0 0 var(--s-1); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.notes__text { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.docs { display: flex; flex-wrap: wrap; gap: var(--s-3); margin: var(--s-3) 0; }
.toc { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0; }
.toc__btn { cursor: pointer; min-height: 36px; }
.sec { margin-top: var(--s-4); }
.sec__title { margin: 0 0 var(--s-2); display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.sec--before { border-left: 6px solid var(--danger); }
.sec--summary { background: var(--surface-2); }
.linkish { color: var(--accent); text-decoration: underline; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; }
</style>
