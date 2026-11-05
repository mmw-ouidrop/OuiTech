import test from 'node:test'
import assert from 'node:assert/strict'
import {
  effectiveStatus, serverFrozen, isFilled, buildItems, schemaFromTemplate, computeChanges, needsSync,
  mergeServerState, markAllDirty, restoreMine, dismissConflict, migrateV1Record, weaveItems, moveTarget, bottomAnchor
} from '../src/lib/shared.js'

const base = (o = {}) => ({
  id: 'p', fields: {}, custom: {}, customRemovals: [], photoRemovals: [], conflicts: {},
  shared: null, pendingStatus: null, status: 'draft', templateBlocks: [], ...o
})
const report = (o = {}) => ({ rev: 1, status: 'draft', fields: {}, custom: [], removedCustom: [], photos: {}, editors: [], ...o })
const row = (mediaId, uploadStatus, extra = {}) => ({ mediaId, blockId: 'photo', uploadStatus, driveFileId: uploadStatus === 'uploaded' ? 'F' + mediaId : null, createdAt: 5, ...extra })

test('statut effectif : la demande en attente prime ; gel côté serveur', () => {
  assert.equal(effectiveStatus(base()), 'draft')
  assert.equal(effectiveStatus(base({ shared: { status: 'validated' } })), 'validated')
  assert.equal(effectiveStatus(base({ shared: { status: 'validated' }, pendingStatus: { value: 'draft', at: 1 } })), 'draft')
  assert.equal(serverFrozen(base({ shared: { status: 'validated' } })), true)
  assert.equal(serverFrozen(base({ shared: { status: 'validated' }, pendingStatus: { value: 'draft', at: 1 } })), false)
  assert.equal(serverFrozen(base({ pendingStatus: { value: 'validated', at: 1 } })), false, 'pas encore validé côté serveur')
})

test('isFilled : textes, nombres (0 compte), cases, listes, photos', () => {
  assert.equal(isFilled({ type: 'text' }, '  '), false)
  assert.equal(isFilled({ type: 'text' }, 'a'), true)
  assert.equal(isFilled({ type: 'number' }, 0), true)
  assert.equal(isFilled({ type: 'checkbox' }, false), false)
  assert.equal(isFilled({ type: 'checkbox' }, true), true)
  assert.equal(isFilled({ type: 'checkbox_group' }, []), false)
  assert.equal(isFilled({ type: 'checkbox_group' }, ['A']), true)
  assert.equal(isFilled({ type: 'image_upload' }, undefined, 0), false)
  assert.equal(isFilled({ type: 'image_upload' }, undefined, 2), true)
})

test('buildItems : template puis section « Ajouts terrain » triée ; schemaFromTemplate', () => {
  const rec = base({
    templateBlocks: [
      { kind: 'section', level: 1, text: 'A', blockId: 'b1' },
      { kind: 'component', id: 'x', type: 'text', label: 'X', blockId: 'b2' },
      { kind: 'text', style: 'paragraph', text: 'consigne', blockId: 'b3' },
      { kind: 'divider', blockId: 'b4' },
      { kind: 'invalid', blockId: 'b5', error: 'm' },
      { kind: 'component', id: 'c', type: 'radio_group', label: 'C', options: ['1', '2'], blockId: 'b6' }
    ],
    custom: { u_2: { type: 'text', label: 'Deux', at: 20 }, u_1: { type: 'number', label: 'Un', at: 10 } }
  })
  const items = buildItems(rec)
  assert.deepEqual(items.map((i) => i.k + ':' + i.id), ['section:S:b1', 'field:x', 'text:T:b3', 'divider:D:b4', 'field:c', 'section:S:custom', 'field:u_1', 'field:u_2'])
  assert.deepEqual(schemaFromTemplate(rec.templateBlocks), [
    { k: 's', id: 'S:b1', text: 'A', level: 1 },
    { k: 'f', id: 'x', type: 'text', label: 'X' },
    { k: 'f', id: 'c', type: 'radio_group', label: 'C', options: ['1', '2'] }
  ])
})

