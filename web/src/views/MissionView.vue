<script setup>
// Écran mission : formulaire du compte rendu, hors ligne d'abord.
//  · chaque frappe est enregistrée sur l'appareil (autosave) ; Notion suit toutes les ~5 min ;
//  · « Valider le CR » fige le formulaire et envoie tout de suite ; « Modifier à nouveau » le rouvre ;
//  · à deux sur la même fiche : fusion champ par champ, le plus récent gagne, l'écrasé est prévenu ;
//  · « Actualiser » récupère les changements de template sans toucher aux saisies.
import { ref, reactive, computed, watch, onUnmounted, nextTick } from 'vue'
import { liveQuery } from 'dexie'
import {
  findByReference, saveMission, getIntervention, listPhotos, setFields, addPhoto, removePhoto,
  addCustomField, removeCustomField, setReportStatus, resolveConflict, dismissNotice
} from '../db.js'
import { api } from '../lib/api.js'
import { createAutosaver } from '../lib/autosave.js'
import { prepareImage } from '../lib/image.js'
import { normalizeReference } from '../lib/ref.js'
import { missionStatus, formatDateTime, formatTime } from '../lib/format.js'
import { online } from '../lib/online.js'
import { DEFAULT_PREFIX } from '../config.js'
import { buildItems, effectiveStatus, fieldValue } from '../lib/shared.js'
import { buildOutline, jumpTargets, loadViewPrefs, saveViewPrefs, setAllCollapsed, ancestorSections } from '../lib/outline.js'
import { named, displayName, watch as watchSync } from '../lib/session.js'
import PropertiesPanel from '../components/PropertiesPanel.vue'
import IdentityCard from '../components/IdentityCard.vue'
import FieldInput from '../components/FieldInput.vue'
import CustomFieldForm from '../components/CustomFieldForm.vue'

const props = defineProps({ reference: { type: String, required: true } })

const mission = ref(null)
const rows = ref([])                        // photos locales (media_queue)
const state = ref('loading')                // loading | ready | missing | error
const error = ref('')
const draft = reactive({})                  // saisies pas encore écrites dans IndexedDB (affichage immédiat)
const touched = reactive(new Set())         // champs modifiés pendant cette session (restent visibles même remplis)
const saveState = ref('saved')
const saveError = ref('')
const photoBusy = reactive({})
const photoError = ref('')
const prefs = ref({ hideFilled: false, collapsed: {} })
const refreshMsg = ref('')
const refreshing = ref(false)
const syncing = ref(false)
const showMissing = ref(false)

let subMission, subRows, saver, sync

function teardown() {
  subMission && subMission.unsubscribe()
  subRows && subRows.unsubscribe()
  sync && sync.stop()
  saver && saver.dispose()
  subMission = subRows = sync = saver = null
}

async function load() {
  teardown()
  mission.value = null
  rows.value = []
  Object.keys(draft).forEach((k) => delete draft[k])
  touched.clear()
  state.value = 'loading'
  error.value = ''

  const wanted = normalizeReference(props.reference, DEFAULT_PREFIX) || props.reference
  let rec = await findByReference(wanted)
  if (!rec) {
    if (!online.value) { state.value = 'missing'; return }
    try {
      rec = await saveMission(await api.getIntervention(wanted))
    } catch (e) {
      state.value = e.code === 'NETWORK' ? 'missing' : 'error'
      error.value = e.code === 'NOT_FOUND' ? `Aucune mission « ${wanted} ».` : e.message
      return
    }
  }

  prefs.value = loadViewPrefs(rec.id)
  saver = createAutosaver(rec.id, {
    onState: (s, err) => {
      saveState.value = s
      saveError.value = s === 'error' ? (err && err.code === 'LOCKED' ? 'Le CR est validé : cette saisie n’a pas été enregistrée.' : 'Enregistrement local impossible. Réessai en cours…') : ''
    }
  })
  subMission = liveQuery(() => getIntervention(rec.id)).subscribe({ next: (r) => { mission.value = r } })
  subRows = liveQuery(() => listPhotos(rec.id)).subscribe({ next: (r) => { rows.value = r } })
  sync = watchSync(rec.id)
  state.value = 'ready'
}

watch(() => props.reference, load, { immediate: true })
onUnmounted(teardown)

// Une saisie rejoint IndexedDB : on retire l'écran temporaire correspondant.
watch(mission, (m) => {
  if (!m) return
  for (const id of Object.keys(draft)) {
    const stored = m.fields[id]
    if (stored && JSON.stringify(stored.v) === JSON.stringify(draft[id])) delete draft[id]
  }
})
watch(prefs, (p) => mission.value && saveViewPrefs(mission.value.id, p), { deep: true })

