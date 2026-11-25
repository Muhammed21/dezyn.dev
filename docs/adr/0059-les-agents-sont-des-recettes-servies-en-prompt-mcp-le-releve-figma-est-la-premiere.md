# 0059 — Les agents sont des recettes servies en prompt MCP ; le relevé Figma est la première

- Statut : Accepté
- Date : 2026-11-25
- Décideurs : Muhammed Cavus
- Amende : ADR 0002 (§1 et §2, dezyn sert aussi des recettes en prompt MCP : des modèles que l'IA du client choisit de suivre, qui ne la contrôlent pas), ADR 0013 (§1, une IA peut tenir plusieurs lots ouverts dans un projet, chacun désigné par son identifiant ; §2, une écriture sans identifiant garde le comportement actuel)

## Contexte et problématique

Une équipe qui garde Figma comme outil de travail voit ses variables changer chaque semaine. Pour que dezyn reste la source de vérité (ADR 0001), quelqu'un doit demander à son IA de relire Figma et de reporter les écarts (ADR 0003 §4). Personne n'y pense régulièrement : les écarts s'accumulent, et l'état Figma des tokens vieillit sans que personne le voie (ADR 0024, négatives).

D'autres tâches répétées suivront le même chemin : une IA du client, lancée à la main ou planifiée, suit une consigne partagée et écrit dans dezyn. Ce sont des agents, côté client.

Obstacles constatés (#398) :

- dezyn ne sait pas quel fichier Figma correspond à un projet ;
- l'accès MCP d'un agent sans humain tombe avec la session web de l'utilisateur (ADR 0060) ;
- aucune consigne partagée ne dit à une IA comment faire un relevé qui donne un lot de propositions propre à relire ;
- deux agents d'un même client sur un même projet se ferment leurs lots et mélangent leurs propositions.

Faits du code :

- dezyn n'exécute aucune IA (ADR 0002 §1) et n'appelle pas Figma (ADR 0003 §1). Le MCP de dezyn expose dix outils et aucun prompt.
- Un lot de propositions est propre à un utilisateur, un client OAuth et un projet. Un index unique partiel (`proposal_batch_open_key`) n'y admet qu'un lot ouvert. `write_tokens` écrit dans le lot ouvert de ce trio, ou en ouvre un automatiquement. `open_proposal_batch` ferme le lot ouvert du trio avant d'en ouvrir un nouveau, et rend déjà l'identifiant du lot ouvert.
- Un lot se ferme après 30 minutes sans écriture (ADR 0013 §7).
- Une écriture identique à la valeur validée ou à la valeur en attente ne crée aucune proposition : `write_tokens` la rend dans `unchanged`. `read_tokens` rend les propositions en attente avec `includeProposals`.
- `declare_figma_states` accepte 500 états au plus par appel.
- L'app n'affiche pas encore l'état Figma : la mitigation « l'interface affiche la date de la déclaration » de l'ADR 0024 n'est pas réalisée.

Constats sur Figma, en novembre 2026 (#398) :

- l'API REST des variables est réservée à Figma Enterprise ;
- `get_variable_defs`, du MCP de Figma, ne lit que la sélection ;
- le MCP distant de Figma se connecte par OAuth dans un navigateur, sans jeton personnel ;
- son outil `use_figma` est en bêta, et deviendra en partie payant.

Problématique : comment dezyn rend-il régulières des tâches d'IA comme le relevé Figma, sans exécuter d'IA ni appeler Figma, et sans que deux agents mélangent leurs lots ?

## Facteurs de décision

- dezyn n'exécute aucune IA et n'appelle pas Figma (ADR 0002 §1, ADR 0003 §1).
- Toute écriture de l'IA est une proposition relue par un éditeur (ADR 0012 §1) ; une perte dans Figma n'efface rien dans dezyn.
- Un éditeur relit le passage d'un agent en un lot, et sait avant de l'ouvrir ce qu'il contient.
- Une semaine sans changement ne laisse rien à relire.
- La recette marche quelle que soit la façon de lire Figma, et quel que soit le plan Figma de l'équipe.
- Ajouter une tâche ne demande pas de changer le serveur MCP.
- Un membre voit si l'état Figma est encore frais.

## Options envisagées

### Qui fait le relevé

#### Option A — dezyn planifie et exécute le relevé

- Avantage : rien à mettre en place côté équipe.
- Inconvénient : dezyn exécuterait une IA ou appellerait Figma, et garderait les accès Figma de l'équipe.
- **Écartée** : contraire aux ADR 0002 §1 et 0003 §1.

#### Option B — Le relevé planifié seulement avec Figma Enterprise

dezyn ne documente que la GitHub Action qui lit Figma par l'API REST des variables.

- Avantage : planification garantie, sans navigateur.
- Inconvénient : réservé aux équipes sous Figma Enterprise.
- **Écartée** : la recette sert toutes les équipes. Hors Enterprise, le relevé se lance à la demande, ou se planifie avec une routine de Claude Code et `use_figma`, tant que l'accès Figma tient.

#### Option C — Inverser le flux par un export DTCG de Figma

L'équipe exporte ses variables Figma en DTCG et les importe dans dezyn.

- Inconvénient : l'import d'un document DTCG est déjà décidé par l'ADR 0041 ; il écrit des tokens validés, sans état Figma ni relecture d'un lot.
- **Écartée** : déjà couverte par l'ADR 0041.

#### Option D — L'IA du client suit une recette servie en prompt MCP

dezyn sert le prompt `releve_figma`. L'IA du client le suit, lit Figma avec ses propres accès et écrit par les outils MCP.

- Avantage : conforme aux ADR 0002 et 0003 ; une seule recette pour toutes les IA clientes, et le même chemin pour les tâches suivantes.
- Inconvénient : dezyn ne contrôle ni le modèle ni la façon dont il suit la recette.
- **Retenue.**

### Où vit le fichier Figma d'un projet

#### Option E — Dans la configuration de l'agent

- Avantage : rien à stocker dans dezyn.
- Inconvénient : chaque client et chaque routine le redemande ; les membres ne le voient pas sur le projet ; son changement n'entre pas dans l'historique.
- **Écartée.**

#### Option F — Sur le projet, dans dezyn

- Avantage : l'IA le lit avec le projet ; un membre l'ouvre en un clic et voit qui l'a changé.
- Inconvénient : une donnée de plus à valider et à exposer en HTTP et en MCP.
- **Retenue.**

### Ce que dezyn garde d'un relevé

#### Option G — Un objet « relevé » stocké

- Avantage : une liste des relevés, avec leur résultat.
- Inconvénient : un objet de plus à stocker, à exposer et à purger, qui répète l'historique et le lot.
- **Écartée.**

#### Option H — Rien de plus que l'historique, le lot et les états Figma

- Avantage : ce que l'agent a fait se lit déjà dans l'historique (ADR 0021) et dans le lot ; la date du dernier relevé se déduit des déclarations d'état Figma.
- Inconvénient : le compte rendu de l'IA n'est gardé nulle part.
- **Retenue.**

### Le lot d'un passage de recette

#### Option I — Garder un lot ouvert par utilisateur, client et projet

- Avantage : rien à changer.
- Inconvénient : deux agents du même client sur le même projet se ferment leurs lots, et leurs propositions se mélangent.
- **Écartée.**

#### Option J — Un lot désigné par son identifiant

`open_proposal_batch` ouvre un lot pour une recette, et l'agent y écrit en le désignant.

- Avantage : chaque passage a son lot, même avec plusieurs agents du même client.
- Avantage : sans identifiant, le comportement actuel reste.
- Inconvénient : deux façons d'écrire dans un lot, à documenter dans les outils.
- **Retenue.**

## Décision

### 1. Une recette est un prompt MCP servi par dezyn

Une recette a un nom, une description, ses paramètres et ses règles. dezyn la sert en prompt MCP : le serveur déclare la capacité `prompts`. Un agent est une IA du client qui suit une recette. dezyn ne connaît que des recettes, pas d'agents.

Les recettes vivent dans un registre côté MCP. Ajouter une recette, c'est ajouter :

- un fichier de recette au registre ;
- ses tests ;
- ses scénarios d'évaluation ;
- sa page de documentation, sur un modèle commun.

Le serveur MCP ne change pas.

Obtenir une recette pour un projet (`prompts/get` avec ce projet en paramètre) est un appel MCP qui vise un projet : il entre dans l'historique du projet comme un appel d'outil (ADR 0021 §1), au nom de l'utilisateur et du client. Le test de l'ADR 0021 qui parcourt les outils enregistrés parcourt aussi les recettes.

Ce volet amende l'ADR 0002 §1 et §2 : le MCP de dezyn sert aussi des recettes. Une recette proposée par dezyn reste un modèle que le client choisit d'utiliser. Elle ne contrôle pas l'IA du client, qui seule exécute un modèle et décide de ses appels.

### 2. Un passage de recette écrit dans un seul lot, désigné par son identifiant

- `open_proposal_batch` accepte la recette qui ouvre le lot (paramètre facultatif), l'enregistre sur le lot, et rend l'identifiant du lot.
- `write_tokens`, `declare_figma_states` et `close_proposal_batch` acceptent cet identifiant. Une déclaration d'état Figma n'est pas une proposition (ADR 0024 §3) : l'identifiant la rattache au passage dans l'historique.
- Un lot ouvert pour une recette ne ferme pas les autres lots ouverts du même utilisateur, du même client et du même projet, et ils ne le ferment pas. Il se ferme par son identifiant, ou après 30 minutes sans écriture (ADR 0013 §7).
- Sans identifiant, le comportement actuel reste : un seul lot ouvert par utilisateur, client et projet, fermé par l'ouverture du suivant, et un lot automatique quand aucun n'est ouvert.
- Un identifiant inconnu, d'un lot fermé, ou d'un lot d'un autre utilisateur, d'un autre client ou d'un autre projet que l'appel est refusé par une erreur. Rien n'est écrit, et aucun lot n'est ouvert à sa place.

Chaque recette suit la règle : un passage, un lot, désigné par son identifiant.

Ce volet amende l'ADR 0013 §1 et §2 : une IA peut tenir plusieurs lots ouverts dans un projet, chacun désigné par son identifiant.

### 3. Une évaluation commune fait suivre chaque recette à une vraie IA

`pnpm eval` lance les scénarios de chaque recette. Une vraie IA reçoit la recette, connectée au MCP de dezyn en local avec un vrai jeton OAuth, et à de faux serveurs MCP (un faux Figma pour le relevé). Les vérifications portent sur la base, jamais sur le texte de l'IA. Les faux serveurs et les vérifications en base servent à toutes les recettes.

Chaque scénario tourne 3 fois, et les 3 passages doivent réussir. L'évaluation tourne à la demande en local, et en CI seulement par déclenchement manuel. Elle demande une clé d'API Anthropic, rangée en secret.

### 4. Un projet a au plus un fichier Figma

Le fichier Figma d'un projet est un lien vers un fichier Figma, avec la clé extraite du lien. Un projet en a au plus un.

- Tout membre le renseigne, le modifie ou le retire, comme le nom du projet : depuis les réglages du projet dans l'app, par l'API HTTP, ou par l'outil MCP `set_project_figma_file`.
- Un lien qui n'est pas un fichier Figma est refusé par une erreur de validation.
- La lecture du projet rend le lien et la clé, en HTTP et en MCP.
- Chaque changement entre dans l'historique du projet (ADR 0021 §1).

### 5. Le relevé Figma est la première recette

La recette `releve_figma` prend le projet en paramètre. Un projet inconnu, ou que l'utilisateur ne voit pas, est refusé. Elle rend ses règles avec le lien du fichier Figma du projet. Sans fichier Figma, elle demande le lien à l'utilisateur, puis l'enregistre par `set_project_figma_file`.

Elle ne dépend pas de la façon de lire Figma : `use_figma` du MCP distant de Figma, API REST des variables chez Enterprise, ou tout autre moyen de l'IA cliente. `get_variable_defs` ne suffit pas.

Ses règles :

1. Un relevé compare un seul fichier Figma : celui du projet.
2. Une variable Figma correspond au token de même nom.
3. La comparaison porte sur les modes que le projet connaît.
4. L'IA déclare l'état Figma de chaque token comparé, même sans changement (`declare_figma_states`, 500 états au plus par appel).
5. Une variable absente de dezyn devient une proposition de création (`write_tokens`).
6. Une valeur divergente devient une proposition (ADR 0024 §4).
7. Un token absent de Figma reçoit l'état absent de Figma. Il n'est jamais proposé à la suppression.
8. Un mode présent seulement dans Figma n'est ni proposé ni créé. L'IA le signale dans son compte rendu.
9. Un relevé ouvre un lot de propositions (`open_proposal_batch`, recette `releve_figma`) seulement s'il crée au moins une proposition. Toutes les propositions du relevé vont dans ce seul lot, désigné par son identifiant (§2).
10. L'intention du lot est « Relevé Figma du <date> : <N> nouveaux tokens, <M> valeurs changées ». Une partie à zéro est omise.
11. N et M ne comptent que les propositions créées par ce relevé. Une proposition encore en attente depuis un relevé précédent n'est ni recopiée ni comptée.
12. Un token créé par un relevé n'a pas d'état Figma tant qu'il n'est pas validé. Le relevé suivant le déclare synchronisé.
13. Le relevé se termine par un compte rendu à l'utilisateur. dezyn ne le stocke pas.

### 6. dezyn ne stocke pas de relevé

Aucun objet « relevé » n'existe dans dezyn. Ce que l'agent a fait se lit dans l'historique et dans le lot, au nom de l'utilisateur et du client qui ont écrit (ADR 0004).

La lecture du projet rend la date du dernier relevé Figma : la plus récente déclaration d'état Figma d'un token du projet. Elle est absente tant qu'aucun token n'a été comparé.

La page du projet affiche « Dernier relevé Figma : il y a N jours », avec le lien du fichier Figma.

- Au-delà de 14 jours, l'indice est mis en avant.
- Sans relevé, aucun indice.

Ce volet réalise, au niveau du projet, la mitigation de l'ADR 0024 contre un état Figma périmé qui passe pour actuel. L'état Figma de chaque token dans l'app reste à faire.

### 7. Les recettes se planifient hors de dezyn

Une recette se lance à la demande depuis toute IA cliente. La documentation du relevé montre deux façons de le planifier, par exemple chaque lundi :

- une routine de Claude Code, qui lit Figma par `use_figma` ;
- une GitHub Action, qui lit Figma par l'API REST des variables, pour Figma Enterprise.

Elle dit ce qui est garanti et ce qui ne l'est pas, selon le résultat du spike de #398. L'accès MCP à dezyn tient sans humain jusqu'à 180 jours (ADR 0060).

### 8. Hors périmètre

- Un tableau de bord des agents.
- Un indice « dernier passage » par recette. La recette enregistrée sur le lot le permettra plus tard.

## Conséquences

### Positives

- dezyn reste sans IA embarquée et sans client Figma (ADR 0002, ADR 0003).
- Une nouvelle tâche d'agent s'ajoute par une recette, sans changer le serveur MCP.
- Deux agents du même client sur un même projet ont chacun leur lot.
- Un éditeur relit un relevé en un lot, et l'intention lui dit combien de tokens sont nouveaux et combien de valeurs ont changé.
- Une semaine sans changement n'ouvre aucun lot.
- Une perte dans Figma n'efface rien dans dezyn.
- Un membre voit quand le dernier relevé a eu lieu, et remarque un relevé planifié qui s'est arrêté.

### Négatives

- La qualité d'un passage dépend de l'IA du client : dezyn sert la recette, il ne vérifie pas qu'elle est suivie.
- Deux façons d'écrire dans un lot coexistent : désigné par son identifiant, ou implicite.
- Un token renommé dans Figma ressort comme un nouveau token et un token absent de Figma : la correspondance se fait par nom.
- Un mode ajouté dans Figma n'arrive dans dezyn que par une décision humaine.
- Hors Figma Enterprise, la planification du relevé dépend de `use_figma`, en bêta, et d'un accès Figma qui peut demander un navigateur.
- Le compte rendu de l'IA n'est gardé nulle part.
- Chaque recette ajoute des scénarios d'évaluation, qui coûtent des appels à l'API Anthropic.

### Risques et mitigations

- **L'IA ne suit pas la recette** (lot vide, suppression proposée, intention fausse) : toute écriture reste une proposition relue par un éditeur (ADR 0012) ; `pnpm eval` vérifie en base le lot, l'intention, les propositions et les états Figma.
- **Les chiffres de l'intention ne correspondent pas au lot** : l'intention se déclare à l'ouverture du lot, avant l'écriture. Une valeur de Figma identique à la dernière valeur rejetée ne crée aucune proposition (ADR 0024 §4). La recette compte les écarts sur les tokens validés et les propositions en attente (`read_tokens` avec `includeProposals`), et l'évaluation vérifie les chiffres.
- **Un agent écrit sans identifiant** et retombe dans le lot implicite : la recette impose l'identifiant, et l'évaluation vérifie que toutes les propositions du passage sont dans son lot.
- **Un relevé planifié s'arrête sans bruit** : l'indice est mis en avant au-delà de 14 jours.
- **Un membre change le fichier Figma** et le relevé suivant compare un autre fichier : le changement entre dans l'historique.
- **`use_figma` change ou devient payant** : la recette ne dépend pas de la façon de lire Figma ; seule la documentation de la planification change.

## Notes d'implémentation

Tickets de #398, dans l'ordre :

1. L'accès MCP vit avec la chaîne de refresh tokens (ADR 0060). Indépendant.
2. Le fichier Figma du projet. Indépendant.
3. Le registre des recettes, les lots désignés et la recette `releve_figma`, avec un scénario joué par un faux client et l'évaluation avec une vraie IA. Bloqué par le ticket 2.
4. L'indice « Dernier relevé Figma » dans l'app. Bloqué par le ticket 2.
5. La documentation du relevé et de sa planification. Bloquée par les tickets 1 et 3 et par le spike.

L'index unique partiel `proposal_batch_open_key` ne vaut plus que pour le lot implicite d'un utilisateur, d'un client et d'un projet.

Le spike tourne en parallèle, sur le compte Figma du mainteneur : une routine planifiée de Claude Code fait le relevé deux lundis de suite avec `use_figma`. Il répond à deux questions : l'accès Figma tient-il sans humain, et `use_figma` lit-il toutes les collections, modes, valeurs et alias ? S'il échoue, seule la documentation change : planification garantie avec Figma Enterprise, sinon relevé à la demande, avec l'indice des 14 jours comme rappel.

## Liens

- [ADR 0001](0001-plateforme-centrale-de-design-plutot-que-pont-figma-code.md) — dezyn fait foi.
- [ADR 0002](0002-ia-du-client-via-mcp-sans-ia-embarquee.md) — aucune IA côté dezyn ; amendé pour les recettes.
- [ADR 0003](0003-import-export-orchestres-par-les-mcp-du-client.md) — l'IA lit Figma, dezyn ne l'appelle pas.
- [ADR 0004](0004-historique-unique-des-actions-de-l-ia-et-des-humains.md) — l'historique nomme l'utilisateur et le client.
- [ADR 0012](0012-les-ecritures-de-l-ia-sont-des-propositions-relues-par-un-editeur.md) — les écritures de l'IA sont des propositions.
- [ADR 0013](0013-lots-de-propositions-declares-par-l-ia-propositions-remplacees-et-ecritures-identiques.md) — le lot, son intention, l'écriture identique ; amendé pour les lots désignés.
- [ADR 0021](0021-seuls-les-appels-mcp-qui-visent-un-espace-ou-un-projet-entrent-dans-l-historique.md) — le changement du fichier Figma et l'obtention d'une recette pour un projet entrent dans l'historique.
- [ADR 0024](0024-l-etat-figma-d-un-token-est-declare-par-l-ia-du-client.md) — l'état Figma, la valeur divergente, la date affichée.
- [ADR 0041](0041-un-membre-importe-un-document-dtcg-ou-resolver-en-tokens-valides-sans-rien-perdre-ni-remplacer.md) — l'import DTCG, option écartée ici.
- [ADR 0060](0060-l-acces-mcp-vit-avec-la-chaine-de-refresh-tokens-separe-de-la-session-web.md) — l'accès MCP qui tient sans humain.
