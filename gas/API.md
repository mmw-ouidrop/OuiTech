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
| `?action=ping` | Sans token. Vérifie que le déploiement répond et renvoie `version` (celle du code déployé : à comparer avec `SCRIPT_VERSION` de Code.gs). |
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

- `properties[]` : `{ label, value, type, files? }`, triées d'après `PROPERTY_ORDER`, sans les colonnes de `HIDDEN_PROPERTIES`
  (noms comparés sans casse, accents ni différence d'apostrophe). Une colonne de type fichiers porte `files:[{ key, name, kind:'image'|'video'|'pdf'|'file', url? }]` :
  `key` (`p:<colonne>:<rang>`) se lit par `missionMedia` ; `url` n'existe que pour un lien externe https.
- `templateBlocks[]` de type texte : `{ kind:'text', style, text, rt, level?, icon?, blockId }`. `style` : `paragraph`, `bulleted_list`, `numbered_list`, `quote`, `callout`, `toggle` ;
  `rt` = segments mis en forme `{ t, b?, i?, s?, u?, c?, h?, col? }` (gras, italique, barré, souligné, code, lien, couleur Notion) ; `level` = niveau d'une liste (0 à 3).

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
custom[]       champs ajoutés par les techniciens : { id, type, label, options?, after?, mv?, by, at }
               `after` = repère (id d'un champ ou d'une section, `^` = tout en haut, absent = en bas sous « Ajouts terrain »), `mv` = date du dernier déplacement
removedCustom  ids supprimés (pour les retirer de l'écran)
photos         { [componentId]: [ { mediaId, by, at } ] }
editors[]      autres appareils actifs : { clientId, name, agoSec }
```

## GET `missionMedia`

`?action=missionMedia&page=<pageId de la mission>&key=<id du bloc ou p:<colonne>:<rang>>&mode=data|url` : image / fichier posé dans le contenu d'une page de mission, ou fichier d'une colonne de type fichiers
(même réponse que `methodMedia` : `{ name, mime, size, data }`, `{ …, tooLarge:true, url }` ou, en mode `url`, `{ name, url }`).
`getIntervention` renvoie en plus, dans `templateBlocks`, des éléments `{ kind:"media", type, blockId, name, caption, url? }`, `{ kind:"link", url, text }`
et `{ kind:"html", blockId, html }` (bloc de code HTML). Seule une page de la base des interventions est servie ; erreur `NOT_FOUND` sinon.

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

## GET `templateGet` / POST `templateSave` (profil support)

Éditeur de templates de CR (écran « Modèles de CR », fichier `Templates.gs`). Chaque élément du template correspond à un bloc Notion.
`templateGet&id=<référence>` → `{ pageId, reference, title, url, parentId, container, outside, items:[…] }` : `container` vaut `true` si le template est dans un toggle « Template… »,
`outside` compte les blocs de la page hors de ce toggle (non modifiables ici). Éléments : `{ ref, t:"section", level, text }`, `{ ref, t:"text", style, text, rt?, … }`,
`{ ref, t:"todo", text, checked }`, `{ ref, t:"field", type, id, label, required, placeholder, unit, options?, extra }` (`extra` : autres clés du JSON du champ, par ex. `help`, `max`, `min` ; renvoyé tel quel, et écrit à l'enregistrement), `{ ref, t:"divider" }`, `{ ref, t:"html", html }`,
`{ ref, t:"locked", label, text }` (média, tableau… : visible mais jamais réécrit).
`templateSave` `{ id, items:[…] }` : n'écrit que la différence (blocs modifiés, ajoutés, déplacés, supprimés) → même réponse que `templateGet` +
`saved:{ created, updated, deleted, moved }` et `warnings:[{ code, message }]`. Un `ref` qui n'existe plus dans Notion (page modifiée entre-temps) → `TEMPLATE_CHANGED`
(l'écran invite à rouvrir la mission). Mêmes règles de validation que la lecture d'un template (identifiants uniques, 2 à 20 options, 300 éléments, 100 000 caractères de HTML) → `BAD_REQUEST`.
Réservé au rôle `support` (`FORBIDDEN_ROLE` sinon). L'intégration Notion doit pouvoir « Modifier le contenu » et « Insérer du contenu ».

## POST `uploadMedia`
`{ action, session, fileData (base64 ou data:URL), fileName, mimeType, mediaId, reference }`
→ `{ fileId, name, size, duplicate }`. Idempotent par `mediaId`. Dépose la photo dans
`<dossier racine>/<référence>/` (transit temporaire, sans partage public). Pièces jointes acceptées : JPEG/PNG/WebP/GIF, PDF, vidéos (`video/*`) ; 20 Mo maximum (HEIC converti en JPEG par la PWA). À la synchro (`photos.add[].fileName`), Notion reçoit un bloc `image`, `video` ou `pdf` selon le type.

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
  custom:  { add:[{id:"u_…", type, label, options?, after?, at}], move:[{id, after, at}], remove:[{id, at}] }
           (un champ s'insère sous son repère ; le plus récemment placé d'abord ; repère introuvable ou boucle → en bas ;
            `move` plus ancien que la position actuelle ou rejoué → ignoré ; supprimer un champ fait remonter ceux placés sous lui ;
            réponse : `applied.customMoved`. Le bloc Notion est recréé à sa nouvelle place, sauf s'il porte des photos.)
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
`TEMPLATE_CHANGED` · `FORBIDDEN_ROLE` · `NOTION_ERROR` · `NOTION_UNAVAILABLE` · `NOTION_UPLOAD_FAILED` · `CONFIG_MISSING` · `INTERNAL`.
(`STATE_MISSING` / `STATE_CORRUPT` ne sortent pas : le rapport est alors reconstruit, avec un avertissement.)

## POST `actionComment`
`{ action, session, id (anti-doublon), missionId, pageId (action), reference?, name, state?: todo|doing|done|blocked, text? }`
→ `{ duplicate, state, label }`. Dépose `[Nom] État : Terminée · FI-282` + le texte dans les **commentaires Notion** de la page Action
(rien d'autre n'est modifié). L'action doit être liée à la mission (relation « Actions prévues »). `getIntervention` renvoie `actions[]`
(titre, type, durée, description, outillage, fichiers, éléments liés) ; leurs fichiers se lisent via `missionMedia` avec `mission=<id>`.
