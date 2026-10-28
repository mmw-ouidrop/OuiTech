/**
 * OUIDROP Interventions — Auth.gs : connexion par mot de passe, deux niveaux d'accès.
 *
 *  PRINCIPE
 *   · Deux mots de passe partagés, propriétés de script PASSWORD_TECH et PASSWORD_SUPPORT.
 *     Le mot de passe saisi détermine le NIVEAU : « support » ⊇ « tech ».
 *   · La PWA ne contient aucun secret : tout passe par `login`, qui renvoie une SESSION signée
 *     (HMAC-SHA256, clé SESSION_SECRET créée automatiquement au premier appel). Chaque requête
 *     suivante la présente (`session`) ; sans session valide, le serveur ne renvoie aucune donnée.
 *   · Durée : SESSION_DAYS jours (30 par défaut). Pour déconnecter TOUS les appareils d'un coup
 *     (mot de passe divulgué…) : changer le mot de passe ET augmenter SESSION_EPOCH (1 → 2).
 *   · Anti-devinette : 5 mauvais essais par appareil → blocage 10 min ; 60 par heure tous
 *     appareils confondus → blocage de la connexion pendant 10 min.
 *   · Le prénom et le nom sont exigés à la connexion (déclaratifs, non vérifiés) ; ils ne sont pas
 *     dans la session : l'application les envoie avec chaque synchronisation.
 *
 *  LIMITES (voir README) : mots de passe PARTAGÉS → pas de traçabilité individuelle fiable ; une
 *  personne qui connaît le mot de passe a tous les droits de son niveau.
 *
 *  ROUTES
 *    POST { action:"login", password, firstName, lastName, clientId }
 *         → { session, role, issuedAt, expiresAt, serverNow }
 *    GET  ?action=session&session=…   → { role, expiresAt, serverNow }   (la session est-elle encore valable ?)
 */

const ROLES = ['tech', 'support'];                 // ordre croissant des droits
const SESSION_DEFAULT_DAYS = 30;
const LOGIN_MAX_FAILS_CLIENT = 5;
const LOGIN_MAX_FAILS_GLOBAL = 60;
const LOGIN_LOCK_SECONDS = 600;
const LOGIN_GLOBAL_WINDOW_SECONDS = 3600;

let SESSION_SECRET_CACHE_ = null;                  // par exécution seulement

function roleRank_(role) {
  return ROLES.indexOf(role);
}

/* ── Clé de signature ─────────────────────────────────────────────────────────── */

function sessionSecret_() {
  if (SESSION_SECRET_CACHE_) return SESSION_SECRET_CACHE_;
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      secret = props.getProperty('SESSION_SECRET');          // créée entre-temps par une autre requête ?
      if (!secret) {
        secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
        props.setProperty('SESSION_SECRET', secret);
      }
    } finally {
      lock.releaseLock();
    }
  }
  SESSION_SECRET_CACHE_ = secret;
  return secret;
}

function b64url_(input) {
  return Utilities.base64EncodeWebSafe(input).replace(/=+$/, '');
}

function unb64urlToString_(s) {
  const pad = s + '===='.slice(s.length % 4 || 4);
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString();
}

function sign_(data) {
  return b64url_(Utilities.computeHmacSha256Signature(data, sessionSecret_()));
}

/* ── Émission et contrôle des sessions ────────────────────────────────────────── */

function sessionEpoch_() {
  return String(cfg_('SESSION_EPOCH', '1')).trim();
}

function sessionDays_() {
  const n = Number(cfg_('SESSION_DAYS', String(SESSION_DEFAULT_DAYS)));
  return isFinite(n) && n >= 1 && n <= 365 ? n : SESSION_DEFAULT_DAYS;
}

function issueSession_(role) {
  const now = Date.now();
  const payload = { r: role, iat: now, exp: now + sessionDays_() * 86400000, e: sessionEpoch_() };
  const body = 'v1.' + b64url_(JSON.stringify(payload));
  return { session: body + '.' + sign_(body), role: role, issuedAt: payload.iat, expiresAt: payload.exp, serverNow: now };
}

