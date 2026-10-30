**Préventive machine 2.0** — formulaire de préventive sur machine, construit avec les retours des techniciens terrain. Une idée d'amélioration ? Dites-le au support technique.

# Informations générales

```json
[
  {"type": "date", "id": "date_intervention", "label": "Date d'intervention", "required": true},
  {"type": "text", "id": "site", "label": "Nom du site", "required": true},
  {"type": "text", "id": "intervenants", "label": "Nom(s) du ou des intervenant(s)", "required": true, "placeholder": "Prénom Nom, Prénom Nom"}
]
```

# Contrôles de départ

```json
[
  {"type": "radio_group", "id": "test_aru", "label": "Test des 4 ARU", "options": ["Les 4 sont fonctionnels", "Un ARU est non fonctionnel", "Plusieurs ARU sont non fonctionnels"], "required": true},
  {"type": "radio_group", "id": "origine_globale_debut", "label": "Demander au support technique d'effectuer une prise d'origine globale sur la machine", "options": ["Fait", "Pas fait"], "required": true}
]
```

# Appels de casiers

Appeler un casier L1-3, L2-2 (les 2 portes), L2-4 (les 2 portes) et un L1-2.

À observer pendant les appels :

- où ça « snappe » ;
- le jeu Toll / casier dans les ASC ;
- les bruits anormaux (courroies, SAS, transferts) ;
- les transferts en façade : y a-t-il des réitérations ?

```json
[
  {"type": "textarea", "id": "cr_appels_casiers", "label": "Compte rendu des observations suite aux appels de casiers", "required": true, "placeholder": "Écrivez « RAS » s'il n'y a rien à signaler."}
]
```

# Aspect général et accès à la machine

```json
[
  {"type": "radio_group", "id": "loquets_porte", "label": "Vérifier le serrage et l'état des loquets servant à verrouiller la porte de la machine", "options": ["Les deux loquets sont en bon état et correctement serrés", "Un des deux loquets est desserré", "Un des deux loquets est en mauvais état", "Les deux loquets sont desserrés", "Les deux loquets sont en mauvais état"], "required": true},
  {"type": "radio_group", "id": "tv", "label": "La TV fonctionne-t-elle ?", "options": ["Oui", "Éteinte et pas de télécommande", "Image pas droite et pas de télécommande"], "required": true},
  {"type": "image_upload", "id": "photo_ecrans_bornes", "label": "Photos des écrans de bornes", "max": 6, "required": true},
  {"type": "image_upload", "id": "photo_interieur_borne", "label": "Prendre en photo l'intérieur de la borne", "max": 6, "required": true},
  {"type": "image_upload", "id": "photo_aspect_general", "label": "Photo de la machine (aspect général)", "max": 6, "required": true},
  {"type": "textarea", "id": "cr_aspect_general", "label": "Commentaires aspect général et intérieur borne", "placeholder": "Propreté, dégradations, humidité… « RAS » si rien à signaler."}
]
```

# SAS

Nous allons analyser les SAS. Un compte rendu des travaux effectués sur les SAS est demandé à la fin de cette section.

