<script setup>
// Réglages propres à l'appareil : compte, affichage, synchronisation, stockage.
import { ref, computed, onMounted } from 'vue'
import { liveQuery } from 'dexie'
import { listInterventions } from '../db.js'
import IdentityCard from '../components/IdentityCard.vue'
import ThemeSwitch from '../components/ThemeSwitch.vue'
import { textSize, setTextSize, TEXT_SIZES, TEXT_LABELS } from '../lib/theme.js'
import { roleLabel, sessionDaysLeft, sessionExpired, logout, engine } from '../lib/session.js'
import { online } from '../lib/online.js'
import { formatDateTime } from '../lib/format.js'

const missions = ref([])
onMounted(() => {
  liveQuery(listInterventions).subscribe({ next: (rows) => (missions.value = rows) })
  estimate()
})
const pending = computed(() => missions.value.filter((m) => m.needsSync === 1).length)
const lastSync = computed(() => Math.max(0, ...missions.value.map((m) => m.lastSyncAt || 0)))

const sending = ref(false)
const sendMsg = ref('')
async function sendAll() {
  sending.value = true
  sendMsg.value = ''
  try {
    const out = await engine.syncPending()
    const failed = out.filter(([, r]) => r && r.error).length
    sendMsg.value = failed ? `${failed} fiche(s) n'ont pas pu être envoyées (nouvel essai automatique).` : 'Envoi terminé.'
  } finally {
    sending.value = false
  }
}

const storage = ref('')
const persisted = ref(null)
async function estimate() {
  try {
    const e = await navigator.storage.estimate()
    const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1)
    storage.value = `${mb(e.usage || 0)} Mo utilisés sur ${mb(e.quota || 0)} Mo disponibles`
    persisted.value = navigator.storage.persisted ? await navigator.storage.persisted() : null
  } catch { storage.value = '' }
}
</script>

<template>
  <h2>Réglages</h2>

  <section class="card block" aria-labelledby="s-account">
    <h3 id="s-account">Compte</h3>
    <p class="small muted">
      Niveau d'accès : <strong>{{ roleLabel }}</strong> ·
      {{ sessionExpired ? 'session expirée' : `connexion valable encore ${sessionDaysLeft} jour${sessionDaysLeft > 1 ? 's' : ''}` }}
    </p>
    <h4 class="sub">Qui intervient</h4>
    <p class="small muted">Ce nom est inscrit dans les comptes rendus avec chacune de vos modifications.</p>
    <IdentityCard mode="edit" />
    <button type="button" class="btn btn--ghost" @click="logout">Se déconnecter</button>
    <p class="small muted">Se déconnecter ne supprime pas les saisies de cet appareil.</p>
  </section>

  <section class="card block" aria-labelledby="s-display">
    <h3 id="s-display">Affichage</h3>
    <h4 class="sub">Thème</h4>
    <ThemeSwitch />
    <h4 class="sub">Taille du texte</h4>
    <div class="seg" role="group" aria-label="Taille du texte">
      <button v-for="s in TEXT_SIZES" :key="s" type="button" class="seg__btn" :aria-pressed="textSize === s" @click="setTextSize(s)">{{ TEXT_LABELS[s] }}</button>
    </div>
  </section>

  <section class="card block" aria-labelledby="s-sync">
    <h3 id="s-sync">Synchronisation</h3>
    <p>
      <template v-if="pending"><strong>{{ pending }}</strong> fiche{{ pending > 1 ? 's' : '' }} à envoyer.</template>
      <template v-else>Tout est à jour dans Notion.</template>
      <span v-if="lastSync" class="small muted"> Dernier envoi : {{ formatDateTime(lastSync) }}.</span>
    </p>
    <button type="button" class="btn btn--ghost" :disabled="sending || !online || sessionExpired" @click="sendAll">{{ sending ? 'Envoi…' : 'Tout envoyer maintenant' }}</button>
    <p v-if="sendMsg" class="small" role="status">{{ sendMsg }}</p>
    <p class="small muted">Les envois se font automatiquement quand l'application est ouverte et que le réseau est disponible.</p>
  </section>

  <section class="card block" aria-labelledby="s-store">
    <h3 id="s-store">Stockage sur l'appareil</h3>
    <p v-if="storage">{{ storage }}.</p>
    <p class="small muted">
      {{ missions.length }} fiche{{ missions.length > 1 ? 's' : '' }} conservée{{ missions.length > 1 ? 's' : '' }} hors ligne.
      <template v-if="persisted === false"> Sur iPhone, ajoutez l'application à l'écran d'accueil pour éviter que Safari ne purge les données.</template>
    </p>
  </section>
</template>

<style scoped>
.block { margin-bottom: var(--s-4); display: grid; gap: var(--s-3); justify-items: start; }
.block > * { margin: 0; }
.block h3 { margin: 0; }
.sub { font-size: 22px; margin: var(--s-2) 0 0; }
.seg { display: inline-flex; border: 2px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; flex-wrap: wrap; }
.seg__btn { min-height: var(--tap); padding: 0 var(--s-4); border: 0; background: transparent; color: var(--accent); font: 700 var(--fs-cta)/1 var(--f-display); letter-spacing: .02em; text-transform: uppercase; cursor: pointer; }
.seg__btn + .seg__btn { border-left: 2px solid var(--line-strong); }
.seg__btn[aria-pressed='true'] { background: var(--btn-bg); color: var(--btn-text); }
</style>
