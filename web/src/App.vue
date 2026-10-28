<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import NavDrawer from './components/NavDrawer.vue'
import NavIcon from './components/NavIcon.vue'
import BrandIcon from './components/BrandIcon.vue'
import BrandWordmark from './components/BrandWordmark.vue'
import { online } from './lib/online.js'
import { configOk } from './config.js'
import { loggedIn, sessionExpired, logout, validateSession, startBackgroundSync, engine } from './lib/session.js'

const route = useRoute()
const router = useRouter()

// Mise à jour de l'app : jamais automatique (le technicien peut être en pleine saisie).
const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW()
const close = () => {
  needRefresh.value = false
  offlineReady.value = false
}

const menuOpen = ref(false)
const isPublic = computed(() => !!route.meta.public)
const title = computed(() => (route.name === 'mission' ? String(route.params.reference || '') : route.meta.title || ''))

// Au lancement et au retour du réseau : envoie ce qui attend, vérifie que la session est toujours valable.
startBackgroundSync()
onMounted(validateSession)
watch(online, (on) => on && validateSession())

// Déconnecté (par le menu, ou refus du serveur) → page de connexion. Les données de l'appareil sont conservées.
watch(loggedIn, (now) => {
  if (!now && !route.meta.public) {
    router.replace({ name: 'login', query: route.fullPath !== '/' ? { redirect: route.fullPath } : {} })
  }
  if (now) engine.syncPending().catch(() => {})
})
</script>

<template>
  <!-- Page de connexion : pas de menu -->
  <template v-if="isPublic">
    <div v-if="!online" class="banner banner--offline" role="status"><strong>Hors ligne.</strong> La première connexion demande du réseau.</div>
    <div v-if="!configOk" class="container" style="margin-top: 16px">
      <p class="alert" role="alert"><strong>Application non configurée.</strong> Renseignez <code>VITE_GAS_URL</code> puis relancez le build.</p>
    </div>
    <main class="container login-main"><router-view /></main>
  </template>

  <div v-else class="shell">
    <NavDrawer :open="menuOpen" @close="menuOpen = false" />

    <div class="shell__main">
      <header class="top">
        <button type="button" class="top__menu" aria-controls="menu" :aria-expanded="menuOpen" aria-label="Ouvrir le menu" @click="menuOpen = true">
          <NavIcon name="menu" :size="28" />
        </button>
        <router-link to="/" class="brand-link" aria-label="OUIDROP — accueil">
          <BrandIcon :height="30" />
          <BrandWordmark class="top__word" :height="20" />
        </router-link>
        <span class="app-name">{{ title }}</span>
      </header>

      <div v-if="!online" class="banner banner--offline" role="status">
        <strong>Hors ligne.</strong> Vos saisies sont enregistrées sur l'appareil.
      </div>
      <div v-if="sessionExpired" class="banner banner--warn" role="status">
        <span><strong>Session expirée.</strong> Reconnectez-vous dès que vous avez du réseau pour synchroniser.</span>
        <button class="btn btn--ghost" @click="logout">Se reconnecter</button>
      </div>
      <div v-if="needRefresh" class="banner" role="status">
        <span>Nouvelle version disponible.</span>
        <button class="btn btn--ghost" @click="updateServiceWorker(true)">Mettre à jour</button>
        <button class="btn btn--ghost" @click="close">Plus tard</button>
      </div>
      <div v-else-if="offlineReady" class="banner" role="status">
        <span>Prêt hors ligne.</span>
        <button class="btn btn--ghost" @click="close">OK</button>
      </div>
      <div v-if="!configOk" class="container" style="margin-top: 16px">
        <p class="alert" role="alert">
          <strong>Application non configurée.</strong> Renseignez <code>VITE_GAS_URL</code> dans <code>.env.local</code>, puis relancez le build.
        </p>
      </div>

      <main class="container">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* Charte : sur fond foncé, le logo est blanc (version monochrome). */
.top {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: var(--s-3);
  padding: calc(var(--s-2) + env(safe-area-inset-top)) var(--s-4) var(--s-2) var(--s-2);
  background: var(--top-bg); color: var(--top-text); border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  min-height: 60px;
}
.top__menu { display: grid; place-items: center; width: 48px; height: 48px; flex: none; border: 0; border-radius: var(--radius); background: transparent; color: inherit; cursor: pointer; }
.top__menu:hover { background: rgba(255, 255, 255, .12); }
.top :focus-visible { box-shadow: 0 0 0 3px var(--c-navy), 0 0 0 6px var(--c-white); }
.brand-link { display: flex; align-items: center; gap: var(--s-3); color: inherit; text-decoration: none; border-radius: var(--radius); }
.top__word { display: none; }
.app-name { margin-left: auto; font: 500 18px/1 var(--f-display); letter-spacing: 0.06em; text-transform: uppercase; color: var(--top-sub); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
main { padding-block: var(--s-5) calc(var(--s-7) + env(safe-area-inset-bottom)); }
.login-main { padding-block: var(--s-6); }

@media (min-width: 480px) { .top__word { display: block; } }
@media (min-width: 1024px) {
  .shell__main { margin-left: 280px; }
  .top__menu { display: none; }
  .top { padding-left: var(--s-5); }
}
</style>
