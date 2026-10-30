# Contrat de l'API Apps Script (v2 — rapport partagé)

Base : URL `/exec` du déploiement. Toutes les réponses sont en HTTP 200 :
`{ "ok": true, "data": … }` ou `{ "ok": false, "error": { "code", "message", … } }`.
Les POST sont envoyés en `Content-Type: text/plain;charset=utf-8` avec un corps JSON (évite la requête de
pré-vérification CORS, que Apps Script ne gère pas). Chaque requête (sauf `ping` et `login`) porte `session` : le jeton signé obtenu par `login` (voir `Auth.gs`).

## Connexion
| Appel | Rôle |
|---|---|
| POST `{ action:"login", password, firstName, lastName, clientId }` | → `{ session, role:"tech"\|"support", issuedAt, expiresAt, serverNow }`. Erreurs : `BAD_PASSWORD`, `NAME_REQUIRED`, `TOO_MANY_ATTEMPTS` (`retryAfterSec`), `CONFIG_MISSING`. |
| GET `?action=session&session=…` | → `{ role, expiresAt, serverNow }` : la session est-elle encore valable ? |

Erreurs d'accès sur toute autre route : `UNAUTHORIZED` (absente / invalide), `SESSION_EXPIRED` (expirée ou révoquée par `SESSION_EPOCH`),
`FORBIDDEN_ROLE` (niveau insuffisant). Le client, sur `UNAUTHORIZED`/`SESSION_EXPIRED`, oublie la session et renvoie à la connexion.

## GET

| Appel | Rôle |
|---|---|
| `?action=ping` | Sans token. Vérifie que le déploiement répond. |
| `?action=getIntervention&id=FI-252` | Mission complète : propriétés, template, schéma, rapport partagé. |
| `?action=getReport&pageId=…&sinceRev=N&clientId=…&name=Prénom Nom` | Relève légère (toutes les ~60 s tant que la fiche est ouverte). |
| `?action=methods&sinceRev=…` | Fiches méthodes publiées : `{ rev, items:[{id,title,groups,status,updated,summary}] }` ou `{ unchanged:true, rev }`. |
| `?action=method&id=<pageId>&sinceEdited=…` | Une fiche : propriétés, `links`, `support`, `media`, `hero`, `sections:[{title,kind,nodes}]` ou `{ unchanged:true }`. |
| `?action=methodMedia&page=<pageId>&key=<clé>&mode=data\|url` | Image / fichier d'une fiche : `{name,mime,size,data(base64)}` (≤ 6 Mo), `{…,tooLarge:true,url}` ou, en `mode=url`, `{name,url}` (lien frais ≈ 1 h). |

| `?action=machines&sinceRev=…` | Liste des machines : `{ rev, items:[{id,title,city,address,region,status,active,type,project,updated}] }` ou `{ unchanged:true, rev }`. |
| `?action=machine&id=<pageId>&sinceEdited=…` | Une machine : adresse, `keybox`, `wifi{raw,ssid,password}`, connexions, options, pièces, notes, relations résolues, `photos`, `extras`, `nodes`. |
| `?action=machineMedia&page=<pageId>&key=<clé>&mode=data\|url` | Photo du site (même forme que `methodMedia`). |

| `?action=racksOverview&sinceRev=…` | Sites ayant des racks/casiers KO : `{ rev, total, sites:[{id,title,casiers,racks,autres,total,diagnosed}] }`. |
| `?action=racks&site=<pageId>&all=1&sinceRev=…` | Éléments d'un site (`site=none` : sans site) ; sans `all` : états « à traiter » (KO, Diag tech), avec `all=1` : tous. `{ rev, all, site, states, stateOptions, diagState, koStates, items:[{id,title,kind,state,cause,updated,diag,history}] }`. |
| `?action=racksSearch&q=14&site=<id|none>&state=<nom|*>&kind=casier|rack` | Recherche (100 résultats max) : `{ items:[{…, siteId, siteTitle}], truncated, stateOptions, diagState, koStates, states }`. `state` vide = à traiter, `*` = tous. Au moins un critère. |
| `?action=rackComments&pageId=…` | Commentaires Notion de la page : `{ comments:[{id,at,by,text}] }`. Erreur `COMMENTS_FORBIDDEN` si l'intégration n'a pas « Read comments ». |

