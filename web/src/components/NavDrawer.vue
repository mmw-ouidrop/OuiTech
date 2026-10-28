<script setup>
// Menu latéral : tiroir sur téléphone (ouvert par le bouton du bandeau), colonne fixe sur grand écran.
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import NavIcon from './NavIcon.vue'
import BrandIcon from './BrandIcon.vue'
import BrandWordmark from './BrandWordmark.vue'
import { visibleNav, activeNavId } from '../lib/nav.js'
import { role, roleLabel, displayName, logout } from '../lib/session.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const route = useRoute()
const panel = ref(null)

const main = () => visibleNav(role.value).filter((n) => !n.footer)
const foot = () => visibleNav(role.value).filter((n) => n.footer)
const isActive = (n) => activeNavId(route) === n.id

// Fermer à la navigation, au clavier (Échap) ; garder le focus dans le tiroir tant qu'il est ouvert.
watch(() => route.fullPath, () => emit('close'))
function onKey(e) {
  if (!props.open) return
  if (e.key === 'Escape') { emit('close'); return }
  if (e.key !== 'Tab' || !panel.value) return
  const f = panel.value.querySelectorAll('a[href], button:not([disabled])')
  if (!f.length) return
  const first = f[0], last = f[f.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
document.addEventListener('keydown', onKey)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
watch(() => props.open, async (o) => {
  if (o) { await nextTick(); const a = panel.value && panel.value.querySelector('a[aria-current="page"], a[href]'); a && a.focus() }
})
</script>

<template>
  <div v-if="open" class="scrim" aria-hidden="true" @click="emit('close')"></div>
  <nav id="menu" ref="panel" class="drawer" :class="{ 'drawer--open': open }" aria-label="Menu principal" :aria-hidden="undefined">
    <div class="drawer__head">
      <router-link to="/" class="drawer__brand" aria-label="OUIDROP — accueil">
        <BrandIcon :height="30" />
        <BrandWordmark :height="20" />
      </router-link>
      <button type="button" class="drawer__close" aria-label="Fermer le menu" @click="emit('close')"><NavIcon name="close" /></button>
    </div>

    <ul class="drawer__list">
      <li v-for="n in main()" :key="n.id">
        <router-link :to="n.to" class="item" :class="{ 'item--active': isActive(n) }" :aria-current="isActive(n) ? 'page' : undefined">
          <NavIcon :name="n.icon" />
          <span class="item__label">{{ n.label }}</span>
          <span v-if="n.soon" class="item__soon">Bientôt</span>
        </router-link>
      </li>
    </ul>

    <div class="drawer__foot">
      <ul class="drawer__list">
        <li v-for="n in foot()" :key="n.id">
          <router-link :to="n.to" class="item" :class="{ 'item--active': isActive(n) }" :aria-current="isActive(n) ? 'page' : undefined">
            <NavIcon :name="n.icon" /><span class="item__label">{{ n.label }}</span>
          </router-link>
        </li>
      </ul>
      <div class="who">
        <span class="who__name">{{ displayName || 'Nom non renseigné' }}</span>
        <span class="who__role">{{ roleLabel }}</span>
      </div>
      <button type="button" class="item item--btn" @click="logout"><NavIcon name="logout" /><span class="item__label">Se déconnecter</span></button>
    </div>
  </nav>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 30; background: rgba(5, 15, 32, .6); }
.drawer {
  position: fixed; inset: 0 auto 0 0; z-index: 40; width: min(320px, 86vw);
  display: flex; flex-direction: column; gap: var(--s-3);
  padding: calc(var(--s-3) + env(safe-area-inset-top)) var(--s-3) calc(var(--s-3) + env(safe-area-inset-bottom));
  background: var(--c-navy); color: var(--c-white); overflow-y: auto;
  transform: translateX(-102%); transition: transform .18s ease-out; visibility: hidden;
}
.drawer--open { transform: none; visibility: visible; }
.drawer__head { display: flex; align-items: center; justify-content: space-between; padding: var(--s-2) var(--s-2) var(--s-3); }
.drawer__brand { display: flex; align-items: center; gap: var(--s-3); color: inherit; text-decoration: none; border-radius: var(--radius); }
.drawer__close { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: var(--radius); background: transparent; color: inherit; cursor: pointer; }
.drawer__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-1); }
.item {
  display: flex; align-items: center; gap: var(--s-3); width: 100%; min-height: var(--tap); padding: 0 var(--s-3);
  border: 0; border-left: 4px solid transparent; border-radius: var(--radius); background: transparent;
  color: var(--c-white); font: 600 var(--fs-body)/1.2 var(--f-body); text-decoration: none; text-align: left; cursor: pointer;
}
.item:hover { background: rgba(255, 255, 255, .1); }
.item--active { background: rgba(255, 255, 255, .14); border-left-color: var(--c-blue); }
.item__label { flex: 1 1 auto; }
.item__soon { font: 600 12px/1 var(--f-body); padding: 4px 8px; border-radius: 999px; background: var(--c-ice); color: var(--c-navy); }
.drawer__foot { margin-top: auto; display: grid; gap: var(--s-2); border-top: 1px solid rgba(255, 255, 255, .2); padding-top: var(--s-3); }
.who { display: grid; padding: var(--s-2) var(--s-3); }
.who__name { font-weight: 600; overflow-wrap: anywhere; }
.who__role { font-size: var(--fs-small); color: var(--c-ice); }
.drawer :focus-visible { box-shadow: 0 0 0 3px var(--c-navy), 0 0 0 6px var(--c-white); }

/* Grand écran : colonne toujours visible, sans voile ni bouton de fermeture */
@media (min-width: 1024px) {
  .scrim, .drawer__close { display: none; }
  .drawer { transform: none; visibility: visible; transition: none; width: 280px; }
}
</style>
