# dezyn

Plateforme centrale de design pensée pour l'IA : la source de vérité du design d'un projet, que l'IA du client lit et écrit via MCP, et qu'un humain consulte et valide.

## Language

### Produit

**dezyn** :
La plateforme elle-même, source de vérité du design de ses projets. « La plateforme » est accepté comme synonyme.
_À éviter_ : Muhammed (désigne la personne), outil Figma → code, pont

**Recette** :
Une consigne servie par dezyn en prompt MCP, avec un nom, une description, ses paramètres et ses règles, que l'IA du client choisit de suivre. Un agent est une IA du client qui suit une recette ; dezyn ne connaît que les recettes. Chaque passage d'une recette écrit dans un seul lot de propositions, désigné par son identifiant.
_À éviter_ : agent (pour la recette), workflow, skill, automatisation

### Organisation

**Espace** :
Ce qui possède des projets et porte un plan, Free ou Team. Un utilisateur seul a un espace personnel.
_À éviter_ : compte, organisation, workspace, équipe

**Membre** :
Un utilisateur qui appartient à un espace et travaille sur ses projets, avec le rôle de propriétaire ou d'éditeur.
_À éviter_ : collaborateur, utilisateur (quand on parle de son rôle dans un espace)

**Propriétaire** :
Un membre qui gère le plan et les membres d'un espace, et crée ses projets ; il peut aussi tout ce que peut un éditeur. Un espace a toujours au moins un propriétaire.
_À éviter_ : admin, owner

**Éditeur** :
Le membre qui modifie les projets d'un espace et valide ou rejette les données proposées.
_À éviter_ : contributeur, designer (comme rôle)

**Abonnement** :
Ce qui fait passer un espace au plan Team : souscrit chez Polar pour un seul espace, avec un payeur, un statut (actif, résilié en fin de période, en retard de paiement, terminé) et la date de fin de sa période. L'espace est Team tant que son abonnement n'est pas terminé.
_À éviter_ : licence, souscription (pour l'objet), forfait, plan (pour l'abonnement lui-même)

**Payeur** :
L'utilisateur qui paie l'abonnement d'un espace, client de Polar ; c'est un propriétaire de l'espace quand il souscrit. Lui seul ouvre le portail client de Polar pour cet espace ; les autres propriétaires voient qui paie. Un utilisateur peut payer plusieurs espaces, chacun par son propre abonnement. Quand le payeur quitte l'espace, qu'un autre propriétaire l'en retire ou le rend éditeur, l'abonnement est résilié en fin de période et les autres propriétaires sont prévenus ; ils souscrivent à nouveau après la date de fin.
_À éviter_ : client, acheteur, titulaire, owner

**Espace gelé** :
Un espace dont l'abonnement est terminé et qui dépasse au moins une limite Free (projets, stockage ou membres). Rien n'y est supprimé ; ses éditeurs sont suspendus, son propriétaire continue de travailler, et son stockage reste borné à celui de la fin de l'abonnement. Un espace Free qui n'a jamais payé ne gèle pas. Le gel se lève seul quand l'espace repasse Team ou revient sous les limites Free.
_À éviter_ : espace suspendu, bloqué, archivé, verrouillé

**Projet** :
Un design system complet (tokens, composants, décisions) qui appartient à un espace ; c'est l'unité que comptent les plans.
_À éviter_ : DA, direction artistique, design system (pour désigner le conteneur)

### Design

**Token** :
Une valeur de design nommée d'un projet : couleur, typographie, dimension, effet ou animation.
_À éviter_ : variable, style

**Mode** :
Une des valeurs d'un modificateur, par exemple clair ou sombre ; chaque mode déclare les mêmes tokens. Un membre ajoute un mode à un projet qui en a déjà, en copiant les valeurs d'un mode existant ; l'IA n'en crée jamais.
_À éviter_ : thème, contexte

**Modificateur** :
Un axe qui regroupe des modes, par exemple « apparence » (clair, sombre) ou « marque ».
_À éviter_ : thème, dimension, mode

**Thème** :
La combinaison d'un mode par modificateur, par exemple sombre + Healthcare ; c'est elle que lit l'IA ou que sert un export.
_À éviter_ : mode, palette

**Composant** :
Un élément d'interface d'un projet, stocké en web interactif.
_À éviter_ : widget, bloc, maquette

**Variante** :
Une combinaison nommée de propriétés d'un composant, par exemple un bouton primaire désactivé ; chaque variante a sa propre version validée.
_À éviter_ : état (seul), déclinaison

**Décision** :
Un choix de design accompagné de sa justification, rattaché aux tokens qu'il fixe ; elle et ses tokens sont proposés, validés ou rejetés ensemble, et un token qu'elle fixe ne change que par une nouvelle décision. Exemple : « le corps de texte est en Manrope, pas en Poppins ».
_À éviter_ : changement, entrée d'historique

**Doublon** :
Un token dont la valeur est identique, dans chaque mode, à celle d'un autre token du même projet, extensions mises à part. Un token qui référence un autre token, par sa valeur entière ou par un de ses champs, n'est pas un doublon.
_À éviter_ : copie, duplicata

**Extension** :
Une donnée propre à un outil, rangée dans un token sous une clé d'espace de noms (par exemple `com.figma`), que dezyn conserve et rend sans l'interpréter. Seule la clé `dev.dezyn` est propre à dezyn, qui la valide et l'interprète : elle porte les paires de contraste.
_À éviter_ : métadonnée, propriété personnalisée