test('computeChanges : seulement les champs « dirty » ; photos par lots de 6 ; validation en dernier', () => {
  const rec = base({ fields: { a: { v: 1, at: 10, dirty: true }, b: { v: 2, at: 11 } } })
  const rows = Array.from({ length: 8 }, (_, i) => row('m' + i, 'uploaded'))
  const p1 = computeChanges(rec, rows)
  assert.deepEqual(p1.changes.fields, { a: { v: 1, at: 10 } })
  assert.equal(p1.changes.photos.add.length, 6)
  assert.equal(p1.photosLeft, 2)
  assert.deepEqual(p1.sent.fields, { a: 10 })

  const withStatus = { ...rec, pendingStatus: { value: 'validated', at: 99 } }
  assert.equal(computeChanges(withStatus, rows).changes.status, undefined, 'photos restantes : pas de validation')
  const last = computeChanges(withStatus, rows.slice(0, 3))
  assert.deepEqual(last.changes.status, { value: 'validated', at: 99 })
  assert.equal(computeChanges(withStatus, [row('q', 'queued')]).changes.status, undefined, 'une photo pas encore dans Drive')
  assert.equal(computeChanges(base(), []).hasWork, false)
})

test('computeChanges : CR validé par un collègue = rien envoyé ; réouverture = tout envoyé', () => {
  const frozen = base({ shared: { status: 'validated' }, fields: { a: { v: 1, at: 10, dirty: true } } })
  assert.equal(computeChanges(frozen, [row('m', 'uploaded')]).hasWork, false)
  const reopen = { ...frozen, pendingStatus: { value: 'draft', at: 50 } }
  const c = computeChanges(reopen, [])
  assert.deepEqual(Object.keys(c.changes).sort(), ['fields', 'status'])
})

test('computeChanges : champs ajoutés, suppressions, photos retirées', () => {
  const rec = base({
    custom: { u_a1b2c3: { type: 'radio_group', label: 'Accès', options: ['A', 'B'], at: 7, dirty: true }, u_old000: { type: 'text', label: 'Ancien', at: 1 } },
    customRemovals: [{ id: 'u_gone00', at: 9 }],
    photoRemovals: [{ mediaId: 'mm', at: 8 }]
  })
  const c = computeChanges(rec, []).changes
  assert.deepEqual(c.custom.add, [{ id: 'u_a1b2c3', type: 'radio_group', label: 'Accès', options: ['A', 'B'], at: 7 }])
  assert.deepEqual(c.custom.remove, [{ id: 'u_gone00', at: 9 }])
  assert.deepEqual(c.photos.remove, [{ mediaId: 'mm', at: 8 }])
})

test('needsSync', () => {
  assert.equal(needsSync(base()), false)
  assert.equal(needsSync(base({ fields: { a: { v: 1, at: 1, dirty: true } } })), true)
  assert.equal(needsSync(base({ pendingStatus: { value: 'draft', at: 1 } })), true)
  assert.equal(needsSync(base(), [row('m', 'done')]), false)
  assert.equal(needsSync(base(), [row('m', 'queued')]), true)
  assert.equal(needsSync(base({ customRemovals: [{ id: 'u', at: 1 }] })), true)
})

test('fusion : valeur d’un collègue reprise, saisie en cours conservée', () => {
  const rec = base({ fields: { a: { v: 'ancien', at: 1 }, b: { v: 'ma saisie', at: 50, dirty: true } } })
  const r = report({ fields: { a: { v: 'collègue', at: 40, by: 'Sophie Martin' }, b: { v: 'autre', at: 30, by: 'Sophie Martin' } } })
  const { patch } = mergeServerState(rec, r, {})
  assert.deepEqual(patch.fields.a, { v: 'collègue', at: 40, by: 'Sophie Martin' })
  assert.equal(patch.fields.b.v, 'ma saisie')
  assert.equal(patch.fields.b.dirty, true)
  assert.equal(patch.baseRev, 1)
  assert.equal(patch.shared.fields, undefined, 'les valeurs ne sont pas dupliquées dans shared')
})

