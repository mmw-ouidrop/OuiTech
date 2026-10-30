# Structure d'une page de mission dans Notion

Chaque fiche d'intervention (base « Interventions ») contient, dans la zone de contenu de la page, **trois toggles frères**, dans cet ordre :

```
▸ Template CR intervention                       ← à écrire par vous : le formulaire (le titre doit commencer par « Template »)
▸ CR intervention — En cours | Validé            ← le rapport, écrit par l'application (ne pas modifier à la main)
▸ Données de synchronisation (ne pas modifier)   ← JSON : c'est lui, pas le texte visible, qui fait foi
```

## Mise en place d'un template

1. Ouvrir la page de la mission et créer un toggle intitulé **Template CR intervention** (ou « Template préventive machine »…).
2. Copier le contenu d'un fichier de `docs/templates/` (par exemple `template-preventive-machine.md`) et le **coller dans le toggle**.
   Notion convertit les titres, listes et blocs de code `json` en vrais blocs.
3. Vérifier que les blocs de code sont bien en langage **json** (sinon ils sont ignorés).
4. Dans l'éditeur Apps Script, lancer `testTemplate` (propriété `TEST_REFERENCE` = référence d'une fiche) : il liste les champs trouvés et signale les erreurs.

## Blocs reconnus

| Bloc Notion | Effet dans le formulaire |
|---|---|
| Titre 1 / 2 | Section |
| Paragraphe, liste, citation | Consigne affichée |
| Case à cocher (`- [ ]`) | Champ case à cocher |
| Bloc de code **json** (un objet ou un tableau d'objets) | Un ou plusieurs champs |
| **Image**, **Vidéo**, **PDF**, **Fichier**, **Audio** (importés dans Notion) | Affichés dans le formulaire, gardés sur l'appareil à l'ouverture de la mission (lisibles hors ligne, jusqu'à 6 Mo ; plus gros : lien, en ligne). La légende s'affiche sous le média. |
| Image / vidéo par **lien externe** (https) | Image affichée directement ; vidéo YouTube / Vimeo / Loom intégrée (en ligne) |
| **Embed**, **Marque-page** | Lien cliquable |
| Bloc de code **HTML** (langage « HTML » dans Notion) | Affiché tel quel dans un cadre isolé : voir ci-dessous |

Ces médias, liens et blocs HTML ne sont **pas** des champs : ils ne figurent pas dans le rapport. Ils peuvent se trouver dans le toggle « Template … »
(2 niveaux d'imbrication lus au maximum). Les tableaux, colonnes et synchronized blocks ne sont pas affichés.

## Blocs HTML personnalisés

Glissez un bloc de code, choisissez le langage **HTML**, collez votre code (exemple : `exemple-bloc-html.md`). Le bloc s'affiche dans l'application
(100 000 caractères au plus) dans un cadre isolé :
- pas d'accès à l'application, à ses données ni à la session ;
- aucune requête réseau du script (pas de `fetch`, pas de formulaire) ;
- styles et petits scripts **intégrés** autorisés, y compris hors ligne ;
- images, vidéos et polices doivent être en **https** (elles demandent du réseau) ; les liens s'ouvrent dans un nouvel onglet ;
- la page s'adapte au mode clair / sombre du téléphone (`color-scheme`). Utilisez `prefers-color-scheme` si vous fixez des couleurs.

Types de champs : `text`, `textarea`, `number`, `date`, `checkbox`, `radio_group`, `select`, `checkbox_group`, `image_upload`.
Clés utiles : `id` (unique, lettres/chiffres/`_`/`-`, 64 max, jamais `u_`, `todo_`, `S:`), `label` (200 max), `options` (2 à 20, 80 caractères max chacune),
`required`, `help`, `placeholder`, `unit`, `min`, `max` (nombre de photos).