/* ───────────────────────────── Données d'affichage ───────────────────────────── */

const frozen = computed(() => !!mission.value && effectiveStatus(mission.value) === 'validated')
const status = computed(() => (mission.value ? missionStatus(mission.value) : null))
const items = computed(() => (mission.value ? buildItems(mission.value) : []))

const rowsBy = computed(() => {
  const m = {}
  for (const r of rows.value) (m[r.blockId] = m[r.blockId] || []).push(r)
  return m
})
const remoteBy = (id) => (mission.value && mission.value.shared && mission.value.shared.photos && mission.value.shared.photos[id]) || []
const photoCount = (id) => {
  const mine = (rowsBy.value[id] || []).filter((r) => r.uploadStatus !== 'failed')
  const ids = new Set(mine.map((r) => r.mediaId))
  return mine.length + remoteBy(id).filter((p) => !ids.has(p.mediaId)).length
}
const valueOf = (id) => (id in draft ? draft[id] : mission.value ? fieldValue(mission.value, id) : undefined)

const ctx = computed(() => ({
  value: valueOf,
  photos: photoCount,
  collapsed: prefs.value.collapsed,
  hideFilled: prefs.value.hideFilled,
  keep: new Set([...touched, ...Object.keys((mission.value && mission.value.conflicts) || {})])
}))
const outline = computed(() => buildOutline(items.value, ctx.value))
const jump = computed(() => jumpTargets(items.value, ctx.value))
const allCollapsed = computed(() => {
  const secs = items.value.filter((i) => i.k === 'section' && i.level <= 2)
  return secs.length > 0 && secs.every((s) => prefs.value.collapsed[s.id])
})
const byOther = (id) => {
  const f = mission.value && mission.value.fields[id]
  return f && f.by && f.by !== displayName.value && !f.dirty ? f.by : ''
}

const last = computed(() => (mission.value && mission.value.shared && mission.value.shared.last) || null)
const editors = computed(() => (mission.value && mission.value.shared && mission.value.shared.editors) || [])
const lastError = computed(() => (mission.value && mission.value.needsSync === 1 ? mission.value.lastError : null))
const errorText = computed(() => {
  const e = lastError.value
  if (!e) return ''
  const m = {
    NETWORK: 'Pas de réseau : réessai automatique.', TIMEOUT: 'Le serveur met trop de temps : réessai automatique.',
    UNAUTHORIZED: 'Connexion requise : reconnectez-vous (vos saisies sont conservées).',
    SESSION_EXPIRED: 'Session expirée : reconnectez-vous (vos saisies sont conservées).',
    NOT_FOUND: 'Fiche introuvable côté serveur.', BUSY: 'Serveur occupé : réessai automatique.'
  }
  return m[e.code] || `Envoi impossible (${e.message}). Réessai automatique.`
})

/* ──────────────────────────────── Actions ──────────────────────────────── */

function onUpdate(id, value) {
  draft[id] = value
  touched.add(id)
  saver.set(id, value)
}

async function onAddPhotos(fieldId, files) {
  photoError.value = ''
  photoBusy[fieldId] = true
  try {
    for (const file of files) {
      try {
        await addPhoto(mission.value.id, fieldId, await prepareImage(file), { fileName: `${fieldId}-${Date.now()}.jpg` })
      } catch (e) {
        photoError.value = e.message || 'Photo non ajoutée.'
      }
    }
  } finally {
    photoBusy[fieldId] = false
  }
}
const onRemovePhoto = (mediaId) => removePhoto(mediaId).catch((e) => (photoError.value = e.message))

async function onAddCustom(def) {
  const id = await addCustomField(mission.value.id, def)   // lève InvalidError (message lisible)
  touched.add(id)
  await nextTick()
}
const onRemoveCustom = (id) => removeCustomField(mission.value.id, id)

async function validate(force = false) {
  await saver.flush()
  if (!force && outline.value.missing.length) { showMissing.value = true; return }
  showMissing.value = false
  await setReportStatus(mission.value.id, 'validated')
  syncNow()
}
async function reopen() {
  await setReportStatus(mission.value.id, 'draft')
  syncNow()
}
async function syncNow() {
  syncing.value = true
  try { sync && (await sync.syncNow()) } finally { syncing.value = false }
}

