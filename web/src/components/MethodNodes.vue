<script setup>
// Rend le corps d'une fiche méthode (nœuds produits par gas/Methods.gs). S'appelle lui-même pour les niveaux imbriqués.
import { computed } from 'vue'
import { groupNodes, segmentsText } from '../lib/methods.js'
import RichText from './RichText.vue'
import MethodImage from './MethodImage.vue'
import MethodVideo from './MethodVideo.vue'
import MethodFile from './MethodFile.vue'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  pageId: { type: String, required: true },
  mode: { type: String, default: 'default' },      // 'default' | 'steps' (listes numérotées en étapes) | 'checklist' (matériel, outils)
  skipKey: { type: String, default: '' }           // média déjà affiché en tête de fiche
})

const items = computed(() => groupNodes(props.nodes).filter((n) => !(n.k === 'image' && n.key === props.skipKey)))
const text = segmentsText
</script>

<template>
  <template v-for="(n, i) in items" :key="i">
    <h4 v-if="n.k === 'h'" class="mh" :class="'mh--' + n.l"><RichText :segments="n.rt" /></h4>
    <p v-else-if="n.k === 'p' && n.rt.length" class="mp"><RichText :segments="n.rt" /></p>

    <ol v-else-if="n.k === 'list' && n.type === 'ol' && mode === 'steps'" class="steps">
      <li v-for="(it, j) in n.items" :key="j" class="steps__item">
        <span class="steps__n" aria-hidden="true">{{ j + 1 }}</span>
        <div class="steps__body">
          <p class="steps__text"><RichText :segments="it.rt" /></p>
          <MethodNodes v-if="it.kids && it.kids.length" :nodes="it.kids" :page-id="pageId" :mode="mode" :skip-key="skipKey" />
        </div>
      </li>
    </ol>
    <ul v-else-if="n.k === 'list' && mode === 'checklist'" class="checks">
      <li v-for="(it, j) in n.items" :key="j">
        <label class="checks__row"><input type="checkbox" /><span><RichText :segments="it.rt" /></span></label>
        <MethodNodes v-if="it.kids && it.kids.length" :nodes="it.kids" :page-id="pageId" :mode="mode" :skip-key="skipKey" />
      </li>
    </ul>
    <component :is="n.type" v-else-if="n.k === 'list'" class="mlist">
      <li v-for="(it, j) in n.items" :key="j">
        <RichText :segments="it.rt" />
        <MethodNodes v-if="it.kids && it.kids.length" :nodes="it.kids" :page-id="pageId" :mode="mode" :skip-key="skipKey" />
      </li>
    </component>

    <label v-else-if="n.k === 'todo'" class="checks__row"><input type="checkbox" :checked="n.done" /><span><RichText :segments="n.rt" /></span></label>
    <blockquote v-else-if="n.k === 'quote'" class="mquote"><RichText :segments="n.rt" /></blockquote>
    <div v-else-if="n.k === 'callout'" class="note mcallout">
      <span v-if="n.icon" aria-hidden="true">{{ n.icon }} </span><RichText :segments="n.rt" />
      <MethodNodes v-if="n.kids && n.kids.length" :nodes="n.kids" :page-id="pageId" :mode="mode" :skip-key="skipKey" />
    </div>
    <details v-else-if="n.k === 'toggle'" class="mtoggle">
      <summary><RichText :segments="n.rt" /></summary>
      <MethodNodes :nodes="n.kids || []" :page-id="pageId" :mode="mode" :skip-key="skipKey" />
    </details>
    <hr v-else-if="n.k === 'hr'" class="mhr" />
    <pre v-else-if="n.k === 'code'" class="mcode"><code>{{ n.text }}</code></pre>

    <MethodImage v-else-if="n.k === 'image'" :page-id="pageId" :media-key="n.key" :caption="text(n.cap)" />
    <MethodVideo v-else-if="n.k === 'video'" :page-id="pageId" :url="n.url || ''" :media-key="n.key || ''" :caption="text(n.cap)" />
    <p v-else-if="n.k === 'file'" class="mp"><MethodFile :page-id="pageId" :media-key="n.key" :name="n.name" /></p>
    <p v-else-if="n.k === 'link'" class="mp"><a :href="n.url" target="_blank" rel="noopener noreferrer" class="mlink">{{ n.title }}</a></p>

    <div v-else-if="n.k === 'table'" class="mtable">
      <table>
        <tbody>
          <tr v-for="(row, r) in n.rows" :key="r">
            <component :is="n.header && r === 0 ? 'th' : 'td'" v-for="(cell, c) in row" :key="c"><RichText :segments="cell" /></component>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style scoped>
.mp { margin: var(--s-2) 0; overflow-wrap: anywhere; }
.mh { margin: var(--s-4) 0 var(--s-2); color: var(--heading); }
.mlist { margin: var(--s-2) 0; padding-left: var(--s-5); }
.mlist li { margin: var(--s-1) 0; }
.mquote { margin: var(--s-3) 0; padding-left: var(--s-3); border-left: 4px solid var(--ring); color: var(--text-muted); }
.mcallout { margin: var(--s-3) 0; }
.mtoggle { margin: var(--s-2) 0; border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s-2) var(--s-3); }
.mtoggle summary { cursor: pointer; font-weight: 600; min-height: var(--tap); display: flex; align-items: center; }
.mhr { border: 0; border-top: 1px solid var(--line); margin: var(--s-4) 0; }
.mcode { margin: var(--s-3) 0; padding: var(--s-3); background: var(--surface-2); border-radius: var(--radius); overflow-x: auto; font-size: 0.9em; }
.mlink { color: var(--accent); text-decoration: underline; overflow-wrap: anywhere; }
.mtable { overflow-x: auto; margin: var(--s-3) 0; }
.mtable table { border-collapse: collapse; min-width: 100%; }
.mtable th, .mtable td { border: 1px solid var(--line); padding: var(--s-2) var(--s-3); text-align: left; vertical-align: top; }
.mtable th { background: var(--surface-2); }

.steps { list-style: none; margin: var(--s-3) 0; padding: 0; display: grid; gap: var(--s-4); }
.steps__item { display: grid; grid-template-columns: 40px 1fr; gap: var(--s-3); align-items: start; }
.steps__n { width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center; background: var(--btn-bg); color: var(--btn-text); font: 700 22px/1 var(--f-display); }
.steps__text { margin: 0 0 var(--s-1); font-weight: 600; padding-top: 6px; overflow-wrap: anywhere; }
.steps__body { min-width: 0; }

.checks { list-style: none; margin: var(--s-2) 0; padding: 0; }
.checks__row { display: flex; gap: var(--s-3); align-items: flex-start; min-height: var(--tap); padding: var(--s-2) 0; cursor: pointer; }
.checks__row input { width: 22px; height: 22px; margin-top: 2px; flex: none; accent-color: var(--accent); }
</style>