```json
[
  {"type": "radio_group", "id": "sas_snappers_visserie", "label": "Resserrer les bâtis des snappers (12 vis à resserrer)", "options": ["Les vis étaient toutes bien serrées", "Certaines vis étaient desserrées", "La majorité des vis étaient desserrées"], "required": true},
  {"type": "radio_group", "id": "sas_jeu_cpc_nappe", "label": "Regarder le jeu entre la fixation de CPC et la nappe électronique", "options": ["Jeu présent", "Support en appui sur la nappe", "Pas de CPC", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "sas_equerres_origine", "label": "Resserrage des équerres qui supportent le profilé de prise d'origine SAS", "options": ["Les vis étaient toutes bien serrées", "Certaines vis étaient desserrées", "La majorité des vis étaient desserrées"], "required": true},
  {"type": "radio_group", "id": "sas_proprete_profile", "label": "Contrôler la propreté du profilé", "options": ["RAS, il ne collait pas", "Le profilé était collant", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "image_upload", "id": "sas_photo_ils", "label": "Prendre en photo l'alignement des capteurs rouges (ILS) en position SAS fermé", "max": 6, "required": true},
  {"type": "radio_group", "id": "sas_connectique", "label": "Vérifier les connectiques (état des cartes, fils mal tenus, connecteurs tordus, etc.)", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "image_upload", "id": "sas_photos", "label": "Photos des SAS", "max": 6, "required": true},
  {"type": "textarea", "id": "sas_cr", "label": "Compte rendu des travaux effectués sur les SAS", "required": true, "placeholder": "Travaux réalisés, pièces changées, points d'attention. Écrivez « RAS » s'il n'y a rien à signaler."}
]
```

# ASC

Nous allons analyser les ASC. Un compte rendu des travaux effectués sur les ASC est demandé à la fin de cette section.

```json
[
  {"type": "radio_group", "id": "asc_visserie", "label": "Resserrer : toll / moteur / sondes de poids / supports capteurs / butée casier", "options": ["Les vis étaient toutes bien serrées", "Certaines vis étaient desserrées", "La majorité des vis étaient desserrées"], "required": true},
  {"type": "radio_group", "id": "asc_cpc_maillons", "label": "Les CPC ont-elles l'intégrité des maillons ?", "options": ["Oui", "Non (joindre des photos en fin de section)"], "required": true},
  {"type": "radio_group", "id": "asc_cpc_cables", "label": "Les câbles en sortie de CPC sont-ils bien attachés ?", "options": ["Oui", "Non"], "required": true},
  {"type": "radio_group", "id": "asc_courroie", "label": "Vérifier la tension de la courroie ASC", "options": ["RAS", "Reprise effectuée (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "asc_patins", "label": "Resserrer les patins ASC (ASC à positionner en 275 ou 135 si plaque de fermeture porte : appeler le support technique pour cette manipulation)", "options": ["Les vis étaient toutes bien serrées", "Certaines vis étaient desserrées", "La majorité des vis étaient desserrées"], "required": true},
  {"type": "textarea", "id": "asc_cr", "label": "Compte rendu des travaux effectués sur les ASC", "required": true, "placeholder": "Travaux réalisés, pièces changées, points d'attention. Écrivez « RAS » s'il n'y a rien à signaler."},
  {"type": "image_upload", "id": "asc_photos", "label": "Photos des travaux effectués sur les ASC", "max": 6}
]
```

# NAV

Nous allons analyser les NAV. Un compte rendu des travaux effectués sur les NAV est demandé à la fin de cette section.

