# Documentation et modèles Notion

| Fichier | Contenu |
|---|---|
| `templates/template-preventive-machine.md` | **CR de préventive sur machine (Préventives 2.0)** — à coller dans le toggle « Template … » d'une page de mission |
| `templates/template-exemple.md` | Template d'exemple générique (tous les types de champs) |
| `templates/structure-page-mission.md` | Structure d'une page de mission (3 toggles), blocs reconnus, mise en place |
| `templates/exemple-bloc-html.md` | Exemple de bloc HTML personnalisé affichable dans l'application |
| *(dans l'application)* | **Écran « Modèles de CR »** (profil support, menu ▸ Modèles de CR) : prépare le template d'une mission sans écrire de JSON ; bouton **Sans code / Code** en haut (le même template en Markdown + blocs ```json, comme les fichiers de `templates/`), reprise d'un template existant (à la suite ou en remplacement), l'icône **?** ouvre l'aide |
| `bases-notion.md` | Bases Notion utilisées, colonnes et capacités d'intégration |

Les fichiers de `templates/` sont contrôlés par les tests (`gas/tests/template-example.test.mjs`) : lecture sans avertissement et synchronisation.


## Pièces jointes et PDF du CR
- Un champ `image_upload` accepte photos (HEIC converti en JPEG), PDF et vidéos, 20 Mo max par fichier (limite Notion ; 5 Mo sur un espace Notion gratuit).
- Bouton « Télécharger le CR en PDF » (fiche) : page imprimable `#/m/<réf>/pdf` générée hors ligne depuis l'appareil ; « Enregistrer en PDF » dans la fenêtre d'impression. Photos intégrées ; vidéos/PDF listés par leur nom.

## Actions à réaliser
La relation « Actions prévues » de la fiche est lue (Actions.gs). Le technicien voit chaque action (consigne, outillage, plans, casiers/tickets liés),
choisit un état (À faire / En cours / Terminée / Impossible) et peut commenter (dictée vocale possible) ; l'envoi se fait dans les commentaires Notion de l'action,
même hors ligne (file d'envoi). Nécessite les capacités « Read comments » et « Insert comments » de l'intégration. Noms de colonnes modifiables : propriétés de script `ACTIONS_*` (voir en-tête d'Actions.gs).
