<script setup>
// Bouton-icône vers un document ou un dossier (s'ouvre dans un nouvel onglet / l'application Google).
defineProps({
  name: { type: String, required: true },       // 'file' | 'folder'
  href: { type: String, required: true },
  label: { type: String, required: true }
})
</script>

<template>
  <a class="licon" :href="href" target="_blank" rel="noopener noreferrer" :aria-label="label" :title="label">
    <svg v-if="name === 'file'" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
    <svg v-else viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  </a>
</template>

<style scoped>
.licon { display: inline-grid; place-items: center; width: var(--tap); height: var(--tap); border-radius: var(--radius); border: 1px solid var(--accent); color: var(--accent); background: transparent; text-decoration: none; }
.licon:hover, .licon:focus-visible { background: var(--accent); color: var(--btn-text); }
</style>
