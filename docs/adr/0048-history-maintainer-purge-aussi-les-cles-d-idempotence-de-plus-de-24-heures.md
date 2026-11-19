# 0048 — `history_maintainer` purge aussi les clés d'idempotence de plus de 24 heures

- Statut : Accepté
- Date : 2026-11-19
- Décideurs : Muhammed Cavus
- Amende : ADR 0042 (droits de `history_maintainer`, §7)

## Contexte et problématique

Une écriture peut porter une clé d'idempotence (#274). La clé vit dans la table `idempotency_key`, et elle est oubliée 24 heures après sa création (#294). Une clé de plus de 24 heures encore présente est déjà traitée comme absente au moment de la réservation. Sans purge, la table grossit pourtant sans fin.

Le Worker `dezyn-purge` passe déjà toutes les 15 minutes (ADR 0042 §2). Il se connecte en `history_maintainer`, un rôle dont le secret n'est jamais donné à l'app qui sert les requêtes (ADR 0019 §2). L'ADR 0042 §7 et l'ADR 0043 §1 fixent ses droits, limités à ce que la purge de l'historique exige. `history_maintainer` n'a aucun droit sur `idempotency_key`.

Problématique : quel rôle supprime les clés d'idempotence de plus de 24 heures, et avec quels droits ?

## Facteurs de décision

- Pas de nouveau secret ni de nouveau Worker à déployer pour une suppression par âge.
- Ne donner au rôle de purge que ce que chaque purge exige.
- Une purge qui échoue n'empêche pas l'autre.

## Options envisagées

### Option A — `history_maintainer` devient le rôle des purges par âge

Le Worker `dezyn-purge` supprime aussi les clés expirées, avec le même rôle.

- Avantage : ni rôle, ni secret, ni Hyperdrive de plus ; la purge des clés suit le passage existant.
- Inconvénient : le rôle sort du seul historique, que son nom désigne.

**Retenue.**

### Option B — un rôle dédié aux clés d'idempotence

- Avantage : chaque rôle ne touche qu'une table.
- Inconvénient : un rôle, un secret et une connexion de plus pour le Worker de purge.

**Écartée** : le coût d'exploitation dépasse le gain sur une seule colonne lue.

## Décision

### 1. `history_maintainer` est le rôle des purges par âge

En plus des droits de l'ADR 0042 §7 et de l'ADR 0043 §1, `history_maintainer` a `SELECT (created_at)` et `DELETE` sur `idempotency_key`, et rien d'autre sur cette table. Il ne lit ni la clé, ni l'empreinte, ni la réponse mémorisée.

### 2. Chaque passage du Worker `dezyn-purge` supprime les clés de plus de 24 heures

L'âge d'une clé se mesure par le `now()` de la base, la même horloge que celle qui date la clé à sa réservation. Les clés en cours et les clés terminées sont supprimées de la même façon.

### 3. Les deux purges sont indépendantes

Dans un même passage, la purge des clés s'exécute même si celle de l'historique échoue, et inversement. Chaque échec est journalisé. Après les deux purges, le passage relève le premier échec, pour que Cloudflare marque le passage en échec.

## Conséquences

### Positives

- La table `idempotency_key` ne grossit pas au-delà de 24 heures d'écritures.
- Le secret de `history_maintainer` reste hors de l'app.

### Négatives

- Le nom `history_maintainer` ne dit plus tout ce que fait le rôle.
- Un droit de plus pour le rôle de purge.

### Risques et mitigations

- **Une clé expirée reste jusqu'au passage suivant** : elle est déjà traitée comme absente à la réservation ; seule la place qu'elle occupe attend 15 minutes.
- **Un grand nombre de clés expire d'un coup** : la suppression se fait en une requête ; des lots se règlent si les mesures le demandent.

## Notes d'implémentation

1. Migration 0019 : `GRANT SELECT ("created_at"), DELETE ON "idempotency_key" TO history_maintainer;`.
2. `purgeExpiredIdempotencyKeys` dans `apps/api/src/platform/postgres-idempotency.ts`, appelée par `apps/api/src/purge-worker.ts` et par `pnpm --filter @repo/api run purge`. Chaque passage journalise `idempotency_purge_pass`.
3. À l'acceptation de cet ADR : la ligne de statut de l'ADR 0042 et sa ligne d'index dans `docs/adr/README.md` mentionnent l'amendement de son §7 par l'ADR 0048.

## Liens

- [ADR 0019](0019-l-historique-est-en-ajout-seul-pour-l-app-la-purge-passe-par-un-role-dedie.md) — le rôle `history_maintainer`, réservé au job de purge.
- [ADR 0042](0042-la-purge-de-l-historique-tourne-dans-un-worker-planifie-et-ramene-l-espace-a-90-pourcent-de-sa-limite.md) — le Worker `dezyn-purge` et les droits du rôle, que cet ADR amende.
- [ADR 0043](0043-le-worker-de-purge-verifie-le-schema-et-se-deploie-sans-attendre-le-plan-workers-paid.md) — les autres droits ajoutés au rôle.
