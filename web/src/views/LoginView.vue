<script setup>
// Connexion : prénom, nom et mot de passe commun (technicien ou support selon le mot de passe).
// Le prénom et le nom sont inscrits dans les comptes rendus ; ils restent sur l'appareil.
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandIcon from '../components/BrandIcon.vue'
import BrandWordmark from '../components/BrandWordmark.vue'
import { identity, login, loginNotice } from '../lib/session.js'
import { online } from '../lib/online.js'

const route = useRoute()
const router = useRouter()
const first = ref(identity.value.firstName)
const last = ref(identity.value.lastName)
const password = ref('')
const show = ref(false)
const busy = ref(false)
const error = ref('')

const ready = computed(() => first.value.trim() && last.value.trim() && password.value)

const MESSAGES = {
  BAD_PASSWORD: 'Mot de passe incorrect.',
  NAME_REQUIRED: 'Indiquez votre prénom et votre nom.',
  TOO_MANY_ATTEMPTS: 'Trop d’essais. Réessayez dans 10 minutes.',
  NETWORK: 'Connexion impossible : il faut du réseau pour se connecter.',
  TIMEOUT: 'Le serveur met trop de temps à répondre. Réessayez.',
  CONFIG_MISSING: 'Le serveur n’a pas de mot de passe configuré. Prévenez l’administrateur.',
  CONFIG: 'Application mal configurée (adresse du serveur manquante).'
}

async function submit() {
  error.value = ''
  if (!online.value) { error.value = MESSAGES.NETWORK; return }
  busy.value = true
  try {
    await login({ password: password.value, firstName: first.value, lastName: last.value })
    password.value = ''
    const target = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    router.replace(target)
  } catch (e) {
    error.value = MESSAGES[e.code] || `Connexion impossible : ${e.message}`
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="login__brand">
      <BrandIcon :height="64" />
      <BrandWordmark :height="34" />
    </div>
    <h1 class="login__title">Interventions</h1>
    <p class="muted">Outil des techniciens OUIDROP. Accès réservé.</p>

    <p v-if="loginNotice" class="note" role="status">{{ loginNotice }}</p>

    <form class="card" novalidate @submit.prevent="submit">
      <div class="login__row">
        <div class="field">
          <label for="lg-first">Prénom</label>
          <input id="lg-first" v-model="first" class="input" autocomplete="given-name" maxlength="40" />
        </div>
        <div class="field">
          <label for="lg-last">Nom</label>
          <input id="lg-last" v-model="last" class="input" autocomplete="family-name" maxlength="40" />
        </div>
      </div>
      <div class="field">
        <label for="lg-pw">Mot de passe</label>
        <div class="pw">
          <input
            id="lg-pw" v-model="password" class="input" :type="show ? 'text' : 'password'" autocomplete="current-password"
            autocapitalize="none" autocorrect="off" spellcheck="false" :aria-invalid="!!error" aria-describedby="lg-err"
          />
          <button type="button" class="pw__toggle" :aria-pressed="show" @click="show = !show">{{ show ? 'Masquer' : 'Afficher' }}</button>
        </div>
      </div>
      <p v-if="error" id="lg-err" class="alert" role="alert">{{ error }}</p>
      <button class="btn btn--block" :disabled="busy || !ready">{{ busy ? 'Connexion…' : 'Se connecter' }}</button>
    </form>
    <p class="small muted">La première connexion demande du réseau. Ensuite l'application fonctionne aussi hors ligne.</p>
  </div>
</template>

<style scoped>
.login { max-width: 460px; margin-inline: auto; }
.login__brand { display: flex; align-items: center; gap: var(--s-4); color: var(--heading); margin-bottom: var(--s-5); }
.login__title { margin-bottom: var(--s-2); }
.login__row { display: grid; gap: 0 var(--s-4); grid-template-columns: 1fr; }
@media (min-width: 480px) { .login__row { grid-template-columns: 1fr 1fr; } }
.pw { display: flex; gap: var(--s-2); align-items: stretch; }
.pw .input { flex: 1 1 auto; min-width: 0; }
.pw__toggle {
  flex: none; min-height: var(--tap); padding: 0 var(--s-3); border: 2px solid var(--line-strong); border-radius: var(--radius);
  background: transparent; color: var(--accent); font: 600 var(--fs-small)/1 var(--f-body); cursor: pointer;
}
.pw__toggle[aria-pressed='true'] { background: var(--surface-2); }
.login .card { margin: var(--s-4) 0; }
</style>
