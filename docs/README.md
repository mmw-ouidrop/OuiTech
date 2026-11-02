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
