# 0052 — Le Worker de purge supprime un espace orphelin après la fin de sa période payée

- Statut : Accepté — §2 et §3 amendés par [0056](0056-un-espace-orphelin-attend-7-jours-avant-sa-purge-depuis-l-heure-d-orphelinat-notee-sur-l-espace.md)
- Date : 2026-11-23
- Décideurs : Muhammed Cavus
- Amende : ADR 0042 (§7, `history_maintainer` reçoit `DELETE` sur `space` et sur les tables d'un espace)

## Contexte et problématique

Quand le seul membre d'un espace supprime son compte, l'espace reste orphelin : il n'a plus aucun membre ouvert et personne ne peut l'ouvrir (ADR 0051). Ses projets, tokens, états Figma, propositions, historique, invitations et abonnement restent en base. L'ADR 0051 prévoit sa purge en entier.

L'historique est en ajout seul pour le rôle `app` : seul `history_maintainer` supprime des entrées (ADR 0019). Ce rôle n'est détenu que par le Worker `dezyn-purge`, qui passe toutes les 15 minutes, sans cron en preview (ADR 0042 §2), avec 10 s par requête (ADR 0049 §3). L'ADR 0042 §7 ne lui donne aucun droit d'écriture sur `space`.

Un espace orphelin peut avoir un abonnement payé par le membre parti, résilié en fin de période (ADR 0050 §3). Une résiliation que Polar n'a pas encore reçue est rejouée depuis `space_subscription.cancel_requested_at` par le Worker de l'API.

dezyn ne stocke aucun fichier hors de PostgreSQL : les rendus et les snapshots (ADR 0005) attendent leur stockage.

Problématique : quel Worker et quel rôle suppriment un espace orphelin, à partir de quand, et dans quel ordre ?

## Facteurs de décision

- Un espace qui a un membre ouvert n'est jamais touché.
- Un abonnement payé va jusqu'à la fin de sa période, et sa résiliation chez Polar n'est jamais perdue.
- Le secret qui supprime des données reste hors de l'app qui sert les requêtes (ADR 0019).
- Chaque requête tient en 10 s, et un passage s'arrête après son budget (ADR 0042 §4, ADR 0049 §3).
- Aucune purge ne tourne en preview.

## Options envisagées

### Option A — Le Worker `dezyn-purge`, avec `history_maintainer`

- Avantage : le rôle supprime déjà l'historique ; aucun nouveau secret, Worker ni Hyperdrive.
- Inconvénient : le rôle reçoit `DELETE` sur l'espace et toutes ses tables, et son nom dit encore moins tout ce qu'il fait (ADR 0048, négatives).
- **Retenue.**

### Option B — Le cron du Worker de l'API, avec `app`

- Avantage : `app` écrit déjà dans la plupart de ces tables.
- Inconvénient : `app` n'a pas `DELETE` sur `history_entry`, et le lui donner défait l'ADR 0019.
- **Écartée.**

### Option C — Un nouveau rôle et un nouveau Worker

- Avantage : des droits séparés de ceux de la purge de l'historique.
- Inconvénient : un rôle, un secret, un Hyperdrive et un Worker de plus, pour un rôle qui aurait lui aussi `DELETE` sur l'historique.
- **Écartée.**

## Décision

### 1. Un espace orphelin est un espace sans membre ouvert

Un espace est orphelin quand aucune ligne de `space_member` n'a `closed_at` nul. Les appartenances fermées ne comptent pas.

### 2. La purge attend la fin de la période payée

Un espace orphelin se purge quand il n'a pas d'abonnement, quand son abonnement est terminé (`ended`), ou quand la date de fin de sa période est passée et qu'aucune résiliation n'attend d'être envoyée à Polar (`cancel_requested_at` nul). Un abonnement non terminé sans date de fin fait attendre la purge. L'heure de référence est celle du début du passage.

### 3. Chaque passage du Worker `dezyn-purge` purge les espaces orphelins

La purge des espaces orphelins est la troisième purge du passage, indépendante des deux autres (ADR 0048 §3) : un échec est journalisé sous `orphan space purge failed`, les autres purges s'exécutent, puis le passage relève le premier échec. Chaque passage journalise `orphan_space_purge_pass`, avec `purgedSpaces`, le nombre d'espaces supprimés en entier, et `waitingSpaces`, le nombre d'espaces orphelins qui attendent la fin de leur période. `pnpm --filter @repo/api run purge` affiche les mêmes nombres sous `orphans`.

### 4. Par étapes bornées, chacune dans sa transaction

Chaque étape est une transaction, qui prend d'abord le verrou consultatif `orphan-space-purge:<espace>` ; un verrou pris fait sauter l'espace. Elle supprime ensuite les invitations de l'espace, puis relit dans la même transaction que l'espace est toujours orphelin et purgeable (§1, §2) ; sinon, elle annule tout et saute l'espace. Une invitation acceptée en même temps attend la transaction, ou fait échouer la relecture.

Puis l'étape fait une seule de ces choses, sur le premier projet de l'espace par identifiant :

1. supprimer jusqu'à 500 entrées de son historique ;
2. s'il n'en a plus, supprimer ses états Figma, ses valeurs de token (et leurs références, par cascade), ses tokens, ses modes, son modificateur, ses propositions, ses lots de propositions, puis le projet ;
3. s'il n'y a plus de projet, supprimer les changements de plan, l'abonnement, les appartenances fermées, les auteurs d'historique, puis l'espace.

Le passage enchaîne les étapes d'un espace jusqu'à sa suppression, puis passe au suivant, dans un budget de 30 secondes ; le passage suivant reprend. Les clés d'idempotence n'appartiennent pas à un espace : elles partent après 24 heures (ADR 0048).

### 5. Les droits de `history_maintainer`

En plus des droits des ADR 0042 §7, 0043 §1, 0048 §1 et 0050, `history_maintainer` a :

- `SELECT (current_period_end, cancel_requested_at)` et `DELETE` sur `space_subscription` ;
- `DELETE` sur `space`, `space_member` et `project`, qu'il lit déjà ;
- `SELECT (space_id)` et `DELETE` sur `space_invitation`, `space_plan_change` et `history_author` ;
- `SELECT (id, project_id)` et `DELETE` sur `token` et `modifier` ;
- `SELECT (token_id)` et `DELETE` sur `token_value` et `token_figma_state` ;
- `SELECT (modifier_id)` et `DELETE` sur `mode` ;
- `SELECT (project_id)` et `DELETE` sur `proposal` et `proposal_batch`.

Il n'a ni `INSERT` ni `UPDATE` sur ces tables, et rien sur `token_value_reference`, que la cascade de `token_value` supprime.

## Conséquences

### Positives

- Les données d'un espace que plus personne ne peut ouvrir quittent la base sans intervention humaine.
- Un payeur parti garde sa période payée, et une résiliation en attente n'est jamais perdue avec l'abonnement.
- Aucun secret, Worker ni Hyperdrive de plus ; aucune purge en preview.

### Négatives

- `history_maintainer` peut supprimer n'importe quel espace et toutes ses données de design : une faille du Worker de purge ou une fuite de son secret coûte beaucoup plus qu'avant.
- Le nom `history_maintainer` dit encore moins ce que fait le rôle.
- Un grand historique se purge par 500 entrées par transaction : un espace Team plein demande de nombreux passages, pendant lesquels il reste en base, en partie supprimé.
- Les données de design d'un projet se suppriment en une transaction, sans lot.

### Risques et mitigations

- **Un espace qui a un membre ouvert est purgé** : chaque étape relit l'absence de membre ouvert dans sa transaction, après avoir supprimé les invitations ; un test d'intégration vérifie qu'un espace avec un membre ouvert reste intact.
- **Une invitation à un espace orphelin est acceptée pendant sa purge** : l'acceptation verrouille l'invitation, que la purge supprime d'abord ; l'une attend l'autre, et la relecture annule l'étape si un membre est arrivé.
- **Polar envoie un événement pour un espace purgé** : l'API le journalise comme événement d'un espace inconnu et ne l'applique pas.
- **La suppression des données de design d'un gros projet dépasse 10 s** : l'étape échoue en 57014, le passage est marqué en échec et le suivant la reprend ; un découpage par lots se décide si les mesures le demandent.
- **Des fichiers sont stockés hors de PostgreSQL** (rendus, snapshots) : leur suppression s'ajoute à l'étape 2 du §4 avec leur stockage.

## Notes d'implémentation

1. Migration 0027 : les droits du §5.
2. `orphanSpaceIsPurgeable` dans `apps/api/src/modules/space/domain/orphan-space.ts`, `purgeOrphanSpaces` dans `application/purge-orphan-spaces.ts`, les requêtes dans `infrastructure/postgres-orphan-space-purge.ts`, et `orphanSpacePurge` exporté par `space-module.ts`.
3. `apps/api/src/purge-worker.ts` et `apps/api/src/manual-purge.ts` appellent `orphanSpacePurge` après les deux autres purges.
4. La ligne de statut de l'ADR 0042 et sa ligne d'index dans `docs/adr/README.md` mentionnent l'amendement de son §7 par l'ADR 0052.

## Liens

- [ADR 0051](0051-le-seul-membre-d-un-espace-supprime-son-compte-et-laisse-un-espace-orphelin.md) — l'espace orphelin, que cet ADR purge.
- [ADR 0019](0019-l-historique-est-en-ajout-seul-pour-l-app-la-purge-passe-par-un-role-dedie.md) — seul `history_maintainer` supprime l'historique.
- [ADR 0042](0042-la-purge-de-l-historique-tourne-dans-un-worker-planifie-et-ramene-l-espace-a-90-pourcent-de-sa-limite.md) — le Worker `dezyn-purge` et les droits du rôle, que cet ADR amende.
- [ADR 0048](0048-history-maintainer-purge-aussi-les-cles-d-idempotence-de-plus-de-24-heures.md) — les purges indépendantes d'un même passage.
- [ADR 0049](0049-une-entree-d-historique-porte-sa-taille-et-le-worker-de-purge-a-10-secondes-par-requete.md) — les 10 s par requête du Worker de purge.
- [ADR 0050](0050-polar-en-merchant-of-record-un-abonnement-par-espace-et-un-espace-gele-sans-perte-au-retour-en-free.md) — l'abonnement, son statut et la résiliation en fin de période.
