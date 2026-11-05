// L'ordre des champs ajoutés doit être le même dans l'application (lib/shared.js) et dans le rapport Notion (gas/Report.gs).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { weaveItems, CUSTOM_SECTION_ID } from '../src/lib/shared.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '../../gas/Report.gs'), 'utf8')
const start = src.indexOf('function weaveCustom_')
const end = src.indexOf('// Ce que le rapport affiche')
const weaveCustom_ = new Function(src.slice(start, end) + '\nreturn weaveCustom_;')()

// petit générateur pseudo-aléatoire reproductible
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

test('même ordre côté application et côté serveur, sur des dispositions aléatoires (boucles et repères inconnus compris)', () => {
  const rand = rng(42)
  for (let round = 0; round < 300; round++) {
    const base = []
    const n = 1 + Math.floor(rand() * 8)
    for (let i = 0; i < n; i++) base.push({ k: rand() < 0.2 ? 'section' : 'field', id: (rand() < 0.2 ? 'S:' : 'f') + i })
    const m = Math.floor(rand() * 7)
    const ids = ['^', 'zz', ...base.map((b) => b.id)]
    const custom = {}
    for (let i = 0; i < m; i++) {
      const id = 'u_' + String.fromCharCode(97 + i)
      ids.push(id)
      custom[id] = { type: 'text', label: id, at: 1 + Math.floor(rand() * 5) }
    }
    for (const id of Object.keys(custom)) {
      if (rand() < 0.85) custom[id].after = ids[Math.floor(rand() * ids.length)]
      if (rand() < 0.3) custom[id].mv = 1 + Math.floor(rand() * 9)
    }
    const web = weaveItems(base, custom).map((i) => i.id)
    const server = weaveCustom_(
      base.map((b) => ({ k: b.k === 'section' ? 's' : 'f', id: b.id })),
      Object.keys(custom).map((id) => ({ id, after: custom[id].after, at: custom[id].at, mv: custom[id].mv })),
      () => true
    ).map((e) => (e.ref ? e.ref.id : e.heading ? CUSTOM_SECTION_ID : e.custom))
    assert.deepEqual(web, server, JSON.stringify({ base, custom }))
    assert.equal(web.filter((x) => x.startsWith('u_')).length, m, 'aucun champ perdu ni dupliqué')
  }
})
