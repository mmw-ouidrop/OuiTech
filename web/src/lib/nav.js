// Entrées du menu latéral. `minRole` : niveau requis ; `soon` : page annoncée mais pas encore développée.
export const NAV = [
  { id: 'home', to: '/', label: 'Accueil', icon: 'home', desc: 'Vue d’ensemble' },
  { id: 'fiches', to: '/fiches', label: 'Fiches et CR', icon: 'doc', desc: 'Fiches d’intervention et comptes rendus', tile: true },
  { id: 'methodes', to: '/methodes', label: 'Méthodes', icon: 'book', desc: 'Comment réparer, étape par étape', tile: true },
  { id: 'machines', to: '/machines', label: 'Machines', icon: 'machine', desc: 'Adresse, Wi-Fi, boîte à clés…', tile: true },
  { id: 'racks', to: '/racks', label: 'Racks et casiers KO', icon: 'rack', desc: 'À diagnostiquer et réparer', tile: true },
  { id: 'inventaires', to: '/inventaires', label: 'Inventaires', icon: 'list', desc: 'Pièces de maintenance par site', tile: true, soon: true },
  { id: 'settings', to: '/reglages', label: 'Réglages', icon: 'gear', desc: 'Affichage, nom, session', footer: true }
]

import { can } from './auth.js'

export const visibleNav = (role) => NAV.filter((n) => can(role, n.minRole || 'tech'))

// Entrée du menu à mettre en évidence pour une route (la fiche ouverte dépend de « Fiches et CR »).
export function activeNavId(route) {
  if (route.meta && route.meta.section) return route.meta.section
  return route.name
}
