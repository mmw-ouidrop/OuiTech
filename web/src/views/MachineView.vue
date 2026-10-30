<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { machines } from '../lib/methodsApp.js'
import { machineTone, mapLinks, formatSince } from '../lib/machines.js'
import { online } from '../lib/online.js'
import { formatDateTime } from '../lib/format.js'
import RichText from '../components/RichText.vue'
import MethodImage from '../components/MethodImage.vue'
import MethodNodes from '../components/MethodNodes.vue'
import CopyButton from '../components/CopyButton.vue'

const props = defineProps({ id: { type: String, required: true } })

const machine = ref(null)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const prefetch = ref({ running: false, done: 0, tooLarge: 0, failed: 0, skipped: 0 })

const links = computed(() => (machine.value ? mapLinks(machine.value) : null))
const facts = computed(() => {
  const m = machine.value
  if (!m) return []
  return [
    ['Client', m.client], ['Région de stock', m.region], ['Projet', m.project], ['Type', m.type],
    ['Mise en service', formatSince(m.since)], ['Objectif commandes / jour', m.target],
    ...m.extras.map((e) => [e.label, e.value])
  ].filter(([, v]) => v)
})

const MESSAGES = {
  OFFLINE_EMPTY: 'Cette machine n’est pas encore sur l’appareil et il n’y a pas de réseau. Ouvrez-la une première fois avec du réseau.',
  NOT_FOUND: 'Cette machine n’existe plus ou n’est pas publiée.',
  NOTION_FORBIDDEN: 'Notion refuse l’accès à cette machine.'
}

async function load() {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const r = await machines.loadMachine(props.id)
    if (!r.machine) { error.value = MESSAGES.OFFLINE_EMPTY; return }
    machine.value = r.machine
    if (r.error) notice.value = 'Fiche affichée depuis la copie de l’appareil (le serveur ne répond pas).'
    else if (r.fromCache) notice.value = 'Hors ligne : fiche affichée depuis la copie de l’appareil.'
    keepOffline()
  } catch (e) {
    error.value = MESSAGES[e.code] || e.message
  } finally {
    loading.value = false
  }
}

async function keepOffline() {
  if (!online.value || !machine.value || prefetch.value.running) return
  prefetch.value = { ...prefetch.value, running: true }
  const r = await machines.prefetch(machine.value)
  prefetch.value = { ...r, running: false }
}

onMounted(load)
watch(() => props.id, load)
watch(online, (on) => { if (on) load() })
</script>