test('fusion : envoi acquitté ; modifiée pendant l’envoi = reste à envoyer', () => {
  const rec = base({ fields: { a: { v: 2, at: 20, dirty: true }, b: { v: 'neuf', at: 60, dirty: true } } })
  const sent = { fields: { a: 20, b: 55 }, status: null, customAdd: [], customRemove: [], photoRemove: [] }
  const r = report({ fields: { a: { v: 2, at: 20, by: 'Moi' }, b: { v: 'vieux', at: 55, by: 'Moi' } } })
  const { patch } = mergeServerState(rec, r, { sent })
  assert.equal(patch.fields.a.dirty, undefined, 'a acquittée')
  assert.equal(patch.fields.b.dirty, true, 'b a changé depuis l’envoi')
  assert.equal(patch.fields.b.v, 'neuf')
})

test('fusion : conflit enregistré avec « la mienne » et « la sienne »', () => {
  const rec = base({ fields: { a: { v: 'Neuf', at: 10, dirty: true } } })
  const sent = { fields: { a: 10 }, status: null, customAdd: [], customRemove: [], photoRemove: [] }
  const theirs = { v: 'Usagé', by: 'Sophie Martin', at: 20 }
  const r = report({ fields: { a: { ...theirs } } })
  const { patch, conflicts } = mergeServerState(rec, r, { sent, overridden: [{ id: 'a', mine: 'Neuf', theirs }] })
  assert.equal(patch.fields.a.v, 'Usagé')
  assert.deepEqual(conflicts.a, { mine: 'Neuf', theirs })
  // « Remettre la mienne » : nouvelle saisie datée de maintenant, à renvoyer
  const back = restoreMine({ ...rec, ...patch }, 'a', 999)
  assert.deepEqual(back.fields.a, { v: 'Neuf', at: 999, dirty: true })
  assert.equal(back.conflicts.a, undefined)
  assert.deepEqual(dismissConflict({ conflicts: { a: 1, b: 2 } }, 'a').conflicts, { b: 2 })
  assert.equal(restoreMine(rec, 'zzz'), null)
})

test('fusion : CR validé par ailleurs — mes saisies refusées restent à moi', () => {
  const rec = base({ fields: { a: { v: 'ma valeur', at: 10, dirty: true } } })
  const sent = { fields: { a: 10 }, status: null, customAdd: [], customRemove: [], photoRemove: [] }
  const r = report({ status: 'validated', fields: { a: { v: 'validé avant', at: 5, by: 'Sophie Martin' } } })
  const { patch } = mergeServerState(rec, r, { sent, rejected: { fields: ['a'], custom: [], photos: [], status: false, reason: 'VALIDATED' } })
  assert.equal(patch.fields.a.v, 'ma valeur')
  assert.equal(patch.fields.a.dirty, true)
  assert.equal(patch.status, 'validated')
})

test('fusion : champ inconnu du serveur — on arrête de le renvoyer', () => {
  const rec = base({ fields: { fantome: { v: 1, at: 3, dirty: true } } })
  const sent = { fields: { fantome: 3 }, status: null, customAdd: [], customRemove: [], photoRemove: [] }
  const { patch } = mergeServerState(rec, report(), { sent })
  assert.equal(patch.fields.fantome.dirty, false)
})

test('fusion : statut — ma demande acquittée ; une demande postérieure à l’envoi reste', () => {
  const rec = base({ pendingStatus: { value: 'validated', at: 7 }, status: 'validated' })
  const sent = { fields: {}, status: { value: 'validated', at: 7 }, customAdd: [], customRemove: [], photoRemove: [] }
  assert.equal(mergeServerState(rec, report({ status: 'validated' }), { sent }).patch.pendingStatus, null)
  const later = { ...rec, pendingStatus: { value: 'draft', at: 9 } }
  const m = mergeServerState(later, report({ status: 'validated' }), { sent })
  assert.deepEqual(m.patch.pendingStatus, { value: 'draft', at: 9 })
  assert.equal(m.patch.status, 'draft')
  // le serveur a refusé ma validation (réouverture plus récente) : on adopte son état
  const refused = mergeServerState(rec, report({ status: 'draft' }), { sent, rejected: { fields: [], custom: [], photos: [], status: true } })
  assert.equal(refused.patch.status, 'draft')
})

