<script setup>
// Aide de l'éditeur de template : panneau latéral, ouvert par le « ? ».
import { onMounted, onBeforeUnmount, ref } from 'vue'
import NavIcon from './NavIcon.vue'
import { FIELD_KINDS, LAYOUT_KINDS } from '../lib/templateEditor.js'

const emit = defineEmits(['close'])
const closeBtn = ref(null)
const onKey = (e) => { if (e.key === 'Escape') emit('close') }
onMounted(() => { window.addEventListener('keydown', onKey); closeBtn.value && closeBtn.value.focus() })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="hp" @click.self="emit('close')">
      <aside class="hp__panel" role="dialog" aria-modal="true" aria-labelledby="hp-title">
        <header class="hp__head">
          <h2 id="hp-title" class="hp__title"><NavIcon name="help" :size="22" /> Aide : préparer un template</h2>
          <button ref="closeBtn" type="button" class="hp__close" aria-label="Fermer l’aide" @click="emit('close')"><NavIcon name="close" :size="22" /></button>
        </header>

        <details open class="hp__sec">
          <summary>Comment ça marche</summary>
          <ol>
            <li>Tapez la référence d’une mission déjà créée (par exemple <strong>FI-252</strong>) et ouvrez-la : son template s’affiche, bloc par bloc. Si la page est vide, vous partez de zéro.</li>
            <li>Ajoutez des éléments avec le menu de droite, écrivez-les, déplacez-les avec les flèches.</li>
            <li><strong>Enregistrer dans Notion</strong> : la page de la mission est mise à jour. Les techniciens voient le changement en appuyant sur « Actualiser » dans la fiche.</li>
          </ol>
          <p>Seul ce qui change est modifié dans Notion. Les saisies déjà faites par les techniciens ne sont jamais touchées.</p>
        </details>

        <details class="hp__sec">
          <summary>Les éléments disponibles</summary>
          <h3>Mise en page</h3>
          <ul class="hp__list">
            <li v-for="k in LAYOUT_KINDS" :key="k.id"><NavIcon :name="k.icon" :size="18" /><span><strong>{{ k.label }}</strong> : {{ k.help }}</span></li>
          </ul>
          <h3>Champs à remplir</h3>
          <ul class="hp__list">
            <li v-for="k in FIELD_KINDS" :key="k.type"><NavIcon :name="k.icon" :size="18" /><span><strong>{{ k.label }}</strong> : {{ k.help }}</span></li>
          </ul>
        </details>

        <details class="hp__sec">
          <summary>Bien régler un champ</summary>
          <ul>
            <li><strong>Libellé</strong> : ce que le technicien lit. Soyez précis (« Pression mesurée » plutôt que « Pression »).</li>
            <li><strong>Obligatoire</strong> : le technicien ne pourra valider son compte rendu qu’une fois ce champ rempli.</li>
            <li><strong>Choix</strong> : un choix par ligne, de 2 à 20.</li>
            <li><strong>Identifiant</strong> : nom interne du champ, créé tout seul à partir du libellé. Une fois le champ enregistré, il ne change plus, pour ne pas perdre les saisies déjà faites. Pour renommer le champ, changez seulement son libellé.</li>
            <li>Pour <strong>remplacer</strong> un champ par un autre, supprimez l’ancien et créez le nouveau.</li>
          </ul>
        </details>

        <details class="hp__sec">
          <summary>Images, vidéos, PDF et tableaux</summary>
          <p>Ils se placent directement dans la page Notion. Ici ils apparaissent comme des <strong>blocs verrouillés</strong> : vous pouvez les déplacer ou les supprimer, pas les modifier.</p>
          <p>Les consignes déjà mises en forme dans Notion (gras, couleurs…) gardent leur mise en forme tant que vous ne changez pas leur texte.</p>
        </details>

        <details class="hp__sec">
          <summary>Reprendre un template existant</summary>
          <p>Le bouton <strong>Reprendre</strong> va chercher le template d’une autre mission. Vous choisissez de l’<strong>ajouter à la suite</strong> de ce qui est déjà là ou de <strong>tout remplacer</strong>. Les images et fichiers ne sont pas copiés. Rien n’est enregistré tant que vous n’appuyez pas sur « Enregistrer ».</p>
        </details>

        <details class="hp__sec">
          <summary>Passer en mode « Code »</summary>
          <p>Le bouton <strong>Code</strong>, en haut de la page, affiche le même template sous forme de texte. Vous pouvez y écrire, y coller un template, puis revenir à <strong>Sans code</strong> : les deux modes montrent toujours la même chose.</p>
          <pre class="hp__code"># Titre de section (# ## ###)