// Renvoie le contenu de la session ou lève UNAUTHORIZED / SESSION_EXPIRED.
function parseSession_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new ApiError_('UNAUTHORIZED', 'Connexion requise');
  const body = parts[0] + '.' + parts[1];
  if (!safeEqual_(parts[2], sign_(body))) throw new ApiError_('UNAUTHORIZED', 'Session invalide');
  let payload;
  try {
    payload = JSON.parse(unb64urlToString_(parts[1]));
  } catch (err) {
    throw new ApiError_('UNAUTHORIZED', 'Session illisible');
  }
  if (!payload || ROLES.indexOf(payload.r) === -1) throw new ApiError_('UNAUTHORIZED', 'Session invalide');
  if (String(payload.e) !== sessionEpoch_()) {
    throw new ApiError_('SESSION_EXPIRED', 'Session révoquée : reconnectez-vous');
  }
  if (!(payload.exp > Date.now())) throw new ApiError_('SESSION_EXPIRED', 'Session expirée : reconnectez-vous');
  return payload;
}

// À appeler en tête de chaque route protégée. `minRole` : 'tech' (défaut) ou 'support'.
function authorize_(token, minRole) {
  const s = parseSession_(token);
  if (roleRank_(s.r) < roleRank_(minRole || 'tech')) {
    throw new ApiError_('FORBIDDEN_ROLE', 'Cette fonction est réservée au niveau « ' + minRole + ' »');
  }
  return s;
}

/* ── Connexion ────────────────────────────────────────────────────────────────── */

function login_(body) {
  const first = clip_(body.firstName, 40).trim();
  const last = clip_(body.lastName, 40).trim();
  if (!first || !last) throw new ApiError_('NAME_REQUIRED', 'Indiquez votre prénom et votre nom');

  const clientId = clip_(body.clientId, 64) || 'anon';
  const cache = CacheService.getScriptCache();
  const keyClient = 'lf:c:' + clientId;
  const keyGlobal = 'lf:g';
  if (Number(cache.get(keyClient) || 0) >= LOGIN_MAX_FAILS_CLIENT ||
      Number(cache.get(keyGlobal) || 0) >= LOGIN_MAX_FAILS_GLOBAL) {
    throw new ApiError_('TOO_MANY_ATTEMPTS', 'Trop d’essais : réessayez dans 10 minutes', { retryAfterSec: LOGIN_LOCK_SECONDS });
  }

  const tech = String(cfg_('PASSWORD_TECH', '')).trim();
  const support = String(cfg_('PASSWORD_SUPPORT', '')).trim();
  if (!tech && !support) {
    throw new ApiError_('CONFIG_MISSING', 'Aucun mot de passe configuré (propriétés PASSWORD_TECH / PASSWORD_SUPPORT)');
  }
  const given = String(body.password || '').trim();
  // les deux comparaisons sont toujours faites (durée indépendante du résultat)
  const isSupport = support !== '' && safeEqual_(given, support);
  const isTech = tech !== '' && safeEqual_(given, tech);

  if (!isSupport && !isTech) {
    cache.put(keyClient, String(Number(cache.get(keyClient) || 0) + 1), LOGIN_LOCK_SECONDS);
    cache.put(keyGlobal, String(Number(cache.get(keyGlobal) || 0) + 1), LOGIN_GLOBAL_WINDOW_SECONDS);
    Utilities.sleep(800);                                       // ralentit les essais en rafale
    throw new ApiError_('BAD_PASSWORD', 'Mot de passe incorrect');
  }
  cache.remove(keyClient);
  const role = isSupport ? 'support' : 'tech';
  Logger.log('Connexion ' + role + ' : ' + first + ' ' + last);
  return issueSession_(role);
}

/* ── Test à lancer depuis l'éditeur Apps Script ───────────────────────────────── */

// Vérifie la configuration sans rien exposer : propriétés présentes, longueur des mots de passe,
// émission puis contrôle d'une session. Résultat dans « Journal d'exécution ».
function testAuth() {
  const tech = String(cfg_('PASSWORD_TECH', '')).trim();
  const support = String(cfg_('PASSWORD_SUPPORT', '')).trim();
  Logger.log('PASSWORD_TECH : ' + (tech ? tech.length + ' caractères' : 'MANQUANT'));
  Logger.log('PASSWORD_SUPPORT : ' + (support ? support.length + ' caractères' : 'absent (niveau support désactivé)'));
  if (tech && tech.length < 10) Logger.log('⚠ PASSWORD_TECH : 12 caractères ou plus recommandés');
  if (tech && support && tech === support) Logger.log('⚠ les deux mots de passe sont identiques : le niveau support l\'emporte');
  const s = issueSession_('tech');
  const back = parseSession_(s.session);
  Logger.log('Session de test : niveau ' + back.r + ', valable ' + sessionDays_() + ' jours, époque ' + back.e);
}
