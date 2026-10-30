# Avant d'intervenir

Vérifiez l'identité du client et l'accès au site avant de toucher au matériel.

- [ ] Identité du client vérifiée
- [ ] Zone dégagée et sécurisée

```json
{ "type": "radio_group", "id": "acces_site", "label": "Accès au site",
  "options": ["Libre", "Clé", "Badge", "Accompagné"], "required": true }
```

```json
{ "type": "checkbox_group", "id": "epi", "label": "Équipements de protection portés",
  "options": ["Casque", "Gants", "Chaussures de sécurité", "Lunettes"],
  "help": "Cochez tout ce qui est porté.", "required": true }
```

## Photos avant intervention

```json
{ "type": "image_upload", "id": "photo_avant", "label": "Installation avant intervention",
  "help": "Vue d'ensemble, puis plaque signalétique.", "max": 6, "required": true }
```

# Intervention

```json
[
  { "type": "text", "id": "ref_materiel", "label": "Référence du matériel posé", "placeholder": "Ex. CPT-4520", "required": true },
  { "type": "number", "id": "index_releve", "label": "Index relevé", "unit": "kWh", "min": 0, "required": true }
]
```

```json
{ "type": "select", "id": "etat_depose", "label": "État du matériel déposé",
  "options": ["Neuf", "Usagé", "Défectueux", "Détruit"] }
```

```json
{ "type": "textarea", "id": "travaux", "label": "Travaux réalisés",
  "placeholder": "Décrivez ce qui a été fait, dans l'ordre.", "required": true }
```

- [ ] Matériel déposé évacué

# Photos après intervention

```json
{ "type": "image_upload", "id": "photo_apres", "label": "Installation après intervention", "max": 6, "required": true }
```

# Clôture

```json
{ "type": "radio_group", "id": "resultat", "label": "Résultat de l'intervention",
  "options": ["Terminée", "Terminée avec réserves", "À reprogrammer"], "required": true }
```

```json
[
  { "type": "textarea", "id": "remarques", "label": "Remarques et réserves" },
  { "type": "date", "id": "prochaine_visite", "label": "Prochaine visite à prévoir", "help": "Seulement si l'intervention est à reprogrammer." },
  { "type": "checkbox", "id": "client_present", "label": "Client présent en fin d'intervention" }
]
```

- [ ] Zone nettoyée et remise en état
