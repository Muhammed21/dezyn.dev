# 0053 — Le gate de migrations s'exécute depuis main, et seul un mainteneur approuve un contenu de migrations

- Statut : Proposé
- Date : 2026-11-23
- Décideurs : Muhammed Cavus

## Contexte et problématique

Le gate de migrations (`.github/workflows/migration-gate.yml`, `packages/db/src/migration-gate/`) refuse une migration non additive tant que le label `review:needs-approval` est posé, et en retirer le label l'approuve. Les migrations s'appliquent hors du démarrage (ADR 0009) : une migration destructive passée sans relecture perd des données en production.

Deux constats de l'audit du 2026-11-23 (#368) :

- Sur #363, `github-actions[bot]` a posé puis retiré le label dans la même seconde (09:36:37Z), et le gate a tenu la migration 0026 pour approuvée. L'approbation se déduisait de la seule absence du label. Le retrait vient de `actions/labeler` dans `pr-review.yml` : il lit les labels de la PR au démarrage, puis remplace toute la liste par un `PUT` (`issues.setLabels`, en v5 comme en v7). Un label posé entre sa lecture et son écriture disparaît. `sync-labels` n'y change rien.
- Le gate tournait sur `pull_request`, donc avec le workflow et le script de la branche de la PR : une PR pouvait modifier son propre gate.

Le dépôt est public : une PR peut venir d'un fork. `main` sera protégée par un ruleset où `Migration gate` est un contrôle requis (#367) : le contrôle doit tourner sur chaque PR.

Problématique : depuis quel code le gate s'exécute-t-il, qui peut approuver une migration non additive, et comment l'approbation reste-t-elle liée au contenu relu ?

## Facteurs de décision

- Une PR, d'un fork ou du dépôt, ne change ni le workflow ni le script qui la juge.
- Aucun code de la PR ne s'exécute avec un jeton en écriture ; aucun secret n'est exposé.
- Seul un humain qui a le rôle `admin` ou `maintain` sur le dépôt approuve. Un bot, une application ou un contributeur n'approuve pas.
- Une approbation porte sur un contenu : un changement des migrations non additives après l'approbation en demande une nouvelle, même si l'exécution déclenchée par le push est annulée ou n'a pas lieu.
- Le contrôle tourne sur chaque PR et réussit en quelques secondes sans migration.

## Options envisagées

### Déclencheur

#### Option A — `pull_request_target`, migrations lues comme des données

- Avantage : le workflow et le script viennent de `main` ; le contrôle s'affiche sur la PR et peut être requis.
- Inconvénient : le jeton a des droits en écriture, même pour une PR de fork. Tout checkout de la PR devient une donnée à ne jamais exécuter.
- **Retenue.**

#### Option B — `workflow_run` après un workflow `pull_request`

- Avantage : le modèle de `preview.yml`, déjà en place.
- Inconvénient : son contrôle ne s'affiche pas sur la PR et ne peut pas être requis tel quel ; il faudrait poster un statut de commit à la main.
- **Écartée.**

#### Option C — Garder `pull_request` et vérifier que la PR ne touche pas au gate

- Inconvénient : la vérification tourne elle-même depuis la branche de la PR, qui peut la retirer.
- **Écartée.**

### Lien entre l'approbation et le contenu

#### Option A — Une empreinte du contenu, enregistrée par le gate dans un commentaire de la PR

- Avantage : la décision ne dépend que de l'état (label, événements, empreinte), pas de l'événement qui a lancé l'exécution. Une exécution annulée ne perd rien.
- Inconvénient : un commentaire de plus sur une PR qui a des migrations non additives.
- **Retenue.**

#### Option B — Reposer le label sur un push qui change les migrations (le comportement d'avant)

- Inconvénient : `cancel-in-progress` annule l'exécution du push quand un autre événement suit, par exemple l'auteur qui édite le titre ; l'exécution suivante voit l'ancienne approbation et passe.
- **Écartée.**

### Retrait du label par le labeler

#### Option A — Les paliers de chemins calculés par `review-tier.sh`, labels changés un par un

- Avantage : `gh pr edit` ajoute et retire par les mutations `addLabelsToLabelable` et `removeLabelsFromLabelable`, sans réécrire la liste. Aucune action tierce.
- Inconvénient : un petit lecteur de globs en bash (`**` et `*` seulement), testé par `pnpm test:scripts`.
- **Retenue.**

#### Option B — `sync-labels`, ou une autre version de `actions/labeler`

- Inconvénient : toutes les versions remplacent la liste entière.
- **Écartée.**

## Décision

### 1. Le gate s'exécute depuis main, sans code de la PR

