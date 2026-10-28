<script setup>
// Page annoncée dans le menu mais pas encore développée.
defineProps({ title: { type: String, required: true }, text: { type: String, default: '' } })
</script>

<template>
  <h2>{{ title }}</h2>
  <section class="card">
    <p><span class="chip">Bientôt disponible</span></p>
    <p>{{ text }}</p>
    <router-link class="btn btn--ghost" to="/">Retour à l'accueil</router-link>
  </section>
</template>