Détail des fiches méthodes (nœuds, sections, propriétés de script) : en-tête de `Methods.gs` ; machines : en-tête de `Machines.gs`.

### getIntervention → `data`
`id, reference, title, url, lastEdited, properties[], templateBlocks[], warnings[]`, plus :

- `schema[]` : liste plate et ordonnée de ce que le rapport affiche.
  `{k:'s', id, text, level}` pour un intertitre, `{k:'f', id, type, label, options?}` pour un champ.
  Types : `checkbox`, `radio_group`, `image_upload`, `text`, `textarea`, `number`… (ceux du template).
- `report` : état partagé (voir `publicState`) ou `null` si personne n'a encore synchronisé.
- `serverNow` : heure du serveur (ms), pour estimer le décalage d'horloge du téléphone.

### getReport → `data`
- `{ unchanged:true, rev, editors, serverNow }` si `sinceRev` est la révision courante (aucun appel Notion
  tant que le cache est chaud) ;
- sinon `{ unchanged:false, report, editors, serverNow }` (`report` peut être `null`).

### publicState (`report`)
```
rev            entier, +1 à chaque modification effective
status         "draft" | "validated"   statusBy, statusAt
last           { by, at }              dernière personne à avoir modifié
schema[]       union du template et des éléments retirés depuis (conservés)
fields         { [id]: { v, at, by, c } }       valeur courante, auteur, heure, appareil
custom[]       champs ajoutés par les techniciens : { id, type, label, options?, by, at }
removedCustom  ids supprimés (pour les retirer de l'écran)
photos         { [componentId]: [ { mediaId, by, at } ] }
editors[]      autres appareils actifs : { clientId, name, agoSec }
```

## POST `methodComment` / `rackDiagnosis`

