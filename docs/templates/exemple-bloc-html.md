# Exemple de bloc HTML personnalisé

Dans Notion : `/code`, langage **HTML**, puis coller ce qui suit.

```html
<style>
  .alerte { border-left: 6px solid #d9480f; background: rgba(217, 72, 15, .12); padding: 12px 16px; border-radius: 8px; }
  .alerte h3 { margin: 0 0 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid rgba(128, 128, 128, .5); padding: 6px 8px; text-align: left; }
</style>
<div class="alerte">
  <h3>⚠ Avant d'ouvrir l'armoire</h3>
  <p>Couper le disjoncteur Q1 et vérifier l'absence de tension.</p>
</div>
<table>
  <tr><th>Repère</th><th>Couple de serrage</th></tr>
  <tr><td>Vis accouplement moteur</td><td>5 N·m</td></tr>
  <tr><td>Bâtis snappers (×12)</td><td>3 N·m</td></tr>
</table>
```
