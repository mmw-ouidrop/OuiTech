import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import FichesView from './views/FichesView.vue'
import MissionView from './views/MissionView.vue'
import LoginView from './views/LoginView.vue'
import MethodsView from './views/MethodsView.vue'
import MethodView from './views/MethodView.vue'
import MachinesView from './views/MachinesView.vue'
import MachineView from './views/MachineView.vue'
import RacksView from './views/RacksView.vue'
import RackSiteView from './views/RackSiteView.vue'
import SettingsView from './views/SettingsView.vue'
import ComingSoonView from './views/ComingSoonView.vue'
import { normalizeReference, consumeUrlReference } from './lib/ref.js'
import { DEFAULT_PREFIX } from './config.js'
import { getAuth, can } from './lib/auth.js'

// Historique par « hash » (#/m/FI-252) : aucune configuration serveur nécessaire,
// et l'app s'ouvre hors ligne sur n'importe quelle URL grâce au cache PWA.
// `meta.title` : titre du bandeau ; `meta.minRole` : niveau requis (défaut : technicien).
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/connexion', name: 'login', component: LoginView, meta: { public: true, title: 'Connexion' } },
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Accueil' } },
    { path: '/fiches', name: 'fiches', component: FichesView, meta: { title: 'Fiches et CR' } },
    { path: '/m/:reference', name: 'mission', component: MissionView, props: true, meta: { title: 'Fiche d’intervention', section: 'fiches' } },
    { path: '/methodes', name: 'methodes', component: MethodsView, meta: { title: 'Méthodes' } },
    { path: '/methodes/:id', name: 'methode', component: MethodView, props: true, meta: { title: 'Méthode', section: 'methodes' } },
    { path: '/machines', name: 'machines', component: MachinesView, meta: { title: 'Machines' } },
    { path: '/machines/:id', name: 'machine', component: MachineView, props: true, meta: { title: 'Machine', section: 'machines' } },
    { path: '/racks', name: 'racks', component: RacksView, meta: { title: 'Racks et casiers KO' } },
    { path: '/racks/:site', name: 'rack-site', component: RackSiteView, props: true, meta: { title: 'Racks et casiers KO', section: 'racks' } },
    {
      path: '/inventaires', name: 'inventaires', component: ComingSoonView, meta: { title: 'Inventaires' },
      props: { title: 'Inventaires de sites', text: 'Inventaire des pièces de maintenance stockées sur chaque site. À développer plus tard.' }
    },
    { path: '/reglages', name: 'settings', component: SettingsView, meta: { title: 'Réglages' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

// 1) Connexion obligatoire (sauf page de connexion) et niveau requis ;
// 2) lien d'ouverture direct : https://…/?id=FI-252  ou  https://…/#/?id=FI-252
//    (conservé pendant la connexion : on y revient une fois connecté).
let urlRefChecked = false
router.beforeEach((to) => {
  const auth = getAuth()
  if (!to.meta.public && !auth) {
    return { name: 'login', query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  if (to.name === 'login' && auth) return { name: 'home' }
  if (to.meta.minRole && !can(auth && auth.role, to.meta.minRole)) return { name: 'home' }

  if (to.name !== 'home') return
  let raw = to.query.id
  if (!urlRefChecked) {
    urlRefChecked = true
    raw = raw || consumeUrlReference()
  }
  const reference = normalizeReference(Array.isArray(raw) ? raw[0] : raw, DEFAULT_PREFIX)
  if (reference) return { name: 'mission', params: { reference }, replace: true }
})
