# 0056 — Un espace orphelin attend 7 jours avant sa purge, depuis l'heure d'orphelinat notée sur l'espace

- Statut : Accepté
- Date : 2026-11-23
- Décideurs : Muhammed Cavus
- Amende : ADR 0052 (§2, la purge attend aussi 7 jours après l'orphelinat ; §3, `waitingSpaces` compte aussi les espaces en délai de grâce)

## Contexte et problématique

Un espace orphelin sans abonnement est purgeable tout de suite, et le Worker `dezyn-purge` passe toutes les 15 minutes (ADR 0052). Une suppression de compte faite par erreur, ou par une session volée, détruit donc les espaces dont le compte était le seul membre, sans recours (#372, constat K de la PR #366).

L'ADR 0052 §2 ne regarde que l'abonnement. Pour attendre après l'orphelinat, la purge doit connaître l'heure à laquelle la dernière appartenance ouverte de l'espace s'est fermée. Or la suppression du compte supprime l'utilisateur, et ses appartenances partent avec lui par la cascade de `space_member.user_id` (migration 0026) : la base ne garde aucune trace de cette fermeture. Un espace ne devient orphelin que par la suppression du compte de son seul membre : le dernier propriétaire ne quitte pas un espace qui a d'autres membres (ADR 0011 §5, ADR 0051).

Problématique : combien de temps un espace orphelin attend-il avant sa purge, depuis quelle heure, et comment l'opérateur le rend-il à quelqu'un pendant ce temps ?

## Facteurs de décision

- Une suppression de compte par erreur ou par une session volée se rattrape, sur demande au support.
- Les données d'un espace que plus personne ne peut ouvrir quittent la base dans un délai court (ADR 0051).
- Une période payée va toujours jusqu'à son terme (ADR 0052 §2).
- Aucun droit nouveau pour `history_maintainer` (ADR 0052, négatives) ni pour `app` (ADR 0019).
- Une seule heure de référence par passage (ADR 0052 §2).

## Options envisagées

### Option A — Lire la fermeture de la dernière appartenance dans `space_member`

- Avantage : aucune migration.
- Inconvénient : la cascade de la suppression du compte efface la ligne fermée ; il ne reste que les appartenances plus anciennes des autres membres partis, dont la date ne dit rien de l'orphelinat.
- **Écartée.**

### Option B — Garder les appartenances d'un compte supprimé

- Avantage : la fermeture se lit comme tout départ, avec un motif `account_deleted`.
- Inconvénient : `space_member.user_id` devient nul, et chaque lecture des membres, des rôles et des auteurs d'historique (ADR 0015, ADR 0038) doit l'écarter.
- **Écartée.**

### Option C — Noter l'heure d'orphelinat sur l'espace

- Avantage : une colonne nullable, posée dans la transaction de la suppression du compte, lue par la purge avec l'abonnement ; aucun nouveau droit.
- Inconvénient : une donnée de plus à tenir juste ; un espace déjà orphelin au déploiement n'a pas d'heure, et la migration doit la poser.
- **Retenue.**

## Décision

### 1. Un espace orphelin attend 7 jours

Un espace orphelin se purge quand 7 jours sont passés depuis son orphelinat **et** que les règles de l'ADR 0052 §2 sur l'abonnement le permettent. Le délai est écoulé dès que l'heure du début du passage atteint l'orphelinat plus 7 jours, à la milliseconde. Un abonnement dont la période payée finit après le délai fait toujours attendre la purge, et un abonnement terminé n'abrège pas le délai. L'heure de référence reste celle du début du passage, pour la liste comme pour la relecture de chaque étape (ADR 0052 §4).

### 2. L'heure d'orphelinat est `space.orphaned_at`

La suppression d'un compte pose `orphaned_at` sur chaque espace dont il était le seul membre ouvert, dans sa transaction, à la même heure que son départ des espaces payés, et en même temps qu'elle supprime leurs invitations. Un espace qui a un membre ouvert a `orphaned_at` nul. Un espace orphelin sans `orphaned_at` attend la purge, sans fin.

La migration 0030 ajoute la colonne et pose l'heure du déploiement sur chaque espace déjà orphelin, qui commence ainsi son délai. Cet `UPDATE` demande l'approbation d'un mainteneur au gate de migrations (ADR 0054). Aucun droit nouveau : `app` modifie déjà `space` (migration 0003) et `history_maintainer` le lit déjà (migration 0015).

### 3. `waitingSpaces` compte aussi les espaces en délai de grâce

`orphan_space_purge_pass` journalise sous `waitingSpaces` les espaces orphelins qui attendent la fin de leur délai de grâce ou de leur période payée.

### 4. L'opérateur rattache un espace orphelin à un compte pendant le délai

Sur demande au support, l'opérateur rend un espace orphelin dont le délai court à un compte existant, qui en devient propriétaire. La procédure du runbook d'hébergement s'exécute avec le rôle `app`, dans une transaction qui prend d'abord le verrou consultatif `orphan-space-purge:<espace>` de la purge (ADR 0052 §4), ouvre l'appartenance du compte, puis remet `orphaned_at` à nul. Elle ne change rien à un espace dont le délai est passé, qui peut être déjà en partie purgé.

## Conséquences

### Positives

- Une suppression de compte par erreur ou par une session volée se rattrape pendant 7 jours, sans perte.
- Aucun droit nouveau pour `history_maintainer` ni pour `app`.
- La règle de purge reste une fonction pure de l'espace et de l'heure du passage.

### Négatives

- Les données d'un compte supprimé restent 7 jours de plus en base.
- Le rattachement passe par une requête SQL de l'opérateur, sans écran ni trace dans l'historique.
- La migration 0030 contient un `UPDATE`, qu'un mainteneur approuve.
- Un espace orphelin sans `orphaned_at` n'est jamais purgé sans intervention.

### Risques et mitigations

- **Un chemin futur rend un espace orphelin sans poser `orphaned_at`** : l'espace attend au lieu d'être purgé, et `waitingSpaces` ne redescend pas ; un test d'intégration de la suppression du compte vérifie l'heure posée.
- **L'espace est rattaché à la mauvaise personne** : le support vérifie l'identité du demandeur avant la procédure ; l'appartenance ouverte se ferme comme tout retrait de membre.
- **Une étape de purge tourne pendant le rattachement** : le verrou consultatif attend sa fin, et la purge ne commence jamais pendant le délai.
- **L'horloge du Worker et celle de PostgreSQL divergent** : le délai se compte en jours, et la procédure de rattachement s'arrête au délai mesuré par PostgreSQL.

## Notes d'implémentation

1. Migration 0030 : la colonne `space.orphaned_at` et l'heure des espaces déjà orphelins.
2. `orphanSpaceIsPurgeable` et `ORPHAN_GRACE_PERIOD_MS` dans `apps/api/src/modules/space/domain/orphan-space.ts` ; `purgeOrphanSpaces` passe l'espace relu entier à la règle.
3. `orphanSpacesOn` dans `apps/api/src/modules/space/infrastructure/postgres-account-departures.ts`, étape `orphanSpaces` de la suppression du compte.
4. La procédure de rattachement dans `docs/runbooks/hebergement.md`, exécutée par un test d'intégration avec le rôle `app`.
5. La ligne de statut de l'ADR 0052 et sa ligne d'index dans `docs/adr/README.md` mentionnent l'amendement de ses §2 et §3.

## Liens

- [ADR 0052](0052-le-worker-de-purge-supprime-un-espace-orphelin-apres-la-fin-de-sa-periode-payee.md) — la purge des espaces orphelins, que cet ADR amende.
- [ADR 0051](0051-le-seul-membre-d-un-espace-supprime-son-compte-et-laisse-un-espace-orphelin.md) — l'espace orphelin.
- [ADR 0054](0054-le-gate-de-migrations-lit-le-sql-comme-postgresql-et-demande-l-approbation-des-droits-de-modifier-ou-supprimer.md) — l'approbation de la migration 0030.
- [ADR 0015](0015-l-historique-garde-les-actions-d-un-compte-supprime-sous-un-membre-supprime.md) — les actions du compte supprimé, qu'un espace rattaché garde.
- [ADR 0019](0019-l-historique-est-en-ajout-seul-pour-l-app-la-purge-passe-par-un-role-dedie.md) — les droits de `app` et de `history_maintainer`.
