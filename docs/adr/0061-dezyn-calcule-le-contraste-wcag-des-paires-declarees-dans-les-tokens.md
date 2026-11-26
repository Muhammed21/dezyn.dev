# 0061 — dezyn calcule le contraste WCAG des paires déclarées dans les tokens

- Statut : Accepté
- Date : 2026-11-26
- Décideurs : Muhammed Cavus
- Amende : ADR 0030 (§1 et §2, la clé `dev.dezyn` d'`$extensions` est propre à dezyn, qui la valide et l'interprète ; les autres clés restent conservées sans être interprétées), ADR 0026 (§2, un token cité dans un `contrastOn` est une référence qui bloque sa suppression)

## Contexte et problématique

Le bilan de santé du design system (#408) serait la deuxième recette servie en prompt MCP (ADR 0059 §1). L'un de ses contrôles est le contraste des couleurs : un texte sur son fond, une bordure ou une icône sur la surface qui la porte.

Le contraste se mesure sur une paire de couleurs. Rien, dans un projet dezyn, ne dit aujourd'hui quelles couleurs se superposent : un token de couleur porte une valeur par mode, pas l'usage qu'on en fait.

Faits du code et des ADR :

- dezyn n'exécute aucune IA (ADR 0002 §1). Toute écriture de l'IA est une proposition relue par un éditeur (ADR 0012 §1).
- Un token peut porter `$extensions`, dont dezyn conserve les clés sans les interpréter (ADR 0030 §2).
- Les extensions comptent pour l'écriture identique (ADR 0030 §4) : une écriture qui ne change que les extensions crée une proposition.
- La suppression d'un token encore référencé par un alias ou par une décision validée est refusée (ADR 0026 §2).
- Une couleur de dezyn est en `srgb`, seul espace accepté par le schéma d'un token ; son `alpha` est facultatif.
- Un appel MCP qui vise un projet entre dans l'historique du projet (ADR 0021 §1).
- Chaque mode déclare les mêmes tokens, avec une valeur par mode (ADR 0010).

Problématique : où vivent les paires de couleurs dont le contraste se contrôle, et qui calcule ce contraste ?

## Facteurs de décision

- Le résultat est fiable et reproductible : le même projet donne le même verdict à chaque passage.
- Une paire oubliée ne disparaît pas du contrôle sans que personne le voie.
- dezyn n'exécute aucune IA (ADR 0002 §1) ; ce qu'écrit l'IA du client passe par la relecture (ADR 0012 §1).
- Le coût : pas d'écran, de table ni de flux de validation de plus quand un mécanisme existant suffit.
- Les extensions écrites par les autres outils restent conservées (ADR 0030).
- Le contraste se contrôle dans chaque mode (ADR 0010).

## Options envisagées

### Option A — L'IA déduit les paires des noms des tokens à chaque passage

- Avantage : rien à déclarer ni à stocker.
- Inconvénient : peu fiable ; deux passages peuvent déduire des paires différentes, le résultat n'est pas reproductible.
- Inconvénient : une paire que l'IA ne déduit pas sort du contrôle sans que personne le voie.
- **Écartée.**

### Option B — Un écran et une table « paires de contraste »

- Avantage : les paires sont une donnée explicite de dezyn.
- Inconvénient : le coût d'un écran, d'une table et d'un flux de validation à part, à côté de celui des tokens.
- **Écartée.**

### Option C — Les paires se déclarent sur le token de couleur, sous `$extensions["dev.dezyn"].contrastOn`

- Avantage : les paires sont une donnée du projet, stockée avec le token ; le calcul est reproductible.
- Avantage : déclarer ou changer une paire est une écriture de token : elle passe par la relecture des propositions (ADR 0030 §4, ADR 0012), sans flux à part.
- Inconvénient : dezyn interprète une clé d'`$extensions`, ce que l'ADR 0030 §2 excluait ; il faut l'amender pour cette seule clé.
- **Retenue.**

## Décision

### 1. Une paire de contraste se déclare sur un token de couleur

Un token de couleur déclare les fonds sur lesquels il se pose dans `$extensions["dev.dezyn"].contrastOn`, une liste d'entrées. Chaque entrée est :

- une chaîne `"{couleur.fond}"`, qui référence le fond avec l'usage `text` ;
- ou un objet `{ "on": "{couleur.fond}", "usage": "text" | "large-text" | "ui" }`.

Le token qui déclare est le premier plan ; le token cité par `on` est le fond. L'usage fixe le seuil (§4).

```json
{
  "$type": "color",
  "$value": { "colorSpace": "srgb", "components": [0.1, 0.1, 0.1] },
  "$extensions": {
    "dev.dezyn": {
      "contrastOn": ["{couleur.fond}", { "on": "{couleur.surface}", "usage": "ui" }]
    }
  }
}
```

### 2. dezyn valide la clé `dev.dezyn` à l'écriture

À chaque écriture d'un token, dezyn refuse par une erreur de validation :

- un `contrastOn` sur un token qui n'est pas une couleur ;
- une entrée qui ne référence pas une couleur du projet, existante ou créée dans la même écriture (le même lot, ou le même import) ;
- une entrée qui référence le token lui-même ;
- deux entrées qui citent le même fond ;
- un usage autre que `text`, `large-text` ou `ui` ;
- toute autre clé sous `dev.dezyn` tant qu'elle n'est pas définie.

Les autres clés d'`$extensions` restent conservées sans être interprétées (ADR 0030 §2).

Jusqu'ici, le contenu de `dev.dezyn` était libre (ADR 0030 §1) : un token déjà stocké pourrait y porter une autre clé, et sa prochaine écriture serait refusée. Avant la mise en production de ces règles, un contrôle en lecture seule de la production (ADR 0057) vérifie qu'aucun token stocké ne porte `dev.dezyn`. S'il en trouve, une migration retire cette clé avant le déploiement.

Ce volet amende l'ADR 0030 §1 et §2 pour la seule clé `dev.dezyn` : son contenu n'est plus libre, et dezyn l'interprète.

### 3. Un token cité dans un `contrastOn` ne se supprime pas

La suppression d'un token cité dans un `contrastOn` d'un autre token est refusée tant que la paire existe, comme pour un alias (ADR 0026 §2) : le message nomme les tokens qui le citent. L'IA propose d'abord, dans le même lot, de retirer la paire ; un membre la retire d'abord.

Ce volet complète l'ADR 0026 §2 : un `contrastOn` est une référence, au même titre qu'un alias ou qu'une décision validée.

### 4. L'outil MCP `check_contrast` calcule toutes les paires déclarées, mode par mode

`check_contrast(projectId)` est un outil MCP en lecture. Il calcule de façon déterministe toutes les paires déclarées du projet, dans chaque mode :

- le ratio de contraste de WCAG 2.x, calculé à partir de la luminance relative des deux couleurs ;
- le seuil de l'usage : 4,5:1 pour `text`, 3:1 pour `large-text` et `ui` ;
- le verdict de la paire dans ce mode : `pass`, `fail` ou `indeterminate`, ce dernier avec sa raison.

Un premier plan dont l'alpha est inférieur à 1 est composé sur son fond avant le calcul. Un fond dont l'alpha est inférieur à 1 donne le verdict « indéterminé », avec la raison : la couleur sous ce fond n'est pas connue.

Seules les couleurs `srgb` existent dans dezyn : le calcul ne fait aucune conversion d'espace de couleur.

L'appel entre dans l'historique du projet (ADR 0021 §1).

### 5. dezyn calcule, l'IA du client suggère

Le calcul du contraste est fait par dezyn, jamais par l'IA du client. L'IA ne fait que suggérer les paires manquantes, par des propositions qu'un humain valide (ADR 0012). Elle déduit l'usage du nom du token : `text` pour un texte, `ui` pour une bordure, une icône ou un focus. Elle ne propose jamais `large-text`.

Ce partage suit l'ADR 0002 : dezyn n'exécute aucune IA, et l'IA du client décide de ses appels.

### 6. Le bilan de santé est le premier consommateur

La recette `bilan_sante` (#408) est la première à appeler `check_contrast`. Elle suit l'ADR 0059 sans l'amender : un fichier de recette, ses tests, ses scénarios d'évaluation et sa page de documentation.

### 7. Hors périmètre

- Un équivalent HTTP de `check_contrast`, pour l'instant.
- Le niveau AAA de WCAG.

## Conséquences

### Positives

- Le contrôle du contraste est reproductible : il porte sur les paires déclarées, et dezyn les calcule de la même façon à chaque appel.
- Les paires sont une donnée du projet, relue comme toute écriture de token, sans écran ni table de plus.
- Chaque mode est contrôlé, et une paire qui passe en clair mais échoue en sombre se voit.
- Une paire ne perd pas son fond en silence : la suppression du fond est refusée tant qu'elle existe.
- L'IA du client n'invente pas de ratio : elle lit celui que dezyn calcule.

### Négatives

- Une paire non déclarée n'est pas contrôlée : le contrôle ne vaut que ce que le projet déclare.
- dezyn interprète désormais une partie d'`$extensions` : la règle simple de l'ADR 0030, « dezyn ne lit aucune extension », a une exception.
- Une autre clé sous `dev.dezyn` est refusée : un document DTCG qui en porte une ne s'importe pas tel quel, et un token déjà stocké qui en porterait une devrait d'abord être nettoyé (§2).
- Supprimer un fond demande de retirer d'abord les paires qui le citent.
- Un fond translucide ne reçoit aucun verdict, seulement « indéterminé ».
- L'IA ne propose jamais `large-text` : un vrai texte large déclaré par elle est jugé au seuil de 4,5:1 tant qu'un humain ne change pas l'usage.
- Sans équivalent HTTP, l'app ne montre pas les contrastes ; ils ne se lisent que par une IA cliente.
- Le niveau AAA n'est pas contrôlé.

### Risques et mitigations

- **L'IA suggère une paire ou un usage faux** : la suggestion est une proposition qu'un éditeur relit et peut rejeter (ADR 0012).
- **Les paires déclarées ne couvrent pas le projet** : la recette `bilan_sante` fait suggérer par l'IA les paires manquantes ; elles entrent dans le projet après validation, et le passage suivant les contrôle.
- **Un besoin nouveau veut une autre clé sous `dev.dezyn`** : elle reste refusée jusqu'à ce qu'un ADR la définisse, plutôt que d'y laisser un contenu libre.
- **L'écart entre deux implémentations du ratio** (seuil de linéarisation, arrondi) : le calcul se fait à un seul endroit, dans dezyn, avec le seuil 0,04045 fixé dans les notes d'implémentation, et ses tests fixent des paires de référence aux ratios connus.

## Notes d'implémentation

1. Le schéma de `dev.dezyn` s'ajoute à `token-definition.ts`, strict (ADR 0023 §1) : `contrastOn` seul, chaque entrée en chaîne de référence ou en objet `{ on, usage }`. Les autres clés d'`$extensions` gardent le contenu libre de l'ADR 0030.
2. La validation des références de `contrastOn` (couleur existante ou créée dans la même écriture, lot ou import, pas le token lui-même, pas de doublon) se fait avec celle des alias, à l'écriture.
3. Le refus de suppression de l'ADR 0026 §2 compte les `contrastOn` parmi les références, et nomme les tokens qui citent le fond.
4. Le calcul est une fonction pure du domaine `token` : valeurs résolues de chaque mode en entrée, ratio et verdict en sortie. Chaque composante sRGB `C` (entre 0 et 1) se linéarise par `C ≤ 0,04045 ? C / 12,92 : ((C + 0,055) / 1,055)^2,4`, avec le seuil 0,04045 de la norme sRGB, que reprennent les errata de WCAG, plutôt que 0,03928 ; un test fixe une composante entre les deux seuils. Luminance relative `L = 0,2126 R + 0,7152 G + 0,0722 B` sur les composantes linéarisées, ratio `(L1 + 0,05) / (L2 + 0,05)` avec `L1` la plus claire. Un premier plan translucide est composé sur son fond en « source-over », composante par composante dans l'espace sRGB non linéarisé : `C = α·Cpremier + (1 − α)·Cfond`, avant la linéarisation.
5. `check_contrast` s'enregistre comme les autres outils MCP ; le test de l'ADR 0021 qui parcourt les outils enregistrés le couvre.
6. La recette `bilan_sante` s'ajoute ensuite au registre des recettes (ADR 0059 §1).

## Liens

- [ADR 0002](0002-ia-du-client-via-mcp-sans-ia-embarquee.md) — dezyn calcule, l'IA du client suggère et décide de ses appels.
- [ADR 0010](0010-tokens-au-format-dtcg-modes-par-le-resolver.md) — une valeur par mode : le contraste se calcule dans chaque mode.
- [ADR 0012](0012-les-ecritures-de-l-ia-sont-des-propositions-relues-par-un-editeur.md) — une paire suggérée par l'IA est une proposition.
- [ADR 0021](0021-seuls-les-appels-mcp-qui-visent-un-espace-ou-un-projet-entrent-dans-l-historique.md) — l'appel à `check_contrast` entre dans l'historique.
- [ADR 0023](0023-reponses-ouvertes-enums-ouverts-et-unions-extensibles-dans-les-contrats.md) — le schéma strict de `dev.dezyn`.
- [ADR 0026](0026-suppressions-ecritures-des-membres-variantes-et-decisions-dans-la-relecture-des-propositions.md) — un token référencé ne se supprime pas ; complété pour `contrastOn`.
- [ADR 0030](0030-dezyn-conserve-les-extensions-d-un-token-sans-les-interpreter.md) — les extensions conservées sans interprétation ; amendé pour la clé `dev.dezyn`.
- [ADR 0059](0059-les-agents-sont-des-recettes-servies-en-prompt-mcp-le-releve-figma-est-la-premiere.md) — les recettes ; `bilan_sante` la suit sans l'amender.
