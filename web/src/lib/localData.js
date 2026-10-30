// Suppression de données locales (fiches d'intervention, copies des catalogues) : confirmations et garde-fous.
import { deleteIntervention, methodsCatalog, machinesCatalog, clearRacksCache, listInterventions } from '../db.js'

// Supprime une fiche de l'appareil. Des saisies non envoyées ne partent qu'après confirmation explicite.
// → true si supprimée.
export async function removeMission(rec, confirmFn = (m) => window.confirm(m)) {
  const unsent = rec.needsSync === 1
  const msg = unsent
    ? `La fiche ${rec.reference} contient des saisies PAS ENCORE ENVOYÉES à Notion. Les supprimer les perdra définitivement (photos comprises). Supprimer quand même ?`
    : `Retirer la fiche ${rec.reference} de cet appareil ? Le compte rendu déjà envoyé reste dans Notion.`
  if (!confirmFn(msg)) return false
  await deleteIntervention(rec.id, { force: unsent })
  return true
}

// Retire de l'appareil toutes les fiches dont tout est envoyé. → nombre de fiches supprimées.
export async function removeSentMissions(confirmFn = (m) => window.confirm(m)) {
  const sent = (await listInterventions()).filter((m) => m.needsSync !== 1)
  if (!sent.length) return 0
  if (!confirmFn(`Retirer de cet appareil les ${sent.length} fiche(s) déjà envoyées à Notion ? Les fiches avec des saisies en attente sont gardées.`)) return 0
  for (const m of sent) await deleteIntervention(m.id)
  return sent.length
}

export const CATALOGS = {
  methods: { label: 'Méthodes', clear: () => methodsCatalog.clear(), stats: () => methodsCatalog.stats() },
  machines: { label: 'Machines', clear: () => machinesCatalog.clear(), stats: () => machinesCatalog.stats() },
  racks: { label: 'Racks et casiers KO', clear: () => clearRacksCache(), stats: null }
}