`{ action:"methodComment", pageId, text, name, id }` ajoute un commentaire à la colonne « Commentaires » de la fiche (→ `{ comments }`).
`{ action:"rackDiagnosis", pageId, state, comment, name, id }` (`state` : `repaired` | `unrepairable` | `left_as_is` | `watch`) écrit le
diagnostic dans « Commentaire technicien » (→ `{ diag, history }`). `id` : identifiant unique de l'envoi ; un rejeu (même `id`) renvoie
`{ duplicate:true }` sans rien écrire. `rackDiagnosis` fait aussi passer l'état Notion de KO à `RACKS_DIAG_STATE` (→ `{ diag, history, state }`). Erreurs : `AUTHOR_REQUIRED`, `BAD_REQUEST`, `NOT_FOUND`, `COLUMN_MISSING` (colonne absente de la base).
Les fiches méthodes renvoient aussi `gallery` (colonne « Medias » dans l'ordre de Notion), `comments`, `commentsEnabled` et `v` (version du format).

## POST `rackSetState` / `rackComment` (profil support)

`{ action:"rackSetState", session, pageId, state, name, id }` change l'état Notion (valeur parmi `stateOptions`) et trace « [Nom] État : A → B »
en commentaire Notion (facultatif) → `{ state, before }`. `{ action:"rackComment", session, pageId, text, name, id }` ajoute un commentaire Notion
« [Nom] texte » → `{ comments }`. Réservés au rôle `support` (`FORBIDDEN_ROLE` sinon) ; `id` rend le rejeu sans effet.
Erreurs : `AUTHOR_REQUIRED`, `BAD_REQUEST`, `NOT_FOUND`, `COMMENTS_FORBIDDEN`, `CONFIG_INVALID`.

## POST `uploadMedia`
`{ action, session, fileData (base64 ou data:URL), fileName, mimeType, mediaId, reference }`
→ `{ fileId, name, size, duplicate }`. Idempotent par `mediaId`. Dépose la photo dans
`<dossier racine>/<référence>/` (transit temporaire, sans partage public). JPEG/PNG/WebP/GIF seulement.

## POST `syncReport`
Corps :
```
action:"syncReport", session, notionPageId, reference?
clientId          identifiant stable de l'appareil (généré une fois)
author            { firstName, lastName }   obligatoire
clientNow         Date.now() du téléphone à l'envoi
baseRev           dernière révision connue du client (0 si aucune)
schema            celui reçu de getIntervention (le client envoie ce qu'il a ; le serveur fait l'union)
changes: {
  fields:  { [id]: { v, at } }                         at = heure de saisie
  status:  { value:"validated"|"draft", at }
  custom:  { add:[{id:"u_…", type, label, options?, at}], remove:[{id, at}] }
  photos:  { add:[{mediaId, componentId, driveFileId, at}], remove:[{mediaId, at}] }
}
```
Réponse `data` : `report, unchanged, serverNow, overridden[], rejected, reset, applied, warnings[],
photoErrors[], photosRemaining, cleanup`.

### Ce que le client doit faire de la réponse
1. **Toujours** remplacer son état partagé local par `report` (fusion déjà faite côté serveur) et mémoriser
   `report.rev` comme nouveau `baseRev`. Les saisies *non encore envoyées* restent prioritaires à l'écran.
2. `overridden[]` : saisies du client écrasées par un collègue plus récent
   `{ id, mine, theirs:{v,by,at} }` → afficher « *Prénom a modifié ce champ à 10:42* » avec
   **Remettre la mienne** (renvoie `mine` avec un `at` neuf).
3. `rejected` : `fields[]`, `custom[]`, `photos[]`, `status` + `reason:"VALIDATED"` → le CR a été validé par
   quelqu'un d'autre ; garder les saisies refusées en local et proposer « Rouvrir ».
4. `reset:true` : le serveur a perdu le rapport (supprimé à la main dans Notion) → renvoyer **tout** (champs,
   champs ajoutés, photos) au prochain cycle.
5. Photo acquittée = son `mediaId` figure dans `report.photos[componentId]`. Sinon la renvoyer au cycle suivant.
   `photoErrors[]` (`MEDIA_NOT_FOUND`, `UNSUPPORTED_TYPE`, `FORBIDDEN`, `NOTION_UPLOAD_FAILED`) : pour
   `MEDIA_NOT_FOUND`, ré-uploader depuis le Blob local puis renvoyer ; les autres : signaler à l'utilisateur.
6. `photosRemaining > 0` : rappeler `syncReport` immédiatement (6 photos traitées par appel, pour rester
   sous la limite de 6 minutes d'Apps Script).
7. Erreurs `BUSY`, `NOTION_UNAVAILABLE`, `NOTION_ERROR`, `INTERNAL` : réessayer plus tard (backoff). Toutes les
   requêtes sont rejouables sans effet de bord. Erreurs `UNAUTHORIZED`, `BAD_REQUEST`, `AUTHOR_REQUIRED`,
   `FORBIDDEN` : ne pas réessayer, afficher.

### Règles de fusion (serveur)
- Champ par champ ; saisie la plus récente gagne. Heure de saisie = `at + (serverNow − clientNow)`, bornée à
  l'instant présent. Égalité exacte : `clientId` le plus grand gagne.
- Validation : un CR validé refuse champs, champs ajoutés et photos, jusqu'à réouverture
  (`status:{value:'draft'}` avec un `at` plus récent que la validation). Une requête qui valide applique ses
  propres saisies : le bouton « Valider » envoie les dernières modifications avec le changement d'état.
- Photos et champs ajoutés : additifs, identifiés par `mediaId` / `id` (`u_` + 4 à 40 caractères). Suppression
  douce : un `id` supprimé n'est pas ressuscité par un rejeu.
- Les éléments retirés du template par un responsable restent dans le rapport (ils peuvent contenir des saisies).

## Codes d'erreur
`UNAUTHORIZED` · `BAD_REQUEST` · `NOT_FOUND` · `FORBIDDEN` · `AUTHOR_REQUIRED` · `UNSUPPORTED_TYPE` ·
`MEDIA_NOT_FOUND` · `MEDIA_UNAVAILABLE` · `COLUMN_MISSING` · `CONFIG_INVALID` · `NOTION_FORBIDDEN` · `BUSY` (verrou occupé > 30 s) · `STATE_TOO_LARGE` · `STATE_DESYNC` ·
`NOTION_ERROR` · `NOTION_UNAVAILABLE` · `NOTION_UPLOAD_FAILED` · `CONFIG_MISSING` · `INTERNAL`.
(`STATE_MISSING` / `STATE_CORRUPT` ne sortent pas : le rapport est alors reconstruit, avec un avertissement.)