**Paire de contraste** :
Un token de couleur au premier plan et le fond sur lequel il se pose, déclarés par le premier plan dans `$extensions["dev.dezyn"].contrastOn`, avec un usage. dezyn calcule le ratio de contraste WCAG de chaque paire déclarée, dans chaque mode ; l'IA du client ne fait que suggérer les paires manquantes.
_À éviter_ : couple de couleurs, combinaison

**Usage** :
Ce que le premier plan d'une paire de contraste est sur son fond, qui fixe le seuil : `text` (texte courant, 4,5:1), `large-text` (texte large, 3:1) ou `ui` (bordure, icône, focus, 3:1). Une paire déclarée sans usage est un `text`.
_À éviter_ : rôle, type (qui désigne le type d'un token)

### Figma

**État Figma** :
Ce que l'IA du client a constaté, à une date donnée, en comparant un token avec Figma. Un token qu'aucune IA n'a comparé n'a pas d'état Figma.
_À éviter_ : statut (seul), synchro

**Synchronisé** :
État Figma d'un token qui existe dans Figma avec la même valeur dans chaque mode.
_À éviter_ : à jour

**Divergent** :
État Figma d'un token qui existe dans Figma avec une valeur différente dans au moins un mode.
_À éviter_ : désynchronisé, en conflit

**Absent de Figma** :
État Figma d'un token qui n'existe pas dans Figma.
_À éviter_ : manquant, supprimé

**Doublon dans Figma** :
État Figma d'un token auquel correspondent plusieurs variables Figma.
_À éviter_ : doublon (seul), qui désigne un doublon dans dezyn

**Fichier Figma** :
Le fichier Figma qu'un projet compare à ses tokens : un lien vers ce fichier, avec sa clé. Un projet en a au plus un, que tout membre renseigne, modifie ou retire.
_À éviter_ : maquette, source Figma, lien Figma (seul)

**Relevé Figma** :
La première recette, qui fait comparer par l'IA du client le fichier Figma d'un projet à ses tokens. L'IA déclare l'état Figma de chaque token comparé et, seulement s'il y a du nouveau, ouvre un seul lot de propositions. dezyn ne stocke pas de relevé ; la date du dernier relevé est celle de la plus récente déclaration d'état Figma du projet.
_À éviter_ : synchro, import Figma, scan

### Relecture

**Proposition** :
Une création, une modification ou une suppression de donnée de design (token, composant, décision) écrite par l'IA, en attente de relecture ; tant qu'elle attend, la valeur validée qu'elle modifie continue de faire foi.
_À éviter_ : suggestion, brouillon, changement

**Lot de propositions** :
Les propositions qu'écrit l'IA dans un projet, sous l'intention qu'elle déclare ou dans un lot ouvert automatiquement, relues ensemble ; un éditeur peut valider le lot en rejetant certaines propositions. Un lot appartient à un seul projet.
_À éviter_ : import, batch, paquet

**Intention** :
Le but que l'IA déclare en ouvrant un lot de propositions, par exemple « Import du Figma Healthcare » ; il dit à l'éditeur pourquoi le lot existe.
_À éviter_ : description, message, titre

**Proposée** :
Statut d'une proposition qu'aucun éditeur n'a encore relue ; elle ne fait pas foi.
_À éviter_ : brouillon

**Validée** :
Statut d'une proposition acceptée par un éditeur, et de la donnée qu'elle devient ; une donnée écrite directement par un membre est validée d'emblée. Seules les données validées font foi pour le projet. Un snapshot ne se valide pas, il s'accepte.
_À éviter_ : approuvée, publiée

**Rejetée** :
Statut d'une proposition qu'un éditeur a refusée.
_À éviter_ : supprimée, annulée

**Remplacée** :
Statut d'une proposition encore en attente qui a été remplacée par une proposition plus récente de l'IA sur la même donnée, par le retour de l'IA à la valeur validée, ou par l'écriture directe d'un membre ; elle n'est plus à relire.
_À éviter_ : obsolète, annulée

**Historique** :
La chronologie unique de ce que l'IA et les membres ont fait dans un projet, avec l'auteur et la date de chaque action. Chaque projet a son propre historique, supprimé avec lui ; un espace n'en a pas.
_À éviter_ : journal, logs, audit

**Membre supprimé** :
L'auteur pseudonyme et numéroté par espace qui remplace, dans l'historique, un utilisateur ayant supprimé son compte, ainsi que l'IA qu'il avait autorisée.
_À éviter_ : utilisateur anonyme, inconnu, ancien membre

### Régression visuelle

**Rendu** :
L'image d'une variante de composant telle qu'elle est stockée dans dezyn.
_À éviter_ : aperçu, capture

**Snapshot** :
L'image d'une variante de composant codée dans le repo du client, envoyée par sa CI.
_À éviter_ : capture, screenshot

**Référence de conformité** :
Le rendu de la version validée d'une variante, auquel on compare un snapshot pour savoir si le code correspond au design.
_À éviter_ : référence (seul), maquette

**Référence de régression** :
Le dernier snapshot accepté d'une variante, auquel on compare le suivant pour détecter une dérive du code.
_À éviter_ : référence (seul), baseline

**Écart** :
La différence entre un snapshot et l'une de ses deux références. Un écart de régression s'accepte ; un écart de conformité se résout en corrigeant le code ou en modifiant le design.
_À éviter_ : diff, régression (pour un écart de conformité)

**Verdict** :
Le résultat renvoyé à la CI du client pour un snapshot, en conformité comme en régression : conforme, écart, ou sans référence quand la référence n'existe pas encore.
_À éviter_ : statut, résultat de test
