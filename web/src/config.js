// Valeurs injectées au build depuis .env.local (voir .env.example).
// Aucun secret ici : le bundle est public. L'accès aux données passe par la connexion (mot de passe → session).
// .trim() : un espace ou un retour à la ligne collé avec l'URL ferait échouer toutes les requêtes.
export const GAS_URL = (import.meta.env.VITE_GAS_URL || '').trim()
export const DEFAULT_PREFIX = (import.meta.env.VITE_DEFAULT_PREFIX ?? 'FI').trim()

export const configOk = Boolean(GAS_URL)
