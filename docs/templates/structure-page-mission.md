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

Types de champs : `text`, `textarea`, `number`, `date`, `checkbox`, `radio_group`, `select`, `checkbox_group`, `image_upload`.
Clés utiles : `id` (unique, lettres/chiffres/`_`/`-`, 64 max, jamais `u_`, `todo_`, `S:`), `label` (200 max), `options` (2 à 20, 80 caractères max chacune),
`required`, `help`, `placeholder`, `unit`, `min`, `max` (nombre de photos).