Le workflow tourne sur `pull_request_target` vers `main`, pour `opened`, `synchronize`, `reopened`, `ready_for_review`, `edited` (dont le changement de base), `labeled` et `unlabeled`, sans filtre `paths`. Il prend le script dans un checkout de `main`. Les migrations de la PR viennent d'un second checkout, à part, en `sparse-checkout` de `packages/db/migrations`, sans identifiants persistés, et ne sont lues que par `git show <sha de tête>:<chemin>` : un lien symbolique se lit comme son texte, jamais suivi. Aucun `pnpm install`, aucun script, aucune action locale ne vient de la PR. Le workflow n'utilise aucun secret. Le jeton a `contents: read`, `pull-requests: write` et `issues: write`, pour les labels et le commentaire d'empreinte.

La liste des fichiers vient de l'API des fichiers de la PR. Une ligne illisible arrête le gate plutôt que d'oublier un fichier.

### 2. Seul le retrait du label par un mainteneur approuve

Parmi les événements `labeled` et `unlabeled` du label `review:needs-approval` (API des événements du ticket, rangés par identifiant), le dernier doit être un retrait par un compte de type `User`, sans application intermédiaire (`performed_via_github_app` nul), dont le `role_name` sur le dépôt est `admin` ou `maintain` (`GET /repos/{owner}/{repo}/collaborators/{user}/permission`). Le champ `permission` ne sert pas : il ramène `maintain` à `write`. Une erreur de l'API vaut « aucun rôle ».

### 3. L'approbation porte sur une empreinte du contenu

L'empreinte est un SHA-256 des migrations retenues : chemin, nature (non additive, modifiée, supprimée) et contenu à la tête de la PR. Quand il attend une approbation, le gate enregistre l'empreinte dans un commentaire de `github-actions[bot]` dont le corps est exactement celui qu'il écrit. Un commentaire d'un autre auteur, ou d'un autre texte, ne compte pas.

Le gate décide de l'état seul :

- aucune migration retenue : il passe ;
- label posé : il attend, et met l'empreinte à jour si les migrations ont changé ;
- label absent, retrait par un mainteneur et empreinte enregistrée égale à l'empreinte courante : il passe ;
- sinon : il remet le label, enregistre l'empreinte courante, et attend.

### 4. Les labels de palier se changent un par un

`actions/labeler` quitte `pr-review.yml`. `review-tier.sh` calcule le palier plancher depuis `.github/labeler.yml` et les fichiers de la PR, prend le plus haut avec les labels posés, et change les labels par `gh pr edit --add-label` et `--remove-label`.

## Conséquences

### Positives

- Une PR ne peut plus juger son propre gate ni l'approuver, et un bot qui retire le label le voit revenir.
- Une migration changée après l'approbation demande une nouvelle approbation, quel que soit l'événement qui lance l'exécution.
- `Migration gate` tourne sur chaque PR et peut devenir un contrôle requis (#367).
- Plus aucun workflow ne réécrit la liste des labels d'une PR.

### Négatives

- Un changement du gate ne s'exerce qu'une fois mergé sur `main` : sa PR est jugée par l'ancienne version.
- Un commentaire de plus sur chaque PR qui a une migration non additive.
- Une relance manuelle d'une exécution ancienne rejoue l'événement d'alors, mais lit l'état courant : elle ne restaure pas une ancienne décision.
- Chaque événement de label ou d'édition de la PR lance une exécution courte.

### Risques et mitigations

- Le jeton en écriture d'un `pull_request_target` sur une PR de fork : aucun code de la PR ne s'exécute, et les migrations ne sont lues que par `git show`. Le `setup-node` lit le `.node-version` de `main` et n'a pas de cache.
- Une application ou un agent qui agit avec le jeton personnel du mainteneur apparaît comme le mainteneur : le gate ne le distingue pas. Une application GitHub qui agit en son nom est refusée (`performed_via_github_app`).
- Un commentaire d'empreinte forgé : il devrait venir de `github-actions[bot]` avec le corps exact. Une PR de fork n'a qu'un jeton en lecture sur `pull_request`. Une PR du dépôt pourrait en écrire un par un workflow modifié, mais son auteur a déjà les droits d'écriture ; et l'empreinte seule n'approuve pas sans le retrait d'un mainteneur.
- Un push entre la relecture du mainteneur et son retrait du label est approuvé avec lui : le mainteneur relit la tête de la PR au moment de retirer le label.
- L'affichage d'un contrôle `pull_request_target` sur la PR se vérifie sur la première PR après le merge.

## Notes d'implémentation

- Logique pure, testée en unitaire : `maintainer-approval.ts` (événements et rôle), `approval-record.ts` (empreinte et commentaire), `gate-decision.ts`, `migration-findings.ts` (fichiers de l'API).
- `packages/db/scripts/migration-gate.ts` ne fait que les appels `gh` et `git show`.
- `.github/scripts/review-floor.sh`, testé par `.github/scripts/tests/review-floor.test.sh`.

## Liens

- [ADR 0009](0009-drizzle-pour-postgresql-migrations-hors-demarrage.md) : les migrations s'appliquent hors du démarrage, d'où le gate.