async function refresh() {
  refreshMsg.value = ''
  if (!online.value) { refreshMsg.value = 'Pas de réseau : actualisation impossible pour l’instant.'; return }
  refreshing.value = true
  try {
    await saver.flush()
    const ids = (m) => new Set((m.templateBlocks || []).filter((b) => b.kind === 'component').map((b) => b.id))
    const before = ids(mission.value)
    const data = await api.getIntervention(mission.value.reference)
    await saveMission(data)
    const after = ids(data)
    const added = [...after].filter((i) => !before.has(i)).length
    const removed = [...before].filter((i) => !after.has(i)).length
    refreshMsg.value = added || removed
      ? `Template mis à jour : ${added} champ${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}${removed ? `, ${removed} retiré${removed > 1 ? 's' : ''}` : ''}. Vos saisies sont intactes.`
      : 'Template à jour. Vos saisies sont intactes.'
  } catch (e) {
    refreshMsg.value = e.code === 'NETWORK' ? 'Pas de réseau : actualisation impossible pour l’instant.' : `Actualisation impossible : ${e.message}`
  } finally {
    refreshing.value = false
  }
}

function toggleSection(id) {
  const c = { ...prefs.value.collapsed }
  if (c[id]) delete c[id]
  else c[id] = true
  prefs.value = { ...prefs.value, collapsed: c }
}
function toggleAll() {
  prefs.value = { ...prefs.value, collapsed: setAllCollapsed(items.value, !allCollapsed.value) }
}
function toggleHideFilled() {
  touched.clear()
  prefs.value = { ...prefs.value, hideFilled: !prefs.value.hideFilled }
}

async function scrollTo(selector, expandFor) {
  if (expandFor) {
    const open = { ...prefs.value.collapsed }
    ancestorSections(items.value, expandFor).forEach((s) => delete open[s])
    prefs.value = { ...prefs.value, collapsed: open }
  }
  await nextTick()
  const el = document.querySelector(selector)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return el
}
const onJump = async (e) => {
  const id = e.target.value
  e.target.value = ''
  if (id) {
    const open = { ...prefs.value.collapsed }
    delete open[id]
    prefs.value = { ...prefs.value, collapsed: open }
    await scrollTo(`[data-section="${CSS.escape(id)}"]`)
  }
}
async function goMissing(f) {
  const el = await scrollTo(`[data-field="${CSS.escape(f.id)}"]`, f.id)
  const input = el && el.querySelector('input, textarea, select, button')
  input && input.focus({ preventScroll: true })
}
const headingTag = (level) => 'h' + Math.min(level + 2, 5)
</script>

