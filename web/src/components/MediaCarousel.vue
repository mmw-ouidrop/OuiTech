<script setup>
// Carrousel de photos et vidéos : défilement tactile (glisser), flèches, points, clavier. L'ordre reçu est conservé.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import MethodImage from './MethodImage.vue'
import MethodVideo from './MethodVideo.vue'

const props = defineProps({
  pageId: { type: String, required: true },
  items: { type: Array, required: true },          // [{ key, kind:'image'|'video', url?, name }]
  service: { type: Object, default: null },
  label: { type: String, default: 'Photos et vidéos' }
})

const track = ref(null)
const index = ref(0)
const count = computed(() => props.items.length)
let raf = 0

function onScroll() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const el = track.value
    if (el && el.clientWidth) index.value = Math.max(0, Math.min(count.value - 1, Math.round(el.scrollLeft / el.clientWidth)))
  })
}

function goTo(i) {
  const el = track.value
  if (!el) return
  const target = Math.max(0, Math.min(count.value - 1, i))
  el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' })
  index.value = target
}

// Les images voisines sont chargées d'avance, les autres à l'arrivée.
const near = (i) => Math.abs(i - index.value) <= 1

onMounted(() => { if (track.value) track.value.addEventListener('scroll', onScroll, { passive: true }) })
onBeforeUnmount(() => { if (track.value) track.value.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) })
</script>

<template>
  <section class="car" role="region" aria-roledescription="carrousel" :aria-label="label">
    <div
      ref="track" class="car__track" tabindex="0"
      @keydown.left.prevent="goTo(index - 1)" @keydown.right.prevent="goTo(index + 1)"
    >
      <div
        v-for="(it, i) in items" :key="it.key" class="car__slide"
        role="group" aria-roledescription="diapositive" :aria-label="`${i + 1} sur ${count}`"
      >
        <template v-if="near(i)">
          <MethodVideo v-if="it.kind === 'video'" :page-id="pageId" :url="it.url || ''" :media-key="it.url ? '' : it.key" :active="i === index" />
          <MethodImage v-else :page-id="pageId" :media-key="it.key" :caption="''" hero :service="service" />
        </template>
        <div v-else class="car__ph" aria-hidden="true"></div>
      </div>
    </div>

    <template v-if="count > 1">
      <button type="button" class="car__nav car__nav--prev" aria-label="Précédent" :disabled="index === 0" @click="goTo(index - 1)">‹</button>
      <button type="button" class="car__nav car__nav--next" aria-label="Suivant" :disabled="index === count - 1" @click="goTo(index + 1)">›</button>
      <p class="car__count small" aria-live="polite">{{ index + 1 }} / {{ count }}</p>
      <div class="car__dots" role="tablist" :aria-label="'Choisir une diapositive'">
        <button
          v-for="(it, i) in items" :key="it.key" type="button" role="tab" class="car__dot"
          :class="{ 'car__dot--on': i === index }" :aria-selected="i === index" :aria-label="`Diapositive ${i + 1}`" @click="goTo(i)"
        ></button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.car { position: relative; margin: var(--s-3) 0; }
.car__track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; border-radius: var(--radius); outline-offset: 2px; overscroll-behavior-x: contain; }
.car__track::-webkit-scrollbar { display: none; }
.car__slide { flex: 0 0 100%; scroll-snap-align: center; scroll-snap-stop: always; min-width: 0; }
.car__slide :deep(.mimg), .car__slide :deep(.mvid) { margin: 0; }
.car__ph { aspect-ratio: 16 / 9; background: var(--surface-2); border-radius: var(--radius); }
.car__nav { position: absolute; top: 40%; transform: translateY(-50%); width: var(--tap); height: var(--tap); border-radius: 999px; border: 0; font-size: 32px; line-height: 1; background: var(--btn-bg); color: var(--btn-text); opacity: 0.92; cursor: pointer; }
.car__nav:disabled { opacity: 0.25; cursor: default; }
.car__nav--prev { left: var(--s-2); }
.car__nav--next { right: var(--s-2); }
.car__count { position: absolute; top: var(--s-2); right: var(--s-2); margin: 0; padding: 2px 10px; border-radius: 999px; background: var(--btn-bg); color: var(--btn-text); }
.car__dots { display: flex; justify-content: center; gap: 4px; margin-top: var(--s-1); flex-wrap: wrap; }
.car__dot { width: 28px; height: 28px; border: 0; background: none; padding: 0; cursor: pointer; position: relative; }
.car__dot::after { content: ''; position: absolute; inset: 9px; border-radius: 999px; background: var(--line-strong); }
.car__dot--on::after { background: var(--accent); inset: 7px; }
</style>
