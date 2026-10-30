import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// Couleurs de la charte OUIDROP 2026
const BLEU_FONCE = '#0D2E5B'
const FOND = '#FDFBFB'

export default defineConfig({
  // Chemins relatifs : l'app fonctionne à la racine d'un domaine comme dans un
  // sous-dossier (GitHub Pages, Netlify, serveur interne…).
  base: './',

  plugins: [
    vue(),
    VitePWA({
      // « prompt » : une mise à jour n'est appliquée que quand le technicien le
      // décide (bandeau dans l'app). Jamais de rechargement en plein remplissage.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],

      manifest: {
        name: 'OuiTech',
        short_name: 'OuiTech',
        description: "OuiTech : l'outil terrain OUIDROP, même sans réseau.",
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: BLEU_FONCE,
        background_color: FOND,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },

      workbox: {
        // Tout le code, le CSS et les polices (woff2, auto-hébergées) sont
        // pré-cachés : l'app démarre hors ligne dès la première visite réussie.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,woff}'],
        // Toute navigation (y compris /?id=FI-252) sert index.html depuis le cache.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true
        // Pas de cache runtime pour l'API GAS : les données vivent dans IndexedDB.
      }
    })
  ]
})
