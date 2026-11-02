import test from 'node:test'
import assert from 'node:assert/strict'
import { toCode, fromCode, parseCode } from '../src/lib/templateCode.js'
import { fromServer, toPayload, signature, validateItems } from '../src/lib/templateEditor.js'

const server = () => fromServer([
  { t: 'section', ref: 'a1', level: 1, text: 'Avant d’intervenir' },
  { t: 'text', ref: 'a2', style: 'paragraph', text: 'Vérifiez l’accès.\nPuis la zone.', rich: true },
  { t: 'text', ref: 'a3', style: 'bulleted_list', text: 'Point un' },
  { t: 'text', ref: 'a4', style: 'numbered_list', text: 'Étape' },
  { t: 'text', ref: 'a5', style: 'quote', text: 'Citation' },
  { t: 'text', ref: 'a6', style: 'callout', text: 'Attention' },
  { t: 'text', ref: 'a7', style: 'paragraph', text: '# pas un titre' },
  { t: 'todo', ref: 'a8', text: 'Identité vérifiée' },
  { t: 'divider', ref: 'a9' },
  { t: 'field', ref: 'b1', type: 'radio_group', id: 'acces', label: 'Accès', options: ['Libre', 'Clé'], required: true, placeholder: '', unit: '', extra: { help: 'Au choix' } },
  { t: 'field', ref: 'b2', type: 'number', id: 'index', label: 'Index', placeholder: 'Ex. 12', unit: 'kWh', required: false, extra: {} },
  { t: 'html', ref: 'b3', html: '<p>Bonjour</p>\n<pre>```</pre>' },
  { t: 'locked', ref: 'c1', label: 'Image', preview: 'photo.png' }
])

test('aller-retour : écrit puis relu, le template est identique (rien à enregistrer)', () => {
  const items = server()
  const code = toCode(items)
  const back = fromCode(code, items)
  assert.deepEqual(back.errors, [])
  assert.equal(signature(back.items), signature(items))
  assert.equal(back.items.find((i) => i.ref === 'a2').rich, true, 'mise en forme Notion conservée')
  assert.equal(back.lines.length, back.items.length)
})

test('syntaxe : titres, listes, cases, champs en JSON (un objet ou une liste), HTML', () => {
  const r = parseCode('# Titre\n\n## Sous-titre\n\n- [ ] Case\n- Puce\n1. Num\n> Cit\n> [!callout] Enc\n---\nTexte\n  suite\n\n```json\n[{"type":"text","id":"a","label":"A"},{"type":"date","id":"d","label":"D","help":"x"}]\n```\n\n```html\n<b>x</b>\n```')
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.items.map((i) => i.t + (i.style ? ':' + i.style : '') + (i.level ? i.level : '')), ['section1', 'section2', 'todo', 'text:bulleted_list', 'text:numbered_list', 'text:quote', 'text:callout', 'divider', 'text:paragraph', 'field', 'field', 'html'])
  assert.equal(r.items[8].text, 'Texte\nsuite')
  assert.deepEqual(r.items[10].extra, { help: 'x' })
})

test('modifier le code : le bloc garde sa référence Notion (mise à jour en place)', () => {
  const items = server()
  const code = toCode(items).replace('"label": "Accès"', '"label": "Accès au site"').replace('Point un', 'Point deux').replace('"id": "index"', '"id": "releve"')
  const back = fromCode(code, items)
  assert.deepEqual(back.errors, [])
  const byRef = Object.fromEntries(back.items.map((i) => [i.ref, i]))
  assert.equal(byRef.b1.label, 'Accès au site')
  assert.equal(byRef.a3.text, 'Point deux')
  assert.equal(byRef.b2.id, 'releve', 'identifiant modifié : même bloc')
  assert.equal(back.items.length, items.length)
})

test('ajout, suppression et coller depuis un autre template', () => {
  const items = server()
  const added = fromCode(toCode(items) + '\n## Nouveau\n\n```json\n{"type":"checkbox","id":"ok","label":"OK"}\n```\n', items)
  assert.equal(added.items.filter((i) => !i.ref).length, 2)
  const fresh = fromCode('## Tout neuf\n- [ ] Une case\n', items)          // tout retiré : les anciens blocs seront supprimés, locké compris
  assert.equal(fresh.items.length, 2)
  assert.equal(fresh.items[0].ref, undefined, 'titre de niveau différent : nouveau bloc')
  assert.equal(fresh.items[1].ref, 'a8', 'la case à cocher reprend le bloc existant')
})

test('erreurs : JSON, type inconnu, bloc non fermé, titre trop profond, bloc verrouillé inconnu', () => {
  const e = (t) => fromCode(t, server()).errors
  assert.match(e('```json\n{ "type": "text", }\n```')[0].message, /JSON invalide/)
  assert.equal(e('```json\n{ "type": "text", }\n```')[0].line, 2)
  assert.match(e('```json\n{"type":"magie","id":"a","label":"A"}\n```')[0].message, /Type de champ inconnu/)
  assert.match(e('```json\n{"type":"text","label":"A"}\n```')[0].message, /id/)
  assert.match(e('```json\n{"type":"text","id":"a","label":"A"}')[0].message, /non fermé/)
  assert.match(e('#### Trop')[0].message, /3 niveaux/)
  assert.match(e('<!-- 🔒 Image | ref=zzz -->')[0].message, /verrouillé/)
  assert.match(e('```python\nx\n```')[0].message, /non pris en charge/)
})

test('un champ sans libellé est signalé par la validation, à la bonne ligne', () => {
  const r = fromCode('Texte\n\n```json\n{"type":"text","id":"a"}\n```', [])
  assert.deepEqual(r.errors, [])
  const errs = validateItems(r.items)
  assert.equal(Object.keys(errs).length, 1)
  assert.equal(r.lines[r.items.findIndex((i) => errs[i.key])], 3)
  assert.equal(toPayload(r.items)[1].extra instanceof Object, true)
})