<template>
  <p><router-link to="/fiches">← Fiches</router-link></p>

  <p v-if="state === 'loading'" role="status">Chargement…</p>

  <div v-else-if="state === 'missing'" class="alert" role="alert">
    <strong>Mission absente de l'appareil.</strong>
    Connectez-vous au réseau une première fois pour la charger.
  </div>

  <div v-else-if="state === 'error'" class="alert" role="alert">{{ error }}</div>

  <template v-else-if="mission">
    <h2 class="m-ref">{{ mission.reference }}</h2>
    <h4 v-if="mission.title" class="m-title">{{ mission.title }}</h4>

    <IdentityCard mode="gate" class="gap" />

    <div v-if="mission.notice" class="note gap" role="status">
      <p>{{ mission.notice.message }}</p>
      <div class="btns">
        <button v-if="mission.notice.code === 'VALIDATED_BY_OTHER'" type="button" class="btn btn--ghost" @click="reopen">Modifier à nouveau</button>
        <button type="button" class="btn btn--ghost" @click="dismissNotice(mission.id)">Compris</button>
      </div>
    </div>

    <!-- État : où en est le CR, qui l'a touché en dernier, est-il parti dans Notion -->
    <section class="card status gap" aria-label="État du compte rendu">
      <div class="status__top">
        <span class="chip" :class="'chip--' + status.tone">{{ status.label }}</span>
        <span class="small muted" aria-live="polite">
          {{ saveState === 'saving' || saveState === 'dirty' ? 'Enregistrement…' : saveState === 'error' ? '' : 'Enregistré sur l’appareil' }}
        </span>
      </div>
      <p v-if="last" class="small muted status__line">Dernière modification : {{ last.by }} · {{ formatDateTime(last.at) }}</p>
      <p v-if="editors.length" class="small status__line">
        {{ editors.map((e) => e.name).join(', ') }} {{ editors.length > 1 ? 'consultent' : 'consulte' }} aussi cette fiche.
      </p>
      <p v-if="mission.lastSyncAt" class="small muted status__line">Envoyé dans Notion à {{ formatTime(mission.lastSyncAt) }}.</p>
      <p v-else-if="!named" class="small status__line">Indiquez votre nom pour que le CR parte dans Notion.</p>
      <p v-if="errorText" class="alert small status__line" role="alert">{{ errorText }}</p>
      <p v-if="saveError" class="alert small status__line" role="alert">{{ saveError }}</p>
      <div class="btns">
        <button type="button" class="btn btn--ghost" :disabled="syncing || !named || !online" @click="syncNow">
          {{ syncing ? 'Envoi…' : 'Envoyer maintenant' }}
        </button>
        <button type="button" class="btn btn--ghost" :disabled="refreshing || !online" @click="refresh">
          {{ refreshing ? 'Actualisation…' : 'Actualiser' }}
        </button>
      </div>
      <p v-if="refreshMsg" class="small status__line" role="status">{{ refreshMsg }}</p>
    </section>

    <PropertiesPanel :properties="mission.readOnlyData" />

    <p v-if="mission.templateWarnings && mission.templateWarnings.length" class="note small gap" role="status">
      {{ mission.templateWarnings.length }} point(s) à corriger dans le template Notion :
      {{ mission.templateWarnings.map((w) => w.message).join(' · ') }}
    </p>

    <p v-if="frozen" class="note gap" role="status">
      <strong>Compte rendu validé.</strong> Le formulaire est figé. « Modifier à nouveau » le rouvre pour tous.
    </p>

    <!-- Outils de lecture : repli, masquage des remplis, accès rapide -->
    <section class="tools gap" aria-label="Affichage du formulaire">
      <p class="small tools__progress">
        <strong>{{ outline.filled }} / {{ outline.total }}</strong> champs remplis
        <template v-if="outline.missing.length"> · <strong>{{ outline.missing.length }}</strong> obligatoire{{ outline.missing.length > 1 ? 's' : '' }} à compléter</template>
      </p>
      <div class="btns">
        <label class="sr-only" for="jump">Aller à une section</label>
        <select id="jump" class="input tools__jump" @change="onJump">
          <option value="">Aller à…</option>
          <option v-for="j in jump" :key="j.id" :value="j.id">{{ j.level > 1 ? '— ' : '' }}{{ j.text }} ({{ j.filled }}/{{ j.total }})</option>
        </select>
        <button type="button" class="btn btn--ghost" :aria-pressed="prefs.hideFilled" @click="toggleHideFilled">
          {{ prefs.hideFilled ? 'Afficher les champs remplis' : 'Masquer les champs remplis' }}
        </button>
        <button type="button" class="btn btn--ghost" @click="toggleAll">{{ allCollapsed ? 'Tout déplier' : 'Tout replier' }}</button>
      </div>
    </section>

    <p v-if="photoError" class="alert small gap" role="alert">{{ photoError }}</p>

    <form class="card form" novalidate @submit.prevent>
      <p v-if="!items.length" class="muted">Ce template ne contient aucun champ.</p>
      <template v-for="r in outline.rows" :key="r.id">
        <div v-if="r.k === 'section'" class="sec" :class="'sec--' + r.level" :data-section="r.id">
          <component :is="headingTag(r.level)" class="sec__h">
            <button v-if="r.collapsible" type="button" class="sec__btn" :aria-expanded="r.open" @click="toggleSection(r.id)">
              <svg class="sec__chev" :class="{ 'sec__chev--closed': !r.open }" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
              <span class="sec__text">{{ r.text }}</span>
              <span v-if="r.total" class="sec__count small" :class="{ 'sec__count--done': r.done }">{{ r.done ? '✓ ' : '' }}{{ r.filled }}/{{ r.total }}</span>
            </button>
            <template v-else>{{ r.text }}</template>
          </component>
          <p v-if="r.open && prefs.hideFilled && r.done" class="small muted">Tout est rempli.</p>
        </div>

        <FieldInput
          v-else-if="r.k === 'field'"
          :item="r.item" :value="valueOf(r.id)" :disabled="frozen"
          :conflict="mission.conflicts && mission.conflicts[r.id]"
          :rows="rowsBy[r.id] || []" :remote="remoteBy(r.id)" :busy="!!photoBusy[r.id]" :by="byOther(r.id)"
          @update="onUpdate(r.id, $event)"
          @add-photos="onAddPhotos(r.id, $event)" @remove-photo="onRemovePhoto"
          @keep-mine="resolveConflict(mission.id, r.id, 'mine')" @keep-theirs="resolveConflict(mission.id, r.id, 'theirs')"
          @remove-field="onRemoveCustom(r.id)"
        />

        <p v-else-if="r.k === 'text'" class="tmpl-text" :class="'tmpl-text--' + (r.item.style || 'paragraph')">{{ r.item.text }}</p>
        <hr v-else-if="r.k === 'divider'" class="tmpl-hr" />
      </template>
    </form>

    <CustomFieldForm class="gap" :disabled="frozen" :add="onAddCustom" />

    <!-- Validation -->
    <section class="card done gap" aria-labelledby="done-title">
      <h3 id="done-title" class="done__title">{{ frozen ? 'Compte rendu validé' : 'Terminer l’intervention' }}</h3>

      <div v-if="showMissing && outline.missing.length" class="alert" role="alert">
        <p><strong>{{ outline.missing.length }} champ{{ outline.missing.length > 1 ? 's' : '' }} obligatoire{{ outline.missing.length > 1 ? 's' : '' }} non rempli{{ outline.missing.length > 1 ? 's' : '' }} :</strong></p>
        <ul class="missing">
          <li v-for="f in outline.missing" :key="f.id">
            <button type="button" class="missing__btn" @click="goMissing(f)">{{ f.label || f.id }}</button>
          </li>
        </ul>
        <div class="btns">
          <button type="button" class="btn btn--ghost" @click="validate(true)">Valider quand même</button>
          <button type="button" class="btn btn--ghost" @click="showMissing = false">Compléter</button>
        </div>
      </div>

      <template v-else>
        <p v-if="!frozen" class="small muted">
          « Valider » fige le formulaire et envoie tout de suite le compte rendu dans Notion
          (dès que le réseau le permet). Vous pourrez le rouvrir.
        </p>
        <button v-if="!frozen" type="button" class="btn btn--block" @click="validate(false)">Valider le CR</button>
        <button v-else type="button" class="btn btn--block btn--ghost" @click="reopen">Modifier à nouveau</button>
        <p v-if="frozen && mission.needsSync === 1" class="small" role="status">
          {{ online ? 'Envoi en cours ou en attente de réessai.' : 'Hors ligne : le CR partira dès le retour du réseau.' }}
        </p>
      </template>
    </section>
  </template>
