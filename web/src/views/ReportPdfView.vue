<script setup>
// Compte rendu prêt à imprimer : « Télécharger en PDF » ouvre la boîte d'impression du téléphone ou de
// l'ordinateur (choisir « Enregistrer en PDF ») ; le fichier se consulte ou se partage ensuite. Tout vient
// des données locales : fonctionne hors ligne. Photos intégrées ; vidéos et fichiers listés par leur nom.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { findByReference, listPhotos } from '../db.js'
import { normalizeReference } from '../lib/ref.js'
import { DEFAULT_PREFIX } from '../config.js'
import { buildReport, fileLine } from '../lib/reportPdf.js'
import { missionStatus, formatDateTime } from '../lib/format.js'
import { kindOf } from '../lib/attachments.js'

const props = defineProps({ reference: { type: String, required: true } })
const state = ref('loading')
const report = ref(null)
const status = ref(null)
const urls = []
const prevTitle = document.title

function urlFor(row) {
  const u = URL.createObjectURL(row.fileBlob)
  urls.push(u)
  return u
}

const urlsById = ref({})
onMounted(async () => {
  const wanted = normalizeReference(props.reference, DEFAULT_PREFIX) || props.reference
  const rec = await findByReference(wanted)
  if (!rec) { state.value = 'missing'; return }
  const rows = await listPhotos(rec.id)
  report.value = buildReport(rec, rows)
  status.value = missionStatus(rec)
  const map = {}
  for (const r of rows) if (r.uploadStatus !== 'failed' && kindOf(r.mimeType, r.fileName) === 'image') map[r.mediaId] = urlFor(r)
  urlsById.value = map
  document.title = `CR ${rec.reference}`          // nom proposé au fichier PDF
  state.value = 'ready'
})
onBeforeUnmount(() => { urls.forEach((u) => URL.revokeObjectURL(u)); document.title = prevTitle })

function print() { window.print() }
const printedAt = computed(() => formatDateTime(Date.now()))
const images = (f) => f.photos.filter((p) => p.kind === 'image')
const others = (f) => f.photos.filter((p) => p.kind !== 'image')
</script>

<template>
  <section class="pdf">
    <div class="pdf__bar no-print">
      <router-link :to="{ name: 'mission', params: { reference } }" class="btn btn--ghost">← Retour à la fiche</router-link>
      <button v-if="state === 'ready'" type="button" class="btn" @click="print">Télécharger en PDF</button>
    </div>
    <p v-if="state === 'ready'" class="small muted no-print">
      Dans la fenêtre qui s’ouvre, choisissez « Enregistrer en PDF » (ou « Partager » sur téléphone) pour obtenir le fichier.
    </p>
    <p v-if="state === 'loading'" class="muted" role="status">Chargement…</p>
    <p v-else-if="state === 'missing'" class="alert">Cette fiche n’est pas enregistrée sur cet appareil : ouvrez-la d’abord.</p>

    <article v-else-if="report" class="doc">
      <header class="doc__head">
        <h1>Compte rendu d’intervention</h1>
        <p class="doc__ref"><strong>{{ report.reference }}</strong><template v-if="report.title && report.title !== report.reference"> — {{ report.title }}</template></p>
        <p class="small muted">Statut : {{ status && status.label }} · Édité le {{ printedAt }}</p>
      </header>

      <dl v-if="report.props.length" class="doc__props">
        <template v-for="p in report.props" :key="p.label"><dt>{{ p.label }}</dt><dd>{{ p.text }}</dd></template>
      </dl>

      <section v-if="report.actions.length" class="doc__sec">
        <h2>Actions réalisées</h2>
        <div v-for="a in report.actions" :key="a.id" class="doc__field">
          <h3>{{ a.title }} — {{ a.state }}</h3>
          <p v-for="(e, i) in a.entries" :key="i" class="doc__val small">{{ formatDateTime(e.at) }} · {{ e.by }}{{ e.state ? ' · ' + e.state : '' }}{{ e.text ? ' : ' + e.text : '' }}</p>
        </div>
      </section>

      <section v-for="s in report.sections" :key="s.id || 'top'" class="doc__sec">
        <h2 v-if="s.text" :class="'lvl' + s.level">{{ s.text }}</h2>
        <div v-for="f in s.fields" :key="f.id" class="doc__field">
          <h3>{{ f.label }}</h3>
          <template v-if="f.type === 'image_upload'">
            <p v-if="f.empty" class="muted">Aucun fichier.</p>
            <div v-if="images(f).length" class="doc__imgs">
              <img v-for="p in images(f)" :key="p.mediaId" :src="urlsById[p.mediaId]" alt="" />
            </div>
            <ul v-if="others(f).length" class="doc__files"><li v-for="p in others(f)" :key="p.mediaId">{{ fileLine(p) }}</li></ul>
            <p v-if="f.remote" class="small muted">+ {{ f.remote }} fichier{{ f.remote > 1 ? 's' : '' }} ajouté{{ f.remote > 1 ? 's' : '' }} depuis un autre appareil (consultable dans Notion).</p>
          </template>
          <p v-else :class="{ muted: f.empty }" class="doc__val">{{ f.empty ? 'Non renseigné' : f.text }}</p>
        </div>
      </section>
    </article>
  </section>
</template>

<style scoped>
.pdf { display: grid; gap: var(--s-3); }
.pdf__bar { display: flex; gap: var(--s-3); flex-wrap: wrap; }
.doc { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s-4); display: grid; gap: var(--s-3); }
.doc h1 { font-size: 1.4rem; margin: 0; }
.doc h2 { font-size: 1.15rem; margin: var(--s-3) 0 var(--s-1); border-bottom: 2px solid var(--line); break-after: avoid; }
.doc h3 { font-size: .95rem; margin: 0; color: var(--text-muted); font-weight: 600; break-after: avoid; }
.doc__props { display: grid; grid-template-columns: max-content 1fr; gap: 2px var(--s-3); margin: 0; font-size: .9rem; }
.doc__props dt { color: var(--text-muted); }
.doc__props dd { margin: 0; }
.doc__field { break-inside: avoid; display: grid; gap: 2px; margin-bottom: var(--s-2); }
.doc__val { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.doc__imgs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--s-2); }
.doc__imgs img { width: 100%; max-height: 90mm; object-fit: contain; border: 1px solid var(--line); break-inside: avoid; }
.doc__files { margin: 0; padding-left: 1.2em; }
@media print {
  .doc { border: 0; padding: 0; }
  .doc__imgs { grid-template-columns: repeat(2, 1fr); }
}
</style>