test('fusion : champs ajoutés des collègues, acquittement, suppressions', () => {
  const rec = base({
    custom: { u_mine00: { type: 'text', label: 'Moi', at: 5, dirty: true }, u_loc000: { type: 'text', label: 'Pas encore envoyé', at: 6, dirty: true } },
    customRemovals: [{ id: 'u_x00000', at: 8 }]
  })
  const sent = { fields: {}, status: null, customAdd: ['u_mine00'], customRemove: ['u_x00000'], photoRemove: [] }
  const r = report({ custom: [{ id: 'u_mine00', type: 'text', label: 'Moi', by: 'Moi', at: 5 }, { id: 'u_col000', type: 'number', label: 'Collègue', by: 'Sophie', at: 9 }, { id: 'u_x00000', type: 'text', label: 'X', at: 1 }], removedCustom: ['u_old000'] })
  const { patch } = mergeServerState(rec, r, { sent })
  assert.deepEqual(Object.keys(patch.custom).sort(), ['u_col000', 'u_loc000', 'u_mine00'].sort())
  assert.equal(patch.custom.u_mine00.dirty, undefined, 'acquitté')
  assert.equal(patch.custom.u_loc000.dirty, true, 'ajouté après l’envoi')
  assert.deepEqual(patch.customRemovals, [{ id: 'u_x00000', at: 8 }], 'toujours actif côté serveur : à renvoyer')
  assert.equal(patch.custom.u_x00000, undefined, 'masqué en attendant')
  const done = mergeServerState({ ...rec, ...patch }, report({ custom: [{ id: 'u_mine00', type: 'text', label: 'Moi', at: 5 }], removedCustom: ['u_x00000'] }), {})
  assert.deepEqual(done.patch.customRemovals, [])
})

test('fusion : photos acquittées et retraits', () => {
  const rec = base({ photoRemovals: [{ mediaId: 'm2', at: 1 }, { mediaId: 'm9', at: 2 }] })
  const r = report({ photos: { photo: [{ mediaId: 'm1', by: 'Moi', at: 1 }, { mediaId: 'm2', by: 'Moi', at: 1 }] } })
  const m = mergeServerState(rec, r, { localMediaIds: ['m1', 'm3'] })
  assert.deepEqual(m.ackedMediaIds, ['m1'])
  assert.deepEqual(m.patch.photoRemovals, [{ mediaId: 'm2', at: 1 }], 'm9 n’existe plus côté serveur : retrait terminé')
})

test('markAllDirty : le serveur a perdu le rapport', () => {
  const rec = base({ status: 'validated', fields: { a: { v: 1, at: 1 } }, custom: { u_a: { type: 'text', label: 'x', at: 1 } } })
  const p = markAllDirty(rec)
  assert.equal(p.fields.a.dirty, true)
  assert.equal(p.custom.u_a.dirty, true)
  assert.equal(p.pendingStatus.value, 'validated')
})

test('migration v1 → v2 : valeurs horodatées à envoyer, photos exclues, validation conservée', () => {
  const v1 = {
    id: 'p', status: 'validated', validatedAt: 77, lastUpdated: 55, syncStatus: 'pending',
    templateBlocks: [{ kind: 'component', id: 'photo', type: 'image_upload', label: 'P' }, { kind: 'component', id: 'n', type: 'text', label: 'N' }],
    formData: { n: 'RAS', photo: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] }
  }
  const m = migrateV1Record(v1, 1000)
  assert.deepEqual(m.fields, { n: { v: 'RAS', at: 55, dirty: true } })
  assert.deepEqual(m.pendingStatus, { value: 'validated', at: 77 })
  assert.equal(m.status, 'validated')
  assert.equal(m.shared, null)
  assert.equal(m.needsSync, 1)
  assert.deepEqual(m.schema.map((s) => s.id), ['photo', 'n'])
  assert.equal(migrateV1Record({ ...v1, status: 'draft' }).pendingStatus, null)
})