</template>

<style scoped>
.m-ref { margin-bottom: var(--s-1); }
.m-title { margin-bottom: var(--s-4); }
.gap { margin-top: var(--s-4); }
.btns { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.status__top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-2); }
.status__line { margin: 0 0 var(--s-2); }

.tools__progress { margin-bottom: var(--s-2); }
.tools__jump { width: auto; flex: 1 1 200px; min-width: 0; }

.form { margin-top: var(--s-4); }
.sec { margin-top: var(--s-4); border-top: 1px solid var(--line); padding-top: var(--s-2); }
.sec:first-child { margin-top: 0; border-top: 0; padding-top: 0; }
.sec__h { margin: 0; font-family: var(--f-display); color: var(--heading); }
h3.sec__h { font-size: var(--fs-h4); line-height: var(--lh-h4); font-weight: 600; }
h4.sec__h { font-size: 22px; line-height: 1.1; font-weight: 600; }
h5.sec__h { font-size: 18px; line-height: 1.2; font-weight: 600; margin-top: var(--s-2); }
.sec__btn {
  display: flex; align-items: center; gap: var(--s-2); width: 100%; min-height: var(--tap); padding: 0;
  border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.sec__text { flex: 1 1 auto; min-width: 0; }
.sec__chev { flex: none; transition: transform .15s; }
.sec__chev--closed { transform: rotate(-90deg); }
.sec__count { flex: none; font-family: var(--f-body); font-weight: 600; padding: 2px 10px; border-radius: 999px; background: var(--surface-2); color: var(--heading); border: 1px solid var(--line); }
.sec__count--done { background: var(--btn-bg); color: var(--btn-text); border-color: var(--btn-bg); }

.tmpl-text { margin: var(--s-2) 0; color: var(--text); }
.tmpl-text--quote, .tmpl-text--callout { border-left: 4px solid var(--ring); padding-left: var(--s-3); }
.tmpl-hr { border: 0; border-top: 1px solid var(--line); margin: var(--s-4) 0; }

.done__title { margin-bottom: var(--s-3); }
.missing { margin: 0 0 var(--s-3); padding: 0; list-style: none; display: grid; }
.missing__btn { min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--accent); font: 600 var(--fs-body)/1.3 var(--f-body); text-decoration: underline; text-underline-offset: 3px; text-align: left; cursor: pointer; }
</style>
