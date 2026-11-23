# 0055 — Un abonnement payé par un non-propriétaire est révoqué et remboursé automatiquement

- Statut : Accepté
- Date : 2026-11-23
- Décideurs : Muhammed Cavus
- Amende : ADR 0050 (§1, les remboursements se traitent à la main dans le tableau de bord de Polar ; §3, le payeur est un propriétaire de l'espace)

## Contexte et problématique

Le payeur d'un espace est toujours un propriétaire (ADR 0050 §3, glossaire). Le checkout est réservé aux propriétaires, mais le paiement arrive plus tard, par un webhook. Entre les deux, le propriétaire peut être rendu éditeur, quitter l'espace ou en être retiré (#371, constat C). Polar encaisse alors un abonnement que dezyn n'enregistre pas : l'espace ne passe pas Team, et l'utilisateur est débité pour rien, puis à chaque renouvellement.

L'ADR 0050 §1 laisse les remboursements au tableau de bord de Polar. Un traitement à la main dépend de quelqu'un qui lit le journal à temps, alors que dezyn est mené par une seule personne.

Problématique : que fait dezyn, chez Polar, d'un nouvel abonnement dont le payeur n'est plus propriétaire de l'espace ?

## Facteurs de décision

- Ne jamais débiter quelqu'un pour un plan qu'il n'a pas.
- Ne jamais résilier ni rembourser l'abonnement d'un vrai client : un propriétaire, ou l'abonnement déjà enregistré de l'espace.
- Ne jamais rembourser deux fois, même si Polar rejoue un webhook ou si dezyn échoue après l'appel à Polar.
- Survivre à une panne de Polar sans perdre l'intention.
- Ne pas tenir une transaction PostgreSQL ouverte pendant un appel HTTP.

## Options envisagées

### Option A — Journaliser, et traiter à la main dans Polar

- Avantage : aucun appel automatique qui toucherait de l'argent.
- Inconvénient : l'utilisateur reste débité tant que personne n'agit, et chaque renouvellement le débite encore.
- **Écartée** : elle repose sur une lecture humaine du journal.

### Option B — Résilier en fin de période

- Avantage : le même appel que le départ du payeur (ADR 0050 §3).
- Inconvénient : le premier paiement reste encaissé pour un plan que l'espace n'a jamais eu.
- **Écartée.**

### Option C — Révoquer tout de suite et rembourser intégralement, par une intention durable

- Avantage : l'utilisateur ne paie rien, sans attendre personne.
- Avantage : l'intention est écrite dans la transaction du webhook, et rejouée par la tâche planifiée si Polar ne répond pas.
- Inconvénient : dezyn appelle lui-même l'API de remboursement de Polar.
- **Retenue.**

## Décision

### 1. Un nouvel abonnement payé par un non-propriétaire est refusé

Un abonnement qui n'est pas celui enregistré pour l'espace, et dont le payeur n'est pas un propriétaire ouvert de l'espace au moment du webhook, est **refusé** : il ne change pas le plan, et dezyn l'enregistre dans `space_refused_subscription` (identifiant de l'abonnement Polar, espace, payeur, date de réception) dans la transaction du webhook, sous le verrou de l'espace.

Un abonnement refusé le reste : ses événements suivants ne changent jamais le plan, même si son payeur redevient propriétaire.

Ne sont jamais refusés : l'abonnement enregistré de l'espace (ses révocations et renouvellements s'appliquent, même si son payeur n'est plus propriétaire), un second abonnement quand un autre est en cours (il est seulement journalisé, comme avant), un abonnement dont le payeur n'est pas un utilisateur.

### 2. dezyn révoque l'abonnement refusé et rembourse ses commandes payées

Après la transaction, dezyn :

- révoque l'abonnement tout de suite chez Polar (`DELETE /v1/subscriptions/{id}`). Un abonnement déjà révoqué compte comme révoqué ;
- rembourse le montant remboursable de chaque commande payée de l'abonnement (`POST /v1/refunds/`, motif `other`), la taxe suivant le montant. Chaque remboursement porte la métadonnée `dezyn_refused_subscription_id`. Une commande qui a déjà un remboursement en attente ou réussi de dezyn pour cet abonnement n'est pas remboursée une seconde fois. Une commande déjà remboursée en entier compte comme remboursée. Sans commande payée, le remboursement reste à faire.

La révocation et le remboursement se marquent faits séparément.

### 3. L'intention est rejouée, et réservée à un seul exécutant à la fois

La tâche planifiée qui rejoue les résiliations (ADR 0050 §3) rejoue aussi les refus qui ne sont pas faits. Avant d'appeler Polar, l'exécutant réserve le refus pour cinq minutes (`settling_since`) : un webhook rejoué en même temps, ou la tâche planifiée, ne l'appelle pas une seconde fois.

### 4. Le journal distingue ce qui est fait de ce qu'il faut faire

- Refus traité automatiquement : `warn`.
- Refus laissé à la tâche planifiée par le webhook : `warn`.
- Événement d'un abonnement déjà refusé : `info`.
- Refus que la tâche planifiée n'a pas pu finir : `error`, qui dit de révoquer et de rembourser à la main dans Polar.

Ce volet amende l'ADR 0050 §1 : ce remboursement-là est automatique. Les autres remboursements et les litiges restent dans le tableau de bord de Polar.

## Conséquences

### Positives

- Un ancien propriétaire qui paie après avoir perdu son rôle est remboursé sans intervention.
- Un webhook rejoué, un événement suivant ou une panne de Polar ne remboursent jamais deux fois.

### Négatives

- Le jeton Polar de l'API doit avoir les droits `subscriptions:write`, `orders:read`, `refunds:read` et `refunds:write`.
- La commission de Polar sur le paiement remboursé reste perdue pour dezyn.
- Le rôle `app` reçoit `UPDATE` sur trois colonnes d'une nouvelle table (`revoked_at`, `refunded_at`, `settling_since`).
- Un refus qui ne peut pas finir journalise une erreur à chaque passage de la tâche planifiée, jusqu'au traitement à la main.

### Risques et mitigations

- **Rembourser un vrai client** : seul un abonnement qui n'est pas celui enregistré, et dont le payeur n'est pas propriétaire ouvert, sous le verrou de l'espace, est refusé (§1). Les tests couvrent le propriétaire, l'abonnement enregistré, le second abonnement et le payeur inconnu.
- **Rembourser deux fois** : la réservation de cinq minutes sérialise les exécutants, et Polar sert de vérification : remboursements de dezyn déjà présents sur la commande, montant remboursable, erreur `RefundedAlready` (§2, §3).
- **Le webhook arrive avant la commande payée** : le remboursement reste à faire, et la tâche planifiée le reprend.
- **Un appel à Polar dure plus que la réservation** : un second exécutant pourrait reprendre le refus ; la vérification côté Polar (§2) évite encore le double remboursement.

## Notes d'implémentation

1. Migration `0029_space_refused_subscription` : la table, sans clé étrangère vers `space` (un espace orphelin peut être purgé, ADR 0052), le payeur mis à `NULL` à la suppression de son compte. `GRANT SELECT, INSERT, UPDATE ("revoked_at", "refunded_at", "settling_since")` au rôle `app`.
2. Port `MerchantOfRecord` : `revokeNow` et `refundAll`. Adaptateur : `revokeSubscriptions`, `listOrders`, `listRefunds` et `createRefunds` de `@polar-sh/sdk/2027-01`.
3. `subscriptionChangeOf` prend `payerIsOwner` et `refused`.

## Liens

- [ADR 0050](0050-polar-en-merchant-of-record-un-abonnement-par-espace-et-un-espace-gele-sans-perte-au-retour-en-free.md) — le payeur, la résiliation rejouée, et le §1 que ce volet amende.
- [ADR 0011](0011-l-espace-possede-les-projets-et-porte-le-plan.md) — les rôles propriétaire et éditeur.
- [ADR 0052](0052-le-worker-de-purge-supprime-un-espace-orphelin-apres-la-fin-de-sa-periode-payee.md) — la purge d'un espace orphelin, qui ne doit pas être bloquée par la nouvelle table.