/* ───────────────────── Champs ajoutés placés dans le formulaire ───────────────────── */

const tpl = [
  { kind: 'section', level: 1, text: 'NAV', blockId: 's1' },
  { kind: 'text', style: 'paragraph', text: 'Consigne', blockId: 't1' },
  { kind: 'component', id: 'e1', type: 'checkbox', label: 'Étape 1', blockId: 'c1' },
  { kind: 'text', style: 'paragraph', text: 'Note de l’étape 1', blockId: 't2' },
  { kind: 'component', id: 'e2', type: 'checkbox', label: 'Étape 2', blockId: 'c2' },
  { kind: 'section', level: 1, text: 'FIN', blockId: 's2' },
  { kind: 'component', id: 'e3', type: 'text', label: 'Remarque', blockId: 'c3' }
]
const cf = (label, after, at, extra = {}) => ({ type: 'text', label, ...(after !== undefined ? { after } : {}), at, ...extra })
const shape = (rec) => buildItems(rec).map((i) => (i.k === 'field' ? (i.custom ? '+' : '') + (i.label || i.id) : i.k === 'section' ? '#' + i.text : i.k === 'text' ? '“' + i.text : i.k))

test('placement : sous son repère, après les notes qui le suivent, avant le champ suivant', () => {
  const rec = base({ templateBlocks: tpl, custom: { u_a: cf('A', 'e1', 10) } })
  assert.deepEqual(shape(rec), ['#NAV', '“Consigne', 'Étape 1', '“Note de l’étape 1', '+A', 'Étape 2', '#FIN', 'Remarque'])
  // sous une section : après sa consigne, avant son premier champ
  assert.deepEqual(shape(base({ templateBlocks: tpl, custom: { u_a: cf('A', 's1:x', 1), u_b: cf('B', 'S:s1', 2) } })).slice(0, 4), ['#NAV', '“Consigne', '+B', 'Étape 1'])
  // « ^ » : tout en haut
  assert.equal(shape(base({ templateBlocks: tpl, custom: { u_a: cf('A', '^', 1) } }))[0], '+A')
})

test('placement : le plus récent d’abord sous le même repère, chaînes, bas du formulaire', () => {
  const rec = base({ templateBlocks: tpl, custom: { u_a: cf('A', 'e2', 10), u_b: cf('B', 'e2', 20), u_c: cf('C', 'u_a', 30) } })
  assert.deepEqual(shape(rec).slice(4, 9), ['Étape 2', '+B', '+A', '+C', '#FIN'])
  // un déplacement (mv) fait foi sur la date d'ajout
  rec.custom.u_a.mv = 99
  assert.deepEqual(shape(rec).slice(4, 9), ['Étape 2', '+A', '+C', '+B', '#FIN'])
  // sans repère, ou repère introuvable : sous « Ajouts terrain », par date
  const legacy = base({ templateBlocks: tpl, custom: { u_x: cf('X', undefined, 5), u_y: cf('Y', 'inconnu', 3) } })
  assert.deepEqual(shape(legacy).slice(-3), ['#Ajouts terrain', '+Y', '+X'])
  // boucle (deux déplacements simultanés) : tout reste affiché, en bas
  const loop = base({ templateBlocks: tpl, custom: { u_p: cf('P', 'u_q', 1), u_q: cf('Q', 'u_p', 2) } })
  assert.equal(shape(loop).filter((x) => x === '+P' || x === '+Q').length, 2)
  assert.equal(bottomAnchor(buildItems(rec)), 'e3')
  assert.equal(bottomAnchor([]), '^')
})