```json
[
  {"type": "radio_group", "id": "nav_vis_accouplement", "label": "Serrage de la vis d'accouplement du moteur", "options": ["Bien serré", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_accouplement_axe", "label": "L'accouplement doit être équidistant de l'axe côté poulie et côté moteur", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_capteurs_origine", "label": "Capteurs de prise d'origine", "options": ["Moins de 2 mm", "Reprise nécessaire (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_capteurs_presence", "label": "Capteurs de présence casier", "options": ["Moins de 8 mm", "Reprise effectuée (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_jeu_patins_igus", "label": "Y a-t-il du jeu dans les patins Igus ?", "options": ["Non", "Reprise effectuée (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_vis_pied", "label": "Resserrage des vis qui tiennent le pied NAV", "options": ["Les vis étaient toutes bien serrées", "Certaines vis étaient desserrées"], "required": true},
  {"type": "radio_group", "id": "nav_courroies_prehension_etat", "label": "État des courroies de préhension casiers (regarder derrière les doigts)", "options": ["RAS", "Changement de PAP 1", "Changement de PAP 2", "Changement des 2 courroies"], "required": true},
  {"type": "radio_group", "id": "nav_courroies_prehension_tension", "label": "Vérifier la tension des courroies de préhension casiers", "options": ["Les deux courroies sont correctement tendues", "L'une des courroies est légèrement détendue", "L'une des courroies est très détendue", "Les deux courroies sont détendues"], "required": true},
  {"type": "radio_group", "id": "nav_origine_doigts", "label": "Vérifier que la prise d'origine des doigts de préhension est conforme, surtout après un changement de courroie", "options": ["3 mm maximum et alignement parfait", "Reprise nécessaire (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_connectique", "label": "Vérifier les connectiques (état des cartes, fils mal tenus, connecteurs tordus, etc.)", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_boucles_cables", "label": "Vérifier que les « boucles » de fils ou de câbles ne touchent pas un casier quand il est sur la navette", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_roue_bleue", "label": "La roue bleue touche-t-elle les casiers ?", "options": ["Non, elle ne touche pas", "Oui, elle touche les casiers", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "nav_tendeur", "label": "Vérifier l'état et la position du tendeur de courroies NAV (au niveau de la façade)", "options": ["OK sur les deux étages", "NOK sur un des étages", "NOK sur les deux étages"], "required": true},
  {"type": "radio_group", "id": "nav_tension_courroies", "label": "Vérifier la tension des courroies NAV (ouvrir tous les ALK et placer les NAV au fond de la zone surgelée)", "options": ["La tension est correcte", "Une des deux courroies est détendue", "Les deux courroies sont détendues"], "required": true},
  {"type": "textarea", "id": "nav_cr", "label": "Compte rendu des travaux effectués sur les NAV", "required": true, "placeholder": "Travaux réalisés, pièces changées, points d'attention. Écrivez « RAS » s'il n'y a rien à signaler."},
  {"type": "image_upload", "id": "nav_photos", "label": "Photos des travaux effectués sur les NAV", "max": 6}
]
```

# ALD

Nous allons analyser les ALD. Un compte rendu des travaux effectués sur les ALD est demandé à la fin de cette section.

```json
[
  {"type": "radio_group", "id": "ald_graissage", "label": "Les ALD sont-ils correctement graissés ?", "options": ["Oui", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "ald_capteurs", "label": "Vérifier que les capteurs ouverture / fermeture tombent en face", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "image_upload", "id": "ald_photos_humidite", "label": "Y a-t-il des traces d'humidité, de moisissures ou de condensation ? Si oui, prendre des photos", "max": 6, "help": "Facultatif : seulement s'il y a un problème."},
  {"type": "radio_group", "id": "ald_connectique", "label": "Vérifier les connectiques des cartes ALK (état des cartes, fils mal tenus, connecteurs tordus, etc.)", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "ald_courroie", "label": "Vérifier la tension de la courroie", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "textarea", "id": "ald_cr", "label": "Compte rendu des travaux effectués sur les ALD", "required": true, "placeholder": "Travaux réalisés, pièces changées, points d'attention. Écrivez « RAS » s'il n'y a rien à signaler."},
  {"type": "image_upload", "id": "ald_photos", "label": "Photos des travaux effectués sur les ALD", "max": 6}
]
```

# ALF

Nous allons analyser les ALF. Un compte rendu des travaux effectués sur les ALF est demandé à la fin de cette section.

