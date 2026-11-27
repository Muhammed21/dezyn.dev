# 0062 — Un membre ajoute un mode à un projet à modes en copiant les valeurs d'un mode existant

- Statut : Accepté
- Date : 2026-11-27
- Décideurs : Muhammed Cavus
- Amende : ADR 0041 (§3 et option C des modes écartée : un projet à modes peut gagner un mode par un geste dédié d'un membre ; l'import reste inchangé), ADR 0059 (§5 règle 8 et négatives : le compte rendu du relevé indique comment ajouter un mode présent seulement dans Figma)

## Contexte et problématique

Une équipe ajoute un mode dans Figma, par exemple un contraste élevé à côté de clair et sombre. Le relevé Figma ne compare que les modes que le projet connaît (ADR 0059 §5 règle 3). Un mode présent seulement dans Figma n'est ni proposé ni créé, et l'IA le signale dans son compte rendu (règle 8). Il n'arrive dans dezyn que par une décision humaine (ADR 0059, négatives), et aucun geste ne permet aujourd'hui de la prendre (#415).

Faits du dépôt :

- Les modes d'un projet ne naissent que par l'import d'un document Resolver dans un projet vide (ADR 0041 §3), qui laisse une entrée `modes.created`. Un projet existant ne change jamais de forme par un import (ADR 0041, option A des modes). Créer ou compléter les modes par l'import est écarté, car les tokens existants devraient recevoir une valeur dans chaque nouveau mode (ADR 0041, option C des modes).
- Chaque mode déclare exactement les mêmes tokens (ADR 0010 §4).
- Une proposition porte une écriture de token (ADR 0012, ADR 0013) ; aucune proposition ne crée de mode.
- L'export d'un projet à modes écrit un contexte par mode dans l'ordre des modes, et `default` désigne le premier (ADR 0039 §3).
- dezyn ne stocke pas le compte rendu d'un relevé (ADR 0059 §5 règle 13, §6) : il ne garde aucune trace des modes vus seulement dans Figma.
- Les rôles d'un espace sont propriétaire et éditeur.

Problématique : comment un mode présent seulement dans Figma entre-t-il dans un projet qui a déjà des modes, avec quelles valeurs, sans que l'IA crée de mode ?

## Facteurs de décision

- Chaque mode déclare les mêmes tokens (ADR 0010 §4) : le nouveau mode naît complet.
- Ce qu'écrit un membre est validé directement ; ce qu'écrit l'IA est une proposition sur un token (ADR 0012, ADR 0013). Le modèle des propositions ne change pas.
- Le membre n'a pas à saisir une valeur par token : le relevé suivant reporte les valeurs de Figma.
- L'export d'un projet existant ne change pas de mode par défaut (ADR 0039 §3).
- Aucune proposition en attente ne se retrouve sans valeur pour un mode.

## Options envisagées

### Qui crée le mode

#### Option A — Un membre, par une écriture directe validée d'emblée

- Avantage : comme la création des modes par l'import (ADR 0041) ; le modèle des propositions ne change pas.
- Inconvénient : le membre doit agir après le relevé, et saisir le nom du mode.
- **Retenue.**

#### Option B — L'IA propose le mode, un éditeur le valide

- Avantage : le relevé apporte le mode sans geste à part.
- Inconvénient : il faudrait étendre les propositions à autre chose qu'un token.
- **Écartée.**

#### Option C — Garder le refus de l'ADR 0041

- Inconvénient : un mode présent seulement dans Figma n'arrive jamais dans dezyn.
- **Écartée.**

### Les valeurs du nouveau mode

#### Option D — Copier les valeurs d'un mode existant choisi par le membre

Chaque token validé reçoit dans le nouveau mode la valeur ou l'alias du mode choisi, références de champ comprises. Au relevé suivant, le nouveau mode est un mode connu : l'IA le compare à Figma et propose la valeur Figma de chaque token qui diverge.

- Avantage : le mode naît complet (ADR 0010 §4) ; les valeurs de Figma arrivent par la relecture habituelle.
- Inconvénient : jusqu'à la relecture, le nouveau mode porte les valeurs d'un autre.
- **Retenue.**

#### Option E — Le membre saisit toutes les valeurs du nouveau mode

- Inconvénient : une saisie par token, que le relevé suivant fait déjà.
- **Écartée.**

#### Option F — Des valeurs vides, ou copiées sans choix du mode source

- Inconvénient : des valeurs vides contredisent l'ADR 0010 §4 ; une copie d'un mode imposé peut partir du mode le plus éloigné du nouveau.
- **Écartée.**

## Décision

### 1. Un membre ajoute un mode à un projet qui a déjà des modes

Un propriétaire ou un éditeur ajoute un mode à un projet à modes, depuis la page du projet. Il saisit le nom du mode. L'écriture est directe et validée d'emblée, comme la création des modes par l'import (ADR 0041 §3).

L'IA ne crée jamais de mode : aucun outil MCP ne l'ajoute, et le modèle des propositions (ADR 0012, ADR 0013) ne change pas.

Ce volet amende l'ADR 0041 : un projet existant peut gagner un mode, par ce geste dédié, et non par un import. L'option C des modes de l'ADR 0041 reste écartée pour l'import ; la copie d'un mode existant répond ici à son inconvénient.

### 2. Le nouveau mode copie les valeurs d'un mode existant

Le membre choisit un mode existant à copier. Chaque token validé reçoit dans le nouveau mode la valeur ou l'alias qu'il a dans ce mode, références de champ comprises. Le projet garde ainsi les mêmes tokens dans chaque mode (ADR 0010 §4).

Au relevé Figma suivant, le nouveau mode est un mode connu (ADR 0059 §5 règle 3) : l'IA le compare à Figma et propose la valeur Figma de chaque token qui diverge.

### 3. Une proposition en attente refuse l'ajout

Tant que le projet a une proposition en attente, l'ajout est refusé, comme l'import (ADR 0041 §3) : la proposition n'aurait pas de valeur pour le nouveau mode. Le refus répond 400, comme l'import, avec un message qui renvoie à la relecture des lots en attente.

### 4. Le nouveau mode s'ajoute en dernier

Le nouveau mode prend la dernière place dans l'ordre des modes. Il ne devient jamais le `default` de l'export (ADR 0039 §3).

### 5. Un projet sans modes est refusé

L'ajout d'un mode à un projet sans modes est refusé par une erreur explicite (400) : il faudrait créer le modificateur et rattacher les valeurs sans mode.

### 6. Qui ajoute, et quel nom

L'ajout est une nouvelle action `mode.create`, permise au propriétaire et à l'éditeur, comme `token.create`. Le nom du mode est non vide (400) et unique parmi les modes du projet (409). Le mode à copier est un mode du projet (400).

### 7. Le relevé indique comment ajouter un mode présent seulement dans Figma

dezyn ne garde aucune trace des modes vus seulement dans Figma (ADR 0059 §6). La recette `releve_figma` indique, pour un tel mode, qu'un membre l'ajoute depuis la page du projet.

Ce volet précise l'ADR 0059 §5 règle 8 : le mode reste ni proposé ni créé par l'IA, et le compte rendu dit comment l'ajouter. Il précise aussi sa conséquence négative : la décision humaine est ce geste.

### 8. L'ajout entre dans l'historique et dans le stockage

L'ajout laisse une entrée de la nouvelle action `mode.added`, au nom du membre, sur le modèle de `modes.created` (ADR 0041 §3) : sans état avant, et `{ mode, copiedFrom }` après. Les valeurs copiées ne laissent pas d'entrée par token. Les valeurs écrites comptent dans le stockage du projet (ADR 0032).

### 9. Hors périmètre

- Réordonner les modes.
- Ajouter un mode à un projet sans modes.
- Modifier l'import : il crée les modes d'un projet vide et exige les mêmes modes ailleurs (ADR 0041 §3).

## Conséquences

### Positives

- Un mode ajouté dans Figma peut entrer dans dezyn, sur décision d'un membre.
- Le nouveau mode naît complet, et ses valeurs Figma arrivent par la relecture habituelle d'un lot.
- Le modèle des propositions et l'import ne changent pas.
- L'export d'un projet existant garde son mode par défaut.

### Négatives

- Jusqu'à la relecture du relevé suivant, le nouveau mode porte les valeurs du mode copié, et un export entre-temps les sert telles quelles.
- Le membre saisit le nom du mode : dezyn ne le reprend pas du compte rendu, qui n'est pas stocké.
- Les propositions en attente doivent être relues avant l'ajout.
- Un projet sans modes ne gagne pas de mode, et l'ordre des modes ne se change pas.

### Risques et mitigations

- **Le nom saisi ne correspond pas au mode Figma** : le relevé suivant ne compare pas le nouveau mode et signale de nouveau le mode Figma ; un mode Figma correspond au mode du projet de même nom : la comparaison porte sur les modes que le projet connaît (ADR 0059 §5 règle 3).
- **Le relevé suivant ouvre un gros lot** pour le nouveau mode : un token dont la valeur Figma égale la valeur copiée ne crée aucune proposition (écriture identique, ADR 0013).
- **Une proposition s'écrit pendant l'ajout** : la vérification des propositions en attente et l'écriture des valeurs se font dans la même transaction.

## Notes d'implémentation

1. Le domaine : ajout d'un mode à un projet à modes, copie des valeurs et des alias du mode choisi, références de champ comprises, refus d'un projet sans modes et d'un projet qui a des propositions en attente.
2. La route HTTP, l'entrée `mode.added` dans l'historique et le stockage compté.
3. Le geste sur la page du projet.
4. La recette `releve_figma` : l'indication pour un mode présent seulement dans Figma, et son scénario d'évaluation (ADR 0059 §3).

## Liens

- [ADR 0010](0010-tokens-au-format-dtcg-modes-par-le-resolver.md) — chaque mode déclare les mêmes tokens (§4).
- [ADR 0012](0012-les-ecritures-de-l-ia-sont-des-propositions-relues-par-un-editeur.md) — les écritures de l'IA sont des propositions ; celles d'un membre sont validées.
- [ADR 0013](0013-lots-de-propositions-declares-par-l-ia-propositions-remplacees-et-ecritures-identiques.md) — le modèle des propositions, inchangé ; l'écriture identique.
- [ADR 0032](0032-le-stockage-d-un-projet-se-compte-par-un-compteur-d-octets-tenu-a-chaque-ecriture.md) — les valeurs écrites comptent dans le stockage.
- [ADR 0039](0039-l-export-dtcg-imbrique-les-tokens-valides-et-decrit-les-modes-par-un-document-resolver.md) — l'ordre des modes et le `default` de l'export (§3).
- [ADR 0041](0041-un-membre-importe-un-document-dtcg-ou-resolver-en-tokens-valides-sans-rien-perdre-ni-remplacer.md) — la création des modes par l'import ; amendé.
- [ADR 0059](0059-les-agents-sont-des-recettes-servies-en-prompt-mcp-le-releve-figma-est-la-premiere.md) — le relevé Figma et ses modes connus ; §5 règle 8 précisée.