test('déplacer un champ ajouté : voisin au-dessus / au-dessous, chaîne conservée, bornes', () => {
  const rec = base({ templateBlocks: tpl, custom: { u_a: cf('A', 'e1', 10) } })
  const go = (r, id, dir) => moveTarget(buildItems(r), id, dir, r.custom)
  assert.deepEqual(go(rec, 'u_a', 'down'), { after: 'e2' })          // « Étape 2 » passe au-dessus de A
  assert.deepEqual(go(rec, 'u_a', 'up'), { after: 'S:s1' })           // A passe devant « Étape 1 »
  rec.custom.u_a.after = 'S:s1'
  assert.deepEqual(go(rec, 'u_a', 'up'), { after: '^' })
  rec.custom.u_a.after = '^'
  assert.equal(go(rec, 'u_a', 'up'), null, 'déjà tout en haut')
  // en bas du formulaire : plus de « descendre »
  const last = base({ templateBlocks: tpl, custom: { u_z: cf('Z', 'e3', 1) } })
  assert.equal(go(last, 'u_z', 'down'), null)
  // les champs placés sous lui le suivent
  const chain = base({ templateBlocks: tpl, custom: { u_a: cf('A', 'e1', 10), u_b: cf('B', 'u_a', 11) } })
  assert.deepEqual(go(chain, 'u_a', 'down'), { after: 'e2' })
  const moved = { ...chain, custom: { ...chain.custom, u_a: { ...chain.custom.u_a, after: 'e2', mv: 50 } } }
  assert.deepEqual(shape(moved).slice(2, 8), ['Étape 1', '“Note de l’étape 1', 'Étape 2', '+A', '+B', '#FIN'])
  // franchir l'intertitre « Ajouts terrain » : sort de la section
  const heading = base({ templateBlocks: tpl, custom: { u_x: cf('X', undefined, 1), u_y: cf('Y', undefined, 2) } })
  assert.deepEqual(go(heading, 'u_x', 'up'), { after: 'e3' })
  assert.deepEqual(go(heading, 'u_x', 'down'), { after: 'u_y' })
})

test('synchro : ajout avec repère, déplacement envoyé puis acquitté, déplacement plus récent conservé', () => {
  const rec = base({ templateBlocks: tpl, custom: { u_a: { ...cf('A', 'e1', 10), dirty: true }, u_b: { ...cf('B', 'e2', 11), mv: 40, moved: true } }, baseRev: 1 })
  const { changes, sent } = computeChanges(rec)
  assert.deepEqual(changes.custom.add, [{ id: 'u_a', type: 'text', label: 'A', after: 'e1', at: 10 }])
  assert.deepEqual(changes.custom.move, [{ id: 'u_b', after: 'e2', at: 40 }])
  assert.deepEqual(sent.customMove, { u_b: 40 })
  assert.equal(needsSync(base({ custom: { u_b: { type: 'text', label: 'B', at: 1, moved: true, mv: 2 } } })), true)
  const serverCustom = [{ id: 'u_a', type: 'text', label: 'A', by: 'Moi', at: 10, after: 'e1' }, { id: 'u_b', type: 'text', label: 'B', by: 'Moi', at: 11, after: 'e2', mv: 41 }]
  // acquitté : la version du serveur fait foi
  const ok = mergeServerState(rec, report({ rev: 2, custom: serverCustom }), { sent })
  assert.equal(ok.patch.custom.u_b.moved, undefined)
  assert.equal(ok.patch.custom.u_b.mv, 41)
  // déplacé de nouveau depuis l'envoi : ma position reste et repartira
  const again = { ...rec, custom: { ...rec.custom, u_b: { ...rec.custom.u_b, after: 'e3', mv: 60 } } }
  const keep = mergeServerState(again, report({ rev: 2, custom: serverCustom }), { sent })
  assert.equal(keep.patch.custom.u_b.after, 'e3')
  assert.equal(keep.patch.custom.u_b.moved, true)
  // déplacement d'un collègue, rien de local en attente : on le reprend
  const mine = base({ custom: { u_b: { type: 'text', label: 'B', at: 11, after: 'e2' } } })
  const theirs = mergeServerState(mine, report({ rev: 3, custom: [{ id: 'u_b', type: 'text', label: 'B', by: 'Sophie', at: 11, after: '^', mv: 70 }] }), {})
  assert.equal(theirs.patch.custom.u_b.after, '^')
})
