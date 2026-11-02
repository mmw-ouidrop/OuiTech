# OUIDROP Interventions — PWA hors ligne

Comptes rendus d'intervention remplis sans réseau, remontés dans Notion au retour du réseau.

```
gas/    Middleware Google Apps Script (Code.gs, Report.gs, Auth.gs, appsscript.json, API.md, tests/)
web/    PWA Vue 3 + Vite + Dexie (charte graphique OUIDROP 2026)
```

Flux : **PWA ⇄ Google Apps Script ⇄ Notion**, avec Drive comme zone de transit des photos.

## 1. Notion

1. Créer une intégration interne (notion.so/my-integrations) → copier le secret. Onglet *Configuration* /
   *Capacités* : cocher **Read content, Update content et Insert content** (sans les deux dernières, la lecture
   fonctionne mais l'envoi du CR échoue avec « Insufficient permissions for this endpoint »).
2. Sur la base « Interventions » : `⋯ ▸ Connexions` → ajouter l'intégration.
3. La colonne d'ID court (ex. FI-252) est une propriété **ID unique** (nom par défaut : `ID`).
4. Le template du rapport se trouve dans la page de chaque mission : titres H1/H2/H3, cases à cocher
   et blocs de code `json` (un objet, ou un tableau d'objets).

## 2. Google Apps Script

1. Drive : créer le dossier racine des photos (aucun partage nécessaire) → copier son ID (fin de l'URL).
2. script.google.com ▸ nouveau projet avec **six fichiers** : coller `gas/Code.gs` (fichier `Code`),
   `gas/Report.gs` (fichier `Report`), `gas/Auth.gs` (fichier `Auth`), `gas/Methods.gs` (fichier `Methods`),
   `gas/Machines.gs` (fichier `Machines`) et `gas/Racks.gs` (fichier `Racks`). Afficher le manifeste
   (Paramètres du projet ▸ « Afficher le fichier appsscript.json ») et y coller `gas/appsscript.json`.
   Le contrat d'API (requêtes, fusion, codes d'erreur) est dans `gas/API.md`.
3. Paramètres du projet ▸ **Propriétés du script** :

   | Propriété | Valeur |
   |---|---|
   | `NOTION_TOKEN` | secret de l'intégration |
   | `NOTION_DB_ID` | ID de la base Interventions |
   | `DRIVE_FOLDER_ID` | ID du dossier racine Drive |
   | `PASSWORD_TECH` | mot de passe commun des **techniciens** (12 caractères ou plus) |
   | `PASSWORD_SUPPORT` | mot de passe du **support** (optionnel ; donne tous les droits du technicien, et à l'avenir les pages réservées au support) |
   | `SESSION_DAYS` | optionnel : durée d'une connexion, défaut 30 jours |
   | `SESSION_EPOCH` | optionnel : passer de `1` à `2` pour **déconnecter tous les appareils** (après un changement de mot de passe, par exemple) |
   | `REF_PROPERTY_NAME` | optionnel, défaut `ID` |
   | `REF_PROPERTY_TYPE` | optionnel, défaut `unique_id` |
   | `PROPERTY_ORDER` | optionnel : noms des colonnes à afficher en premier, séparés par la barre verticale (ex. `Nom\|Client\|Adresse\|Statut`, à saisir sans les `\`). L'API Notion ne donne aucun ordre fiable : on le fixe ici. Les colonnes non citées suivent. |
   | `HIDDEN_PROPERTIES` | optionnel : noms des colonnes à ne jamais envoyer à l'application, séparés par la barre verticale |
   | `TEST_PAGE_ID` | optionnel : ID d'une page de test de la base (pour `testNotionCapabilities`) |
   | `TEST_REFERENCE` | optionnel : ID court d'une fiche de test, ex. `FI-252` (pour `testTemplate`) |

4. Exécuter **`testSetup`** (accorder les autorisations) : vérifie Drive et liste les colonnes Notion.
   Puis **`testNotionFileUpload`** (API d'envoi de fichiers), **`testNotionCapabilities`** (insertion à une
   position, mise à jour en place, bloc de données de 2000+ caractères : **à faire avant tout usage réel**,
   c'est la seule vérification contre le vrai Notion), **`testTemplate`** (lit une fiche, liste les champs
   trouvés et signale les erreurs du template : voir `docs/templates/`) et **`testGetIntervention`** (contenu complet lu).
5. Déployer ▸ Nouveau déploiement ▸ Application Web — *Exécuter en tant que : Moi*,
   *Accès : Tout le monde*. Copier l'URL `/exec`.
   Après chaque modification du code : *Gérer les déploiements ▸ Modifier ▸ Nouvelle version*.
6. Optionnel : déclencheur quotidien sur `purgeStaleTempFiles` (nettoie les photos jamais synchronisées après 14 jours).

Test hors Apps Script : `cd gas && node --test "tests/*.test.mjs"` (48 scénarios sur un Notion et un Drive simulés :
fusion à deux techniciens, validation partagée, photos par lots, champs ajoutés, évolutions du template,
suppressions manuelles dans Notion, limites de l'API). Il vérifie la logique du script, pas le vrai Notion.

## 3. PWA

```bash
cd web
cp .env.example .env.local     # renseigner VITE_GAS_URL
npm install
npm test                       # tests (données, synchro de bout en bout avec le vrai code serveur, affichage)
npm run dev                    # développement
npm run build && npm run preview
```

À héberger en HTTPS (obligatoire pour une PWA). Ouvrir une mission :
`https://votre-domaine/?id=FI-252` ou saisir l'ID dans l'app.

**Première visite en ligne obligatoire** (installation du cache). Sur iPhone : *Partager ▸ Sur l'écran d'accueil*
pour que les données ne soient pas purgées par Safari.

### Connexion et niveaux d'accès (nouveau)

- À l'ouverture, l'application demande **prénom, nom et mot de passe**. Le mot de passe détermine le niveau :
  `PASSWORD_TECH` → *Technicien*, `PASSWORD_SUPPORT` → *Support* (le support voit tout ce que voit le technicien ;
  les pages réservées au support se brancheront sur `minRole: 'support'` dans `web/src/router.js` et `web/src/lib/nav.js`).
- Le serveur ne renvoie **aucune donnée** sans session valide (jeton signé, 30 jours). L'application publiée ne contient
  aucun secret. 5 mots de passe erronés → l'appareil est bloqué 10 minutes.
- La session reste sur l'appareil : on peut travailler **hors ligne** même session expirée ; la reconnexion est exigée au
  premier appel réseau, sans perte de saisies. *Se déconnecter* ne supprime pas les données de l'appareil.
- Mise en place : ajouter les propriétés `PASSWORD_TECH` (et `PASSWORD_SUPPORT`), coller `Auth.gs`, lancer **`testAuth`**
  (vérifie la configuration sans rien afficher de secret), redéployer une **nouvelle version**, puis rebuilder la PWA.
  Supprimer `APP_TOKEN` (inutile) et le secret GitHub `VITE_APP_TOKEN`.
- Un appareil déjà connecté qui connaît encore l'ancienne version de l'application affichera « Connexion requise » : mettre
  à jour l'application (bandeau « Nouvelle version disponible »).

### Menu et pages

Menu latéral (tiroir sur téléphone, colonne fixe sur grand écran) : Accueil · Fiches et CR · Méthodes · Machines ·
Racks et casiers KO · Inventaires · Réglages. **Inventaires est annoncé mais pas encore
développé** ; **Méthodes**, **Machines** et **Racks et casiers KO** sont disponibles (sections suivantes). *Réglages* : nom, thème, taille du texte, synchronisation, stockage, déconnexion. **Stockage** : liste des fiches d'intervention gardées sur l'appareil (suppression une à une — confirmation si la fiche contient des saisies non envoyées —, ou « Retirer toutes les fiches déjà envoyées »), et suppression séparée des copies Méthodes / Machines / Racks. La page *CR d'intervention* permet aussi de supprimer une fiche locale (icône corbeille). Un champ ajouté à un CR se retire avec une petite icône corbeille.

### Méthodes (fiches de maintenance)

Source : la base Notion « MO Maintenance Physique » (ID par défaut `34937d20ee35803c8909cf0fd8cda157`, propriété de script
`METHODS_DB_ID` pour en changer). **Connectez l'intégration à cette base** (⋯ ▸ Connexions). Lecture seule.

- **Liste** : fiches regroupées par *Ensemble* (une fiche de plusieurs ensembles apparaît dans chacun ; sans ensemble → « Autres »),
  recherche instantanée (titre, ensemble, résumé), statut en pastille. Les fiches au statut **« Pas commencé »** ne sont pas
  publiées (réglable : `METHODS_HIDDEN_STATUS`, noms séparés par `|` ; `METHODS_HIDDEN_TITLES` pour masquer des fiches par leur titre,
  par exemple « CR Interventions » qui est un mémo interne).
- **Fiche** (style tutoriel) : titre, ensembles, statut, date de mise à jour · **deux icônes en haut à droite** : fichier (colonne
  *Doc* → ouvre la méthode dans Google Docs) et dossier (colonne *Dossier* → ouvre le dossier qui la contient) · **carrousel** des
  photos et vidéos de la colonne *Medias* **dans l'ordre de Notion** (glisser, flèches, points ; sans colonne *Medias*, la première
  image/vidéo du corps sert de bandeau ; un lien YouTube/Vimeo/Loom collé dans *Medias* devient une vidéo intégrée) · encadré
  « À savoir » (colonne *Notes*, liens cliquables) · boutons **Support** (fichiers de la colonne *Support*, PDF ouvert depuis
  l'appareil) · sommaire · le corps de la page découpé par grands titres. Les titres reconnus par leur nom prennent une
  forme adaptée : **Matériel** et **Outils** → listes à cocher ; **Étapes / Procédure / Réalisation / Intervention / Dépannage** →
  étapes numérotées avec leurs photos ; **Avant de commencer / Sécurité / Prérequis** → encadré d'alerte ; **Résumé / Objectif /
  Principe** → encadré. Tout le reste (paragraphes, listes, images, vidéos, fichiers, tableaux, citations, toggles) s'affiche tel quel.
  Pour qu'une fiche rende bien, structurez-la avec des titres `## Matériel`, `## Outils`, `## Étapes` (liste numérotée, photo sous chaque étape).
- **Hors ligne** : à l'ouverture (avec réseau), la fiche et ses images sont gardées sur l'appareil ; le bouton **Tout télécharger**
  de la liste récupère toutes les fiches d'un coup (à faire en Wi-Fi avant une tournée). **Libérer l'espace** vide ce cache
  (sans toucher aux CR). Les adresses de fichiers Notion expirent après ~1 h : l'application ne les garde jamais, elle
  télécharge le fichier via le serveur (images et PDF jusqu'à 6 Mo). Plus gros (vidéo hébergée par Notion) : lien frais demandé
  à la lecture, **en ligne seulement**. Pour des vidéos lisibles partout, préférez un lien YouTube/Vimeo/Loom (intégré) ou le
  dossier Drive.
- **Commentaires** : en bas de chaque fiche, les techniciens publient un commentaire (1000 caractères, signé de leur nom).
  **À faire une fois** : ajouter à la base Notion une colonne de type **Texte** nommée « Commentaires » (autre nom :
  `METHODS_PROP_COMMENTS`). Chaque commentaire y est ajouté en fin de colonne (« Prénom Nom · 29/10/2026 08:22 », puis le texte) ;
  au-delà de 12 000 caractères, les plus anciens sont retirés. Écrit hors ligne, il est affiché tout de suite « en attente
  d'envoi » puis envoyé au retour du réseau (sans doublon, même si la réponse du serveur se perd).
- Propriétés de script facultatives si vos colonnes portent d'autres noms : `METHODS_PROP_GROUP` (Ensemble), `METHODS_PROP_STATUS`
  (Statut), `METHODS_PROP_DOC` (Doc), `METHODS_PROP_FOLDER` (Dossier), `METHODS_PROP_SUPPORT` (Support), `METHODS_PROP_MEDIAS`
  (Medias), `METHODS_PROP_NOTES` (Notes), `METHODS_PROP_ERRORS` (Erreurs Associées).
- Test dans l'éditeur Apps Script : exécuter `testMethods()` (nombre de fiches par ensemble, exemple de fiche).

### Liste des machines

Source : la base Notion « Liste des machines » (ID par défaut `26b37d20ee3580f3b76dc45d5073b74c`, propriété de script
`MACHINES_DB_ID`). **Connectez l'intégration à cette base** — et aux bases liées dont vous voulez afficher le nom (régions de stock,
clients) : sans cela, ces champs restent vides. Lecture seule.

- **Liste** : machines regroupées par **région de stock**, recherche (nom, ville, adresse, n° de projet), pastille d'état
  (« Station Bloquée »…). Les machines **hors exploitation** (colonne *En exploitation* ≠ OUI) sont masquées, avec une case pour les afficher.
- **Fiche** : *Adresse* avec boutons **Itinéraire** (Google Maps), **Waze** et **Copier l'adresse** · **Code boîte à clés** en gros
  caractères avec **Copier** · **Wi-Fi** : si la colonne contient « SSID : … / MDP : … », réseau et mot de passe ont chacun leur bouton
  Copier (sinon le texte est affiché tel quel) · connexion machine et options en pastilles · colis et pièces de maintenance ·
  autres informations du site · client, région, projet, type, mise en service, objectif de commandes · **photos du site**
  (agrandissables) · contenu de la page Notion s'il y en a. **Toute colonne qui n'est pas prévue apparaît automatiquement** dans
  « Informations » ; les relations « Actions » (très longues) et « Liste des projets » ne sont pas publiées.
- **Hors ligne** : comme pour les méthodes (fiche et photos gardées à l'ouverture, **Tout télécharger**, **Libérer l'espace**).
  ⚠ Les codes (boîte à clés, Wi-Fi) téléchargés restent sur l'appareil : verrouillez-le. Ils ne sont servis qu'à une session valide.
- Noms de colonnes différents : propriétés de script `MACHINES_PROP_<NOM>` (liste dans l'en-tête de `Machines.gs`), `MACHINES_HIDDEN_PROPERTIES`
  (colonnes à ne pas publier, séparées par `|`), `MACHINES_ACTIVE_YES` (valeurs signifiant « en exploitation », défaut `OUI|Oui|Yes|true`).
- Test dans l'éditeur Apps Script : exécuter `testMachines()`.

### Racks et casiers KO

Source : la base Notion « Casiers et Racks KO CZ » (ID par défaut `27e37d20ee35806294f7f3bf21b1d545`, propriété `RACKS_DB_ID`).
**Connectez l'intégration à cette base ET à la liste des machines** (nom des sites), et **créez dans la base une colonne de type Texte
nommée « Commentaire technicien »** (autre nom : `RACKS_PROP_COMMENT`). Sans cette colonne, l'enregistrement est refusé avec un message clair.

- **Écran 1 — sites** : un site par carte, avec le nombre de casiers/racks à traiter et « n/N diagnostiqués ».
- **Écran 2 — un site** : onglets **Casiers**, **Racks** (et « Autres » pour les noms qui ne commencent ni par « Casier » ni par « Rack »),
  tri numérique (9, 14-2, 110), case « Masquer ceux déjà diagnostiqués ». Case **« Afficher tous les états »** : la liste montre alors
  tous les éléments du site (KO, Diag tech, Remis, Dead…) avec leur état, et des pastilles permettent de filtrer par état.
- **Diagnostic technicien** : on touche un élément → quatre gros boutons **Réparé · Non réparable · Laissé en l'état · À surveiller**,
  un commentaire facultatif, **Enregistrer**. Le diagnostic va dans « Commentaire technicien » (quatre lignes :
  `État : …` / `Date : 29/10/2026 08:22` / `Tech : Prénom Nom` / `Commentaire : …`, les plus récents en haut, séparés par `---` ;
  `RACKS_COMMENT_MODE=replace` ne garde que le dernier) **et l'état Notion passe de « KO » à « Diag tech »** (propriété
  `RACKS_DIAG_STATE`, défaut « Diag tech ») pour que le support vérifie. Un élément déjà « Remis » ou « Dead » garde son état.
  Si la colonne « État » est de type **Sélection**, l'option « Diag tech » est créée automatiquement ; si elle est de type **Statut**,
  ajoutez la valeur « Diag tech » dans Notion (sinon l'enregistrement est refusé avec un message clair).
- **Profil « support technique »** : sur chaque élément, un menu **« État dans Notion »** (les valeurs de la colonne) + **Appliquer**
  pour valider ou changer l'état (ex. Diag tech → Remis). Le changement est tracé par un commentaire Notion « [Nom] État : A → B »
  si l'intégration peut écrire des commentaires. Un technicien n'a pas ce menu (le serveur refuse : `FORBIDDEN_ROLE`).
- **Commentaires Notion** : sur chaque élément déplié, la liste des commentaires de la page Notion (auteur, date) — c'est là que
  l'équipe note ses diagnostics. Le support peut en **ajouter** depuis l'application (publiés sous la forme « [Prénom Nom] texte »).
  **Dans notion.so/my-integrations, donnez à l'intégration les capacités « Read comments » et « Insert comments »** ; sans elles
  l'application affiche un message explicite (`COMMENTS_FORBIDDEN`). La lecture demande du réseau (non gardée hors ligne).
- **Recherche (loupe dans l'en-tête, sur toutes les pages)** : tapez un numéro (« 14 » met « Casier 14-2 » avant « Rack 1141 »),
  et filtrez par **site**, **état** (« À traiter », « Tous les états » ou un état précis) et **type** (casier / rack). Hors ligne, la
  recherche porte sur les sites déjà ouverts sur l'appareil.
- Quels éléments « à traiter » : « État » égal à **KO** ou **Diag tech** (`RACKS_KO_STATES`, séparés par `|`) et reliés au site par la colonne
  « 🤖 Site » (`RACKS_PROP_SITE`, `RACKS_PROP_STATE`, `RACKS_PROP_CAUSE` si vos colonnes portent d'autres noms).
- **Hors ligne** : sites et listes sont gardés à l'ouverture ; un diagnostic, un changement d'état ou un commentaire saisi sans réseau est
  conservé, affiché « En attente d'envoi » et envoyé au retour du réseau (bandeau avec le nombre d'envois en attente). Un envoi refusé
  reste visible avec **Réessayer** / **Supprimer**.
- Test dans l'éditeur Apps Script : `testRacks()` (KO par site, présence de la colonne de commentaire).

### Utilisation sur le terrain

- **Nom** : à la première ouverture l'application demande prénom + nom (modifiables dans *Réglages*, en bas de l'accueil).
  Rien n'est envoyé dans Notion tant qu'il n'est pas renseigné ; les saisies, elles, sont déjà gardées sur l'appareil.
- **Saisie** : chaque frappe est enregistrée sur l'appareil (aucun bouton « Enregistrer »). Notion est mis à jour
  automatiquement dans la minute qui suit la première modification (fiche ouverte), puis toutes les 5 min tant qu'il y a du nouveau, et
  immédiatement au retour du réseau, à la reprise de l'application, sur « Envoyer maintenant » et sur « Valider ».
  En-tête du rapport Notion : état (En cours / Validé), dernier auteur, heure.
- **Valider le CR** : vérifie les champs obligatoires (liste cliquable ; « Valider quand même » possible), fige le
  formulaire et envoie tout. **Modifier à nouveau** le rouvre (pour tous les appareils).
- **Photos** : réduites en JPEG sur l'appareil, envoyées progressivement par lots de 6, la validation partant après la
  dernière. Les photos d'un collègue apparaissent comme vignettes « Prénom · heure » sans image (le serveur ne diffuse
  pas de lien d'image) ; les vôtres s'affichent même hors ligne.
- **À deux sur une fiche** : fusion champ par champ (la saisie la plus récente gagne). Le technicien écrasé voit
  « X a modifié ce champ à 10:42 » avec **Remettre la mienne** / **Garder la sienne**. Si l'autre valide pendant que vous
  éditez, vos saisies restent sur votre appareil et vous pouvez rouvrir.
- **Actualiser** : récupère les champs ajoutés au template dans Notion ; les saisies ne sont jamais touchées.
- **Ajouter un champ** : texte court/long, nombre, case, choix unique, photos. Visible des collègues, inscrit dans la section
  « Ajouts terrain » du rapport.
- **Lecture** : sections repliables avec compteur « remplis/total », *Masquer les champs remplis*, *Tout replier*, menu
  *Aller à…*. Ces réglages sont propres à l'appareil et à la mission.
- **Thème** : Auto / Clair / Sombre (*Réglages*). Auto suit le téléphone.

### Données locales (IndexedDB, schéma v6)

Une fiche locale contient les saisies (`fields`, avec heure et auteur, marquées `dirty` tant que le serveur ne les a pas
acquittées), les champs ajoutés, les demandes de suppression, le dernier état partagé du serveur, la demande de
validation/réouverture en attente et le suivi des envois (essais, prochain essai : attente 30 s ×2, jusqu'à 15 min).
Les photos sont dans une file séparée (`media_queue`, Blob). La migration depuis la v1 est automatique. Les fiches méthodes et les machines ont leurs propres
stores (`methods_index`, `methods`, `method_media` ; `machines_index`, `machines`, `machine_media`), de même que les racks (`racks_overview`, `racks_sites`) et la file d'envois en attente (`outbox`). Rien n'est supprimé automatiquement de l'appareil.

> **Note de vérification** : le code Vue n'a pas pu être compilé dans l'environnement de développement (pas d'accès au
> registre npm) ; il a été contrôlé par analyse de syntaxe, mais le premier `npm run build` (GitHub Actions) est le vrai test.
> En cas d'échec, copiez le journal de l'étape « build » : la correction est en général d'une ligne.

### Propriétés en lecture seule : ordre, masquage, repli

- **Ordre par défaut, pour tous** : propriété de script `PROPERTY_ORDER` (voir §2). L'API Notion ne documente aucun
  ordre pour les propriétés d'une page ; il faut donc le déclarer une fois.
- **Sur un appareil** : dans l'écran d'une mission, le bloc « Mission » se replie d'un appui sur son titre, et
  « Personnaliser » permet de monter, descendre et masquer chaque champ (« Rétablir l'ordre d'origine » annule).
  Ce réglage est enregistré sur l'appareil, s'applique à toutes les missions et ne modifie jamais Notion.
- Une mission déjà chargée sur un appareil garde l'ordre reçu à son premier chargement ; la personnalisation sur
  l'appareil, elle, agit tout de suite.

### Créer des templates

**Astuce de mise en page** : rangez tout le template (titres, cases, blocs `json`) dans un **toggle** ou un **titre déroulant** dont le titre
commence par « Template » (ex. *Template formulaire d'intervention*). Repliez-le dans Notion pour retrouver tout de suite le
rapport du technicien juste en dessous. Le titre du toggle n'apparaît pas dans le formulaire ; son contenu est lu normalement
(profondeur maximale : 2 niveaux de toggles imbriqués).

Tous les modèles Notion sont dans `docs/` (index : `docs/README.md`), dont `docs/templates/template-preventive-machine.md` (CR de préventive machine).
`docs/templates/template-exemple.md` : template complet à coller dans une page Notion (il passe dans le test
`gas/tests/template-example.test.mjs`). Le mémo de référence (blocs reconnus, types de champs, règles, dépannage)
est le document « Mémo — Créer un template de CR dans Notion ».

**Images, vidéos, PDF et HTML dans la page** : tout ce que vous posez dans le contenu de la page (dans le toggle « Template … » ou à côté) est affiché
dans le formulaire : images, vidéos, PDF et fichiers importés (gardés sur l'appareil à l'ouverture de la mission, donc lisibles hors ligne), liens,
et blocs de code **HTML** dans un cadre isolé. Détails et limites : `docs/templates/structure-page-mission.md`. Dans Réglages ▸ Stockage, ces copies
se suppriment avec « Images et fichiers des missions ».

### Publication sur GitHub Pages

1. Créer un dépôt GitHub et y pousser **le contenu du dossier `ouidrop-interventions`** (`.github/`, `gas/`, `web/`, `README.md`) sur la branche `main`. Ne jamais commiter `.env.local`.
2. Settings ▸ Pages ▸ *Build and deployment* ▸ Source : **GitHub Actions**.
3. Settings ▸ Secrets and variables ▸ Actions : variable `VITE_GAS_URL` (URL `/exec`). Plus aucun secret : l'ancien `VITE_APP_TOKEN` peut être supprimé.
4. Onglet Actions ▸ « Déployer la PWA » ▸ *Run workflow* (ou un push). L'adresse est
   `https://<compte>.github.io/<dépôt>/`. Ouvrir une mission : `…/?id=FI-252`.
5. Après un changement de code Apps Script, redéployer une **nouvelle version** du déploiement web (l'URL `/exec` reste la même).

L'URL du script est intégrée au JavaScript publié (lisible par tous) ; elle ne donne accès à rien sans mot de passe.
Sur l'offre gratuite de GitHub, Pages exige un dépôt public (le code l'est donc aussi). À réserver à des données non sensibles.

## Versions de l'API Notion

`Code.gs` envoie `Notion-Version: 2022-06-28`. Dernière version publiée : `2026-03-11`
(https://developers.notion.com/reference/versioning). Notion ne prévoit pas de retirer les anciennes ;
les nouveaux endpoints (envoi de fichiers) fonctionnent sans changer de version. Ne pas passer à
`2025-09-03` ou plus sans adapter `findPageByReference_` (bases remplacées par des « data sources »).

## Comment fonctionne le rapport partagé

La page Notion contient **trois toggles frères**, dans cet ordre :

```
▸ Template CR intervention                       ← à écrire par vous (le formulaire ; titre commençant par « Template »)
▸ CR intervention — En cours | Validé            ← le rapport, écrit par l'application
▸ Données de synchronisation (ne pas modifier)   ← JSON : c'est lui, pas le texte visible, qui fait foi
```

Le rapport contient la ligne grise « Dernière modification : Prénom Nom · date », un bloc par élément du
template (mis à jour **en place**) et les photos sous leur champ. Notion ne permet pas à l'API de laisser un
toggle ouvert ou fermé : à vous de replier ce que vous voulez masquer. Les rapports de l'ancien format
(callout 📋) sont remplacés à la première synchronisation suivant la mise à jour (les appareils renvoient
leurs saisies ; un avertissement est affiché). Plusieurs techniciens écrivent dans le même rapport ; les saisies sont fusionnées champ par champ
(la plus récente gagne, la valeur écrasée est signalée à son auteur), les photos s'additionnent.
Les responsables peuvent ajouter des blocs au template à tout moment (même après le début du rapport) :
les techniciens les récupèrent avec « Actualiser » sans perdre leurs saisies.

**Ne pas modifier à la main** les blocs à l'intérieur du rapport : l'application ne les relit pas et les
écrase à la prochaine modification du champ concerné. Un bloc supprimé à la main est recréé ; un rapport
supprimé est reconstruit (le client renvoie alors tout ce qu'il a).

## Limites connues

- Écriture seule vers Notion : une correction faite à la main dans le rapport n'est pas reprise par l'application.
- Heure de saisie = horloge du téléphone corrigée du décalage mesuré avec le serveur (latence incluse, ~1 s) :
  deux saisies à moins d'une seconde d'écart sur le même champ peuvent se départager « à l'envers ».
- Pas de comptes individuels : deux mots de passe **partagés** (technicien / support), le nom est déclaré par
  l'utilisateur (non vérifié). Quiconque connaît un mot de passe a tous les droits de son niveau ; si l'un fuite,
  le changer **et** augmenter `SESSION_EPOCH`.
- Apps Script coupe une requête à 6 min : les photos sont transférées par lots de 6 par appel (durée par photo
  non mesurée sur le vrai système). Le verrou est unique pour tout le script : des synchronisations simultanées
  de fiches différentes s'exécutent l'une après l'autre (attente max. 30 s, puis `BUSY` et nouvel essai).
- Notion limite à ~3 requêtes/s ; une synchronisation de *k* champs modifiés coûte environ *k* + 3 appels Notion
  (estimation à partir du code, non mesurée). La relève des collègues (`getReport`) n'appelle pas Notion tant
  que rien n'a changé (cache 6 h). Quotas Apps Script (appels `UrlFetch` par jour, durée totale) : à vérifier
  pour votre type de compte avant le déploiement général.
- « Présence » (qui est sur la fiche) : en cache, volatile, jamais écrite dans Notion.
- Le rapport est limité à ~190 000 caractères de données de synchronisation (erreur `STATE_TOO_LARGE`).
- Notion refuse un fichier > 20 Mo (la PWA envoie des JPEG ≈ 300 Ko).
- Pas de synchronisation en arrière-plan fiable pour une PWA (iOS) : l'envoi a lieu quand l'application est ouverte.
- Mises à jour de l'API Notion : voir plus haut ; l'insertion « après un bloc » essaie la syntaxe actuelle puis
  l'ancienne, et à défaut ajoute en fin de rapport (avertissement `POSITION_UNSUPPORTED`).