```json
[
  {"type": "radio_group", "id": "alf_graissage", "label": "Les ALF sont-ils correctement graissés ?", "options": ["Oui", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "alf_capteurs", "label": "Vérifier que les capteurs ouverture / fermeture tombent en face", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "image_upload", "id": "alf_photos_glace", "label": "Y a-t-il des prises en glace, des traces d'humidité, de moisissures ou de condensation ? Si oui, prendre des photos", "max": 6, "help": "Facultatif : seulement s'il y a un problème."},
  {"type": "radio_group", "id": "alf_connectique", "label": "Vérifier les connectiques des cartes ALK (état des cartes, fils mal tenus, connecteurs tordus, etc.)", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "alf_courroie", "label": "Vérifier la tension de la courroie", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "alf_cordons_chauffants", "label": "Les cordons chauffants sont-ils fonctionnels ?", "options": ["Oui", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "textarea", "id": "alf_cr", "label": "Compte rendu des travaux effectués sur les ALF", "required": true, "placeholder": "Travaux réalisés, pièces changées, points d'attention. Écrivez « RAS » s'il n'y a rien à signaler."},
  {"type": "image_upload", "id": "alf_photos", "label": "Photos des travaux effectués sur les ALF", "max": 6}
]
```

# Contrôles généraux de la machine

Nous allons effectuer des contrôles généraux sur l'ensemble de la machine. Un dernier compte rendu sera demandé à l'issue de cette section, qui est la dernière.

```json
[
  {"type": "radio_group", "id": "gen_courroies_nav_airlock", "label": "État des courroies NAV au niveau des passages d'Airlock (amorce de rupture ?)", "options": ["RAS", "Courroies à changer (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "gen_pentes_evap", "label": "Contrôle général des pentes des évaporateurs : verser de l'eau et vérifier qu'elle s'évacue bien", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "gen_fuites_groupes_froids", "label": "Sous les groupes froids, y a-t-il des fuites suspectes ?", "options": ["RAS", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "gen_graissage_loquets", "label": "Graisser tous les loquets et mécanismes d'ouverture de porte des casiers surgelés", "options": ["100 % des casiers surgelés ont été graissés au WD-40 Silicone", "Autres (préciser dans le compte rendu de la section)"], "required": true},
  {"type": "radio_group", "id": "homing_global_fin", "label": "Demander au support technique de faire un homing global de la machine", "options": ["Fait", "Pas fait"], "required": true},
  {"type": "image_upload", "id": "photos_armoire_elec", "label": "Photos de l'armoire électrique", "max": 6, "required": true},
  {"type": "radio_group", "id": "plans_electriques", "label": "Les plans électriques sont-ils présents ?", "options": ["Oui", "Non"], "required": true},
  {"type": "textarea", "id": "gen_cr", "label": "Compte rendu des derniers travaux effectués et/ou remarques générales", "required": true, "placeholder": "Travaux réalisés, pièces changées, points d'attention. Écrivez « RAS » s'il n'y a rien à signaler."},
  {"type": "image_upload", "id": "gen_photos", "label": "Photos des derniers travaux", "max": 6}
]
```

# Matériel OUIDROP sur place

```json
[
  {"type": "radio_group", "id": "materiel_ouidrop", "label": "Tout le matériel OUIDROP est-il présent sur place ? (escabeau, graisse pour ALK + pinceaux, clé de l'armoire électrique, colis maintenance, étagère OUIDROP (version cellule)…)", "options": ["Oui, tout est présent", "Il manque du matériel (préciser ci-dessous)"], "required": true},
  {"type": "textarea", "id": "materiel_manquant", "label": "Matériel manquant ou à remplacer", "placeholder": "Laissez vide si tout est présent."},
  {"type": "image_upload", "id": "photos_materiel_ouidrop", "label": "Prendre en photo le matériel OUIDROP sur place (armoire des stocks, escabeau, outils…)", "max": 6, "required": true}
]
```

# Clôture

```json
[
  {"type": "radio_group", "id": "resultat_preventive", "label": "Résultat de la préventive", "options": ["Terminée", "Terminée avec réserves", "À reprogrammer"], "required": true},
  {"type": "textarea", "id": "points_support", "label": "Points à remonter au support technique (pièces à commander, interventions à prévoir…)", "placeholder": "Laissez vide s'il n'y a rien à remonter."},
  {"type": "text", "id": "signature_tech", "label": "Signature du technicien (prénom et nom)", "required": true}
]
```