<template>
  <router-link class="back" :to="{ name: 'machines' }">← Toutes les machines</router-link>

  <p v-if="loading && !machine" class="muted" role="status">Chargement…</p>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>

  <article v-if="machine">
    <h2 class="title">{{ machine.title }}</h2>
    <p class="chips">
      <span v-if="machine.active === false" class="chip">Hors exploitation</span>
      <span v-else-if="machine.active" class="chip chip--done">En exploitation</span>
      <span v-if="machine.status" class="chip" :class="'chip--' + machineTone(machine.status)">{{ machine.status }}</span>
    </p>
    <p v-if="machine.updated" class="small muted">Mise à jour le {{ formatDateTime(Date.parse(machine.updated)) }}</p>
    <p v-if="notice" class="note small" role="status">{{ notice }}</p>

    <!-- Accès au site -->
    <section v-if="machine.address || machine.mapAddress" class="card block" aria-labelledby="mv-addr">
      <h3 id="mv-addr" class="block__title">Adresse</h3>
      <p class="addr">{{ machine.address || machine.mapAddress }}</p>
      <p v-if="machine.address && machine.mapAddress && machine.mapAddress !== machine.address" class="small muted">Carte : {{ machine.mapAddress }}</p>
      <div v-if="links" class="actions">
        <a class="btn" :href="links.google" target="_blank" rel="noopener noreferrer">Itinéraire</a>
        <a class="btn btn--ghost" :href="links.waze" target="_blank" rel="noopener noreferrer">Waze</a>
        <CopyButton :value="machine.mapAddress || machine.address" label="Copier l’adresse" />
      </div>
      <p v-if="!online" class="small muted">L’itinéraire demande du réseau.</p>
    </section>

    <section v-if="machine.keybox" class="card block" aria-labelledby="mv-key">
      <h3 id="mv-key" class="block__title">Code boîte à clés</h3>
      <p class="code">{{ machine.keybox }}</p>
    </section>

    <section v-if="machine.wifi" class="card block" aria-labelledby="mv-wifi">
      <h3 id="mv-wifi" class="block__title">Wi-Fi</h3>
      <template v-if="machine.wifi.ssid || machine.wifi.password">
        <div v-if="machine.wifi.ssid" class="kv">
          <div><p class="small muted">Réseau (SSID)</p><p class="code code--s">{{ machine.wifi.ssid }}</p></div>
          <CopyButton :value="machine.wifi.ssid" />
        </div>
        <div v-if="machine.wifi.password" class="kv">
          <div><p class="small muted">Mot de passe</p><p class="code code--s">{{ machine.wifi.password }}</p></div>
          <CopyButton :value="machine.wifi.password" />
        </div>
      </template>
      <p v-else class="pre">{{ machine.wifi.raw }}</p>
    </section>

    <section v-if="machine.connections.length || machine.options.length" class="card block" aria-labelledby="mv-tech">
      <h3 id="mv-tech" class="block__title">Équipement</h3>
      <p v-if="machine.connections.length" class="small muted">Connexion machine</p>
      <p v-if="machine.connections.length" class="chips"><span v-for="c in machine.connections" :key="c" class="chip chip--info">{{ c }}</span></p>
      <p v-if="machine.options.length" class="small muted">Options</p>
      <p v-if="machine.options.length" class="chips"><span v-for="o in machine.options" :key="o" class="chip chip--info">{{ o }}</span></p>
    </section>

    <section v-if="machine.parts" class="card block" aria-labelledby="mv-parts">
      <h3 id="mv-parts" class="block__title">Colis et pièces de maintenance</h3>
      <p class="pre"><RichText :text="machine.parts" /></p>
    </section>

    <section v-if="machine.notes" class="note block" aria-label="Autres informations du site">
      <p class="block__title small">Autres informations</p>
      <p class="pre"><RichText :text="machine.notes" /></p>
    </section>

    <section v-if="facts.length" class="card block" aria-labelledby="mv-facts">
      <h3 id="mv-facts" class="block__title">Informations</h3>
      <dl class="facts">
        <template v-for="[k, v] in facts" :key="k">
          <dt class="small muted">{{ k }}</dt>
          <dd><RichText :text="String(v)" /></dd>
        </template>
      </dl>
    </section>

    <section v-if="machine.photos.length" class="block" aria-labelledby="mv-photos">
      <h3 id="mv-photos" class="block__title">Photos du site</h3>
      <MethodImage v-for="p in machine.photos" :key="p.key" :page-id="machine.id" :media-key="p.key" :caption="''" :service="machines" />
    </section>

    <section v-if="machine.nodes.length" class="card block">
      <MethodNodes :nodes="machine.nodes" :page-id="machine.id" />
    </section>

    <p v-for="w in machine.warnings" :key="w.code" class="note small">{{ w.message }}</p>

    <p v-if="prefetch.running" class="small muted" role="status">Mise en mémoire pour le hors-ligne…</p>
    <p v-else-if="prefetch.done || prefetch.skipped" class="small muted">✓ Cette machine est disponible sans réseau.</p>
    <p v-if="prefetch.failed && !prefetch.running" class="small muted">{{ prefetch.failed }} photo(s) n’ont pas pu être gardées.</p>
  </article>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; min-height: var(--tap); color: var(--accent); text-decoration: none; }
.title { margin: var(--s-2) 0; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-2) 0; }
.block { margin-top: var(--s-4); }
.block__title { margin: 0 0 var(--s-2); }
.addr { margin: 0 0 var(--s-3); font-size: 1.1em; font-weight: 600; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: var(--s-3); }
.code { margin: 0; font: 700 40px/1.1 var(--f-display); letter-spacing: 0.06em; color: var(--heading); overflow-wrap: anywhere; }
.code--s { font-size: 24px; margin: 0; letter-spacing: 0.02em; }
.kv { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-2) 0; border-top: 1px solid var(--line); }
.kv > div { min-width: 0; }
.kv p { margin: 0; }
.pre { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.facts { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px var(--s-4); margin: 0; }
.facts dd { margin: 0 0 var(--s-3); font-weight: 600; overflow-wrap: anywhere; }
@media (min-width: 560px) { .facts { grid-template-columns: 220px minmax(0, 1fr); } .facts dd { margin: 0; padding: var(--s-1) 0; } .facts dt { padding: var(--s-1) 0; } }
</style>