Un paragraphe de consigne
- Une puce
1. Un numéro
&gt; Une citation
&gt; [!callout] Un encadré
- [ ] Une case à cocher
---   (séparateur)

```json
{ "type": "text", "id": "serie", "label": "N° de série", "required": true }
```
```html
&lt;p&gt;Bloc HTML libre&lt;/p&gt;
```</pre>
          <ul>
            <li>Un bloc <code>json</code> peut contenir un champ ou une liste de champs. Types : {{ FIELD_KINDS.map((k) => k.type).join(', ') }}.</li>
            <li>Une ligne qui commence par deux espaces prolonge le texte au-dessus. Un <code>\</code> en début de ligne affiche le texte tel quel.</li>
            <li>La ligne <code>&lt;!-- 🔒 … --&gt;</code> est une image, un PDF ou un tableau de Notion : laissez-la (ou supprimez-la pour retirer le bloc).</li>
            <li>Les erreurs s’affichent sous le texte, avec le numéro de ligne. Tant qu’il y en a, vous ne pouvez ni enregistrer ni repasser en mode sans code.</li>
            <li>La mise en forme interne d’une consigne (gras, couleurs) n’apparaît pas en code mais reste intacte tant que son texte ne change pas.</li>
          </ul>
        </details>

        <details class="hp__sec">
          <summary>Bon à savoir</summary>
          <ul>
            <li>Si quelqu’un modifie la page dans Notion pendant que vous travaillez, l’enregistrement est refusé : rouvrez la mission puis refaites votre modification.</li>
            <li>Une page sans contenu reçoit un bloc déroulant « Template CR intervention » qui range le formulaire au-dessus du rapport.</li>
            <li>Un bloc supprimé par erreur se retrouve dans la corbeille de Notion.</li>
            <li>Un bloc qui contient des sous-blocs ne peut pas être déplacé d’ici : son texte seul est modifiable.</li>
            <li>Les templates peuvent toujours s’écrire directement dans Notion (voir le dossier <code>docs/templates</code>) : le mode « Code » utilise la même écriture.</li>
          </ul>
        </details>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.hp { position: fixed; inset: 0; z-index: 150; background: rgba(0, 0, 0, .45); display: flex; justify-content: flex-end; }
.hp__panel { width: min(100%, 460px); height: 100%; overflow-y: auto; background: var(--surface); color: var(--text); padding: var(--s-4); box-shadow: -8px 0 24px rgba(0, 0, 0, .25); }
.hp__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-3); }
.hp__title { display: flex; align-items: center; gap: var(--s-2); margin: 0; font-size: 22px; line-height: 1.15; }
.hp__close { display: grid; place-items: center; width: var(--tap); height: var(--tap); flex: none; border: 0; border-radius: var(--radius); background: transparent; color: var(--accent); cursor: pointer; }
.hp__close:hover { background: var(--surface-2); }
.hp__sec { border-top: 1px solid var(--line); padding: var(--s-2) 0; }
.hp__sec summary { min-height: 40px; display: flex; align-items: center; font-weight: 600; color: var(--heading); cursor: pointer; }
.hp__sec h3 { margin: var(--s-3) 0 var(--s-1); font-size: 16px; }
.hp__sec p, .hp__sec li { margin: var(--s-2) 0; }
.hp__sec ul, .hp__sec ol { padding-left: 1.2em; }
.hp__list { list-style: none; padding: 0 !important; }
.hp__list li { display: flex; gap: var(--s-2); align-items: flex-start; }
.hp__code { margin: var(--s-2) 0; padding: var(--s-3); overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; }
.hp__list svg { flex: none; margin-top: 2px; color: var(--accent); }
</style>
