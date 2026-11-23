# 0054 — Le gate de migrations lit le SQL comme PostgreSQL, et demande l'approbation des droits de modifier ou de supprimer

- Statut : Accepté
- Date : 2026-11-23
- Décideurs : Muhammed Cavus
- Amende : la décision du ticket #279 (« `GRANT` » accepté seul par le gate) ; complète l'ADR 0053, qui fixe d'où le gate s'exécute et qui approuve

## Contexte et problématique

Le gate de migrations (ADR 0053, `packages/db/src/migration-gate/`) découpe chaque migration ajoutée en instructions, puis accepte seules les instructions additives. Le ticket #279 en a fixé la liste : `CREATE TABLE`, `CREATE INDEX`, `CREATE TYPE`, `CREATE SCHEMA`, l'ajout d'une colonne nullable ou avec une valeur par défaut, tout `ALTER` d'une table créée dans la même migration, et tout `GRANT`. Toute autre instruction attend l'approbation d'un mainteneur.

Deux constats de l'audit (#373) :

- **G.** Le découpage ne connaissait pas l'échappement par `\` d'une chaîne `E'…'`. `ALTER TABLE "t" ADD COLUMN "c" text DEFAULT E'\''; DROP TABLE "t"; --';` passait pour une seule instruction additive, alors que PostgreSQL y exécute un `DROP TABLE`. La même lecture approximative (chaînes retirées par une expression régulière, nom de table pris jusqu'au premier espace) laissait passer une seconde action cachée dans un `ADD COLUMN`, ou tenait `CREATE TABLE "token x"` pour la création de `token`.
- **L.** Tout `GRANT` était additif. La migration 0027 a donné `DELETE` sur 14 tables à `history_maintainer` (voulu par l'ADR 0052) sans qu'aucune approbation soit demandée. Or l'historique en ajout seul (ADR 0019) repose sur l'absence de `UPDATE` et de `DELETE` pour `app` : un `GRANT UPDATE, DELETE ON "history_entry" TO app` aurait défait cette garantie sans relecture.

Le gate tourne sans base de données ni dépendance (`pull_request_target`, aucun `pnpm install`, ADR 0053) : il n'a pas l'analyseur de PostgreSQL.

Problématique : comment le gate découpe-t-il le SQL sans se laisser tromper, et quels `GRANT` restent additifs ?

## Facteurs de décision

- Une instruction que PostgreSQL exécute est toujours vue par le gate : au moindre doute, le gate demande l'approbation plutôt que d'accepter.
- Un droit qui permet de modifier ou de supprimer des données, ou d'en transmettre, passe devant le mainteneur.
- Le gate reste un script Node sans dépendance, rapide, testé en unitaire.
- Les migrations déjà sur `main` ne sont pas rejugées : le gate ne lit que les migrations ajoutées par la PR.

## Options envisagées

### Lecture du SQL

#### Option A — Un petit lexer pur, calqué sur celui de PostgreSQL 17

- Avantage : une seule lecture, en jetons (mots, identifiants entre guillemets, chaînes, corps `$tag$`, commentaires, symboles), sur laquelle s'appuient toutes les règles. Les règles ne relisent plus le texte brut.
- Inconvénient : il faut reproduire les règles du lexer qui changent les frontières d'une chaîne (`E'…'`, continuation d'une chaîne sur la ligne suivante, commentaires `/* */` imbriqués).
- **Retenue.**

#### Option B — Corriger l'automate caractère par caractère et garder les expressions régulières des règles

- Inconvénient : les règles d'`ADD COLUMN` et de `CREATE TABLE` relisaient le texte avec leurs propres expressions, et restaient trompables même avec un découpage juste.
- **Écartée.**

#### Option C — Un analyseur SQL en dépendance (`pg-query-parser`, `libpg-query`)

- Avantage : l'analyseur de PostgreSQL lui-même.
- Inconvénient : une dépendance native ou WebAssembly, à installer dans un workflow `pull_request_target` qui ne lance aucun `pnpm install` (ADR 0053).
- **Écartée.**

### Droits accordés

#### Option A — Une liste fermée de privilèges additifs : `SELECT`, `INSERT`, `REFERENCES`, `USAGE`

- Avantage : tout privilège qui n'est pas dans la liste, y compris un privilège ajouté par une future version de PostgreSQL (`MAINTAIN` en 17), demande l'approbation.
- **Retenue.**

#### Option B — Une liste de privilèges destructeurs (`DELETE`, `TRUNCATE`, `ALL`) et `UPDATE` additif

- Avantage : moins d'approbations, car la plupart des tables de l'app reçoivent `UPDATE`.
- Inconvénient : `UPDATE` écrase une donnée aussi sûrement qu'un `DELETE`, et c'est le droit que l'ADR 0019 retire à `app` sur l'historique. Un privilège oublié dans la liste passe sans relecture.
- **Écartée.**

## Décision

### 1. Le gate découpe le SQL en jetons, comme PostgreSQL 17

`sql-statements.ts` découpe chaque bloc entre `--> statement-breakpoint` en jetons, puis en instructions sur les `;` hors chaînes, identifiants et commentaires :

- chaîne ordinaire `'…'` : `''` y est un guillemet, `\` n'échappe rien (`standard_conforming_strings` actif) ;
- chaîne d'échappement `E'…'` ou `e'…'`, quand `E` est un mot à lui seul ou suit un nombre (`1E'…'`) : `\` échappe le caractère suivant, `\'` compris, et `''` y est aussi un guillemet ;
- une chaîne suivie d'espaces qui contiennent un retour à la ligne, puis d'une autre chaîne, continue dans le même mode : une chaîne `E'…'` continuée garde l'échappement par `\` ; un commentaire `--` peut s'y glisser, pas un `/* */` ;
- corps `$tag$…$tag$` : rien n'y échappe, et un `$` collé à un identifiant n'ouvre pas de corps ;
- identifiant `"…"` : `""` y est un guillemet ;
- commentaires `--` jusqu'à la fin de la ligne, et `/* */` imbriqués.

Une instruction est refusée quand une chaîne, un identifiant, un corps ou un commentaire n'y est jamais fermé, ou quand elle contient une tabulation verticale hors d'une chaîne : PostgreSQL ne la traite en espace que depuis la version 16, et pas dans toutes ses règles.

Les règles lisent les jetons, pas le texte : un mot-clé est un mot sans guillemets, un nom de table qualifié se lit partie par partie (sans guillemets, il passe en minuscules), et `public.` se retire seul. Une table n'est créée par la migration que par `CREATE TABLE <nom> (`, sans `IF NOT EXISTS`.

### 2. Un `GRANT` n'est additif que s'il donne le droit de lire ou d'ajouter

Un `GRANT` est accepté seul quand :

- il a la forme `GRANT <privilèges> ON <objets> TO <rôles>` ;
- chaque privilège est `SELECT`, `INSERT`, `REFERENCES` ou `USAGE`, écrit sans guillemets, avec au plus une liste de colonnes (`SELECT ("a", "b")`) ;
- il ne contient pas `WITH` (`WITH GRANT OPTION`).

Tout autre `GRANT` demande l'approbation : `UPDATE` (par colonnes compris), `DELETE`, `TRUNCATE`, `TRIGGER`, `ALL [PRIVILEGES]`, `EXECUTE`, `CREATE`, `CONNECT`, `TEMPORARY`, `MAINTAIN`, un privilège écrit entre guillemets, un `GRANT … WITH GRANT OPTION`, et le `GRANT` d'un rôle à un autre (`GRANT app TO …`, sans `ON`). Tout `REVOKE` demande l'approbation, comme avant.

### 3. `CREATE SCHEMA` n'est additif que vide

`CREATE SCHEMA [IF NOT EXISTS] <nom>` reste additif. Un `CREATE SCHEMA` qui donne un propriétaire (`AUTHORIZATION`) ou qui embarque des instructions (`CREATE TABLE`, `GRANT`…) demande l'approbation : il permettrait d'accorder un droit sans passer par la règle 2.

### 4. Les migrations déjà sur `main` ne sont pas rejugées

Le gate ne lit que les migrations ajoutées par une PR (ADR 0053). Les 18 migrations déjà mergées qui accordent `UPDATE` ou `DELETE` ont été relues et approuvées en leur temps : 17 dont c'est le seul refus (de 0001 à 0028, dont 0027 et 0028), et 0026, qui en avait déjà d'autres. Le test sur les migrations du dépôt liste chacune avec les `GRANT` que le gate refuserait aujourd'hui.

## Conséquences

### Positives

- Le `DROP TABLE` du constat G est refusé et nommé dans le résumé ; une seconde action cachée par une chaîne `E'…'` dans un `ADD COLUMN` aussi.
- Une élévation de droits (modifier, supprimer, transmettre, devenir un autre rôle) passe devant le mainteneur, y compris sur l'historique en ajout seul.
- Un privilège inconnu du gate demande l'approbation au lieu de passer.

### Négatives

- Une migration qui crée une table de l'app et lui donne `UPDATE` ou `DELETE` demande désormais une approbation : c'est le cas de la plupart des nouvelles tables.
- Le lexer reproduit des règles de PostgreSQL : un changement de son lexer dans une version future demande de mettre le gate à jour.
- Une migration écrite à la main avec une syntaxe rare mais sûre (un `CREATE TABLE IF NOT EXISTS` suivi d'un `ALTER`, une tabulation verticale) demande une approbation de plus.

### Risques et mitigations

- Une migration qui exécute `SET standard_conforming_strings = off` change la lecture des chaînes suivantes : le `SET` lui-même n'est pas additif et demande l'approbation, le mainteneur relit alors toute la migration.
- Une valeur par défaut qui appelle une fonction (`DEFAULT f()`) reste acceptée dans un `ADD COLUMN`, comme avant : le gate juge la forme de l'instruction, pas ses effets.
- La continuation d'une chaîne, la seule règle qui change le mode d'une chaîne à distance, a ses tests adverses (`--` entre les deux parties, retour chariot seul, `/* */` qui l'interrompt). Ses expressions sont linéaires : un test vérifie qu'une longue suite de `--` sans chaîne derrière se lit sans délai (l'ancienne forme, à quantificateurs imbriqués, prenait 15 s pour 20 commentaires).

## Notes d'implémentation

- `packages/db/src/migration-gate/sql-statements.ts` : le lexer et le découpage en instructions, sans import.
- `packages/db/src/migration-gate/rejected-statements.ts` : les règles additives, sur les jetons.
- Le script `packages/db/scripts/migration-gate.ts` n'importe toujours que des modules intégrés à Node et des fichiers de `packages/db/src/migration-gate/`, que le workflow récupère en `sparse-checkout`.

## Liens

- [ADR 0053](0053-le-gate-de-migrations-s-execute-depuis-main-et-seul-un-mainteneur-approuve-un-contenu-de-migrations.md) : d'où le gate s'exécute, et qui approuve une migration non additive.
- [ADR 0019](0019-l-historique-est-en-ajout-seul-pour-l-app-la-purge-passe-par-un-role-dedie.md) : l'historique en ajout seul, qui repose sur les droits retirés à `app`.
- [ADR 0052](0052-le-worker-de-purge-supprime-un-espace-orphelin-apres-la-fin-de-sa-periode-payee.md) : les `DELETE` accordés à `history_maintainer` par 0027, à l'origine du constat L.
- [ADR 0009](0009-drizzle-pour-postgresql-migrations-hors-demarrage.md) : les migrations s'appliquent hors du démarrage, d'où le gate.
