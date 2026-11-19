# 0049 — Une entrée d'historique porte sa taille, et le Worker de purge a 10 secondes par requête

- Statut : Accepté
- Date : 2026-11-19
- Décideurs : Muhammed Cavus
- Amende : ADR 0042 (§2, Worker `dezyn-purge` ; §4, lots de 500 entrées)

## Contexte et problématique

La purge supprime l'historique par lots de 500 entrées, de la plus ancienne à la plus récente, et retire leur taille du compteur du projet (ADR 0042 §4). La taille d'une entrée est celle de son JSON, en UTF-8 (ADR 0032 §2) : l'app la calcule quand elle écrit l'entrée, et l'ajoute au compteur. Pour la retirer, la purge relisait les 500 entrées entières, puis les recevait une seconde fois du `DELETE … RETURNING`.

Une entrée pèse jusqu'à 1 Mo, la limite du corps d'une requête. Un lot plein pèse alors 500 Mo. Mesuré sur le PostgreSQL local au repos (#323) :

- relire le lot prend 2,2 s, et le supprimer en le renvoyant 3,3 s ; les deux dépassent les 2 s par requête de l'API (`statement_timeout`), et la purge échoue en 57014 à chaque passage, sur le même lot ;
- les 500 Mo entrent deux fois dans le Worker, limité à 128 Mo de mémoire ;
- recalculer la taille en SQL, sans renvoyer les entrées, prend encore 1,8 à 2,3 s : convertir 500 Mo de `jsonb` en texte coûte à lui seul 1,1 s ;
- supprimer 500 entrées de 1 Mo, sans rien relire, prend 0,6 à 0,9 s au repos, et jusqu'à 6,4 s quand d'autres suites chargent la base.

Le Worker `dezyn-purge` ouvre sa base comme l'API, avec 2 s par requête (ADR 0042 §2).

Problématique : comment la purge retire-t-elle la taille d'un lot d'entrées de 1 Mo sans relire les entrées, et quel délai a chacune de ses requêtes ?

## Facteurs de décision

- Le compteur baisse exactement de ce que l'écriture a ajouté (ADR 0032, ADR 0042).
- Un lot plein d'entrées de 1 Mo est purgé à chaque passage.
- Le Worker ne charge pas les entrées qu'il supprime.
- Une requête bloquée de l'API se libère toujours en 2 s.
- Une migration reste compatible avec la version de l'API encore en ligne (ADR 0034 §5).

## Options envisagées

### Où la purge trouve la taille d'une entrée

#### Option A — Relire les entrées et calculer en JS

- Inconvénient : 500 Mo relus deux fois par lot plein, dans un Worker de 128 Mo.
- **Écartée.**

#### Option B — Recalculer la taille en SQL à chaque purge

- Avantage : ni colonne ni migration.
- Inconvénient : reproduire `JSON.stringify` en SQL (espaces, échappements, nombres en exposant) et convertir 500 Mo de `jsonb` en texte à chaque lot, soit 1,8 à 2,3 s.
- **Écartée.**

#### Option C — Une colonne `stored_size`, écrite par l'app avec l'entrée

- Avantage : la purge lit un entier par entrée ; le compteur baisse de la valeur même que l'écriture a ajoutée.
- Inconvénient : une migration, et un calcul SQL de la taille pour les entrées déjà écrites.
- **Retenue.**

### Le délai d'une requête du Worker de purge

#### Option A — 2 s, comme l'API

- Inconvénient : la suppression d'un lot plein dépasse 2 s dès que la base est chargée.
- **Écartée.**

#### Option B — 10 s pour le Worker de purge seul

- Avantage : plus de dix fois la suppression d'un lot plein au repos, et au-dessus des 6,4 s mesurées sous charge ; l'API garde ses 2 s.
- Inconvénient : une requête bloquée du Worker de purge tient sa connexion jusqu'à 10 s.
- **Retenue.**

## Décision

### 1. Une entrée d'historique porte sa taille

`history_entry` a une colonne `stored_size`, non nulle : la taille UTF-8 du JSON de l'entrée sans cette colonne (ADR 0032 §2). L'app la calcule avant l'insertion, l'écrit avec l'entrée et ajoute cette même valeur au compteur du projet.

La purge lit l'identifiant, la date et la taille des plus anciennes entrées, les supprime en ne renvoyant que leur taille, et retire leur somme du compteur. Le lot reste de 500 entrées (ADR 0042 §4).

### 2. Les entrées déjà écrites reçoivent leur taille par la migration

La migration calcule en SQL la taille des entrées existantes : le texte du `jsonb`, sans les espaces que PostgreSQL ajoute après « : » et « , », avec les nombres que JS écrit en exposant. Le calcul est exact pour des valeurs écrites par l'app. Pendant le déploiement, un trigger calcule de la même façon la taille d'une entrée que la version précédente de l'API écrit sans elle ; une migration suivante supprime le trigger et ses fonctions.

### 3. Le Worker de purge a 10 s par requête

Le Worker `dezyn-purge` et `pnpm --filter @repo/api purge` ouvrent leur base avec un `statement_timeout` de 10 s. L'API garde 2 s.

## Conséquences

### Positives

- Un lot plein d'entrées de 1 Mo se purge : la lecture prend quelques millisecondes, la suppression moins d'une seconde au repos.
- Le Worker ne reçoit qu'un entier par entrée.
- Le compteur baisse de la valeur exacte que l'écriture a ajoutée, quel que soit le contenu.

### Négatives

- 4 octets de plus par entrée, que le compteur ne compte pas.
- La taille d'une entrée existe à deux endroits, la colonne et le calcul de l'app.
- Une requête bloquée du Worker de purge tient sa connexion jusqu'à 10 s.

### Risques et mitigations

- **Une entrée écrite en SQL hors de l'app reçoit une taille fausse** : un nombre écrit autrement que par JS (`1.50`, `1e-7` écrit tel quel) est compté par le trigger comme PostgreSQL l'écrit ; seule l'app écrit l'historique (ADR 0019), et le trigger disparaît avec la migration suivante.
- **La suppression d'un lot plein dépasse 10 s sous une charge plus forte** : la purge échoue en 57014, le passage est marqué en échec et le suivant reprend le même lot ; le délai se règle si les mesures de production le demandent.
- **Le trigger reste en place** : la migration qui le supprime suit cette PR, dès qu'aucune version de l'API sans `stored_size` ne tourne.

## Notes d'implémentation

1. Migration 0020 : colonne `stored_size`, fonctions `history_entry_json_length` et `history_entry_stored_size`, trigger `history_entry_fill_stored_size`, calcul des entrées existantes, puis `NOT NULL`. `app` et `history_maintainer` ont déjà leurs droits sur toute la table (migrations 0005 et 0006).
2. `postgresHistoryWriter` écrit `stored_size` et ajoute la même valeur par `StorageMeter.addBytes` ; la purge retire la somme lue par `StorageMeter.removeBytes`.
3. `PURGE_STATEMENT_TIMEOUT_MS` dans le module history, passé à `createPostgresDatabase` par `apps/api/src/purge-worker.ts` et `apps/api/scripts/purge.ts`.
4. Migration suivante : suppression du trigger et des deux fonctions.
5. À l'acceptation de cet ADR : la ligne de statut de l'ADR 0042 et sa ligne d'index dans `docs/adr/README.md` mentionnent l'amendement de ses §2 et §4 par l'ADR 0049.

## Liens

- [ADR 0019](0019-l-historique-est-en-ajout-seul-pour-l-app-la-purge-passe-par-un-role-dedie.md) — l'historique en ajout seul, écrit par l'app.
- [ADR 0032](0032-le-stockage-d-un-projet-se-compte-par-un-compteur-d-octets-tenu-a-chaque-ecriture.md) — la taille d'une écriture et le compteur.
- [ADR 0034](0034-l-api-est-servie-par-un-worker-cloudflare.md) — une migration compatible avec la version en ligne.
- [ADR 0042](0042-la-purge-de-l-historique-tourne-dans-un-worker-planifie-et-ramene-l-espace-a-90-pourcent-de-sa-limite.md) — la purge par lots de 500 et le Worker `dezyn-purge`, que cet ADR amende.
