# Bases Notion utilisées par OuiTech

Pour chaque base : connecter l'intégration (⋯ ▸ Connexions). Les noms de colonnes ci-dessous sont les valeurs par défaut ; chacun peut être
changé par une propriété de script Apps Script (voir `gas/*.gs`).

| Base | ID par défaut | Accès | Colonnes à prévoir |
|---|---|---|---|
| Interventions (fiches FI-…) | propriété `NOTION_DB_ID` | lecture + écriture de la page | colonne ID (unique_id), Nom, Statut |
| MO Maintenance Physique (méthodes) | `34937d20ee35803c8909cf0fd8cda157` | lecture ; commentaires écrits | Ensemble, Statut, Doc, Dossier, Support, Medias, Notes, Erreurs Associées, **Commentaires** (Texte) |
| Liste des machines | `26b37d20ee3580f3b76dc45d5073b74c` | lecture (+ bases liées : régions, clients) | voir README « Liste des machines » |
| Casiers et Racks KO CZ | `27e37d20ee35806294f7f3bf21b1d545` | lecture + écriture | Nom, **État** (Sélection ou Statut avec « KO », « Diag tech », « Remis »…), 🤖 Site (relation), Cause, **Commentaire technicien** (Texte) |

Capacités de l'intégration (notion.so/my-integrations) : *Read content*, *Update content*, *Insert content*, **Read comments**, **Insert comments**.
