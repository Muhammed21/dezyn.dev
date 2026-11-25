# 0058 — Un remboursement total de la commande d'un abonnement le révoque automatiquement

- Statut : Accepté
- Date : 2026-11-24
- Décideurs : Muhammed Cavus
- Amende : ADR 0050 (§1, les remboursements se traitent à la main dans le tableau de bord de Polar ; §3, l'abonnement d'un espace ne finit que par le départ du payeur ou les événements de Polar)

## Contexte et problématique

Au premier paiement réel (#370), un remboursement fait depuis le tableau de bord de Polar a laissé l'abonnement « Active » chez Polar et l'espace en Team. La documentation de Polar le confirme : rembourser la commande d'un abonnement rend l'argent sans mettre fin à l'abonnement ([remboursements](https://polar.sh/docs/features/refunds)). Seule la révocation (`subscription.revoked`) repasse l'espace en Free.

L'opérateur doit donc penser à révoquer en plus de rembourser. S'il oublie, la personne remboursée garde Team jusqu'à la fin de la période, puis l'abonnement se renouvelle et la débite de nouveau. dezyn est mené par une seule personne (#390).

Problématique : un remboursement total de la commande d'un abonnement doit-il le révoquer, et par quel événement de Polar dezyn le sait-il ?

## Facteurs de décision

- Ne jamais laisser débiter de nouveau quelqu'un qu'on a remboursé en entier.
- Ne jamais révoquer l'abonnement d'un client sans remboursement total.
- Ne jamais révoquer deux fois, même si Polar rejoue un webhook.
- Survivre à une panne de Polar sans perdre l'intention.
- Un seul chemin fait changer le plan d'un espace : les événements `subscription.*` de Polar, dans l'ordre de leur `modified_at` (ADR 0050 §4).

## Options envisagées

### Option A — Garder deux gestes séparés de l'opérateur

- Avantage : dezyn ne touche jamais seul à un abonnement payé par un propriétaire.
- Inconvénient : un oubli laisse Team à quelqu'un de remboursé, et un renouvellement le débite encore.
- **Écartée** au triage de #390.

### Option B — Révoquer sur `order.refunded` quand la commande est remboursée en entier

- Avantage : Polar n'envoie `order.refunded` qu'une fois le remboursement réussi, et la commande qu'il porte dit si elle est remboursée en entier (`status` = `refunded`) et de quel abonnement elle est (`subscription_id`).
- Avantage : le même appel que le refus d'un payeur (ADR 0055) : `DELETE /v1/subscriptions/{id}`, un abonnement déjà révoqué comptant comme révoqué.
- **Retenue.**

### Option C — Révoquer sur `refund.created` ou `refund.updated`

- Inconvénient : un remboursement ne dit pas si la commande est remboursée en entier : il faudrait relire la commande chez Polar et cumuler ses remboursements.
- Inconvénient : `refund.created` arrive aussi pour un remboursement en attente, qui peut encore échouer.
- **Écartée.**

### L'espace en Free : tout de suite, ou à la révocation

- Marquer l'abonnement terminé à la réception du remboursement ouvrirait un second chemin de changement de plan, hors de l'ordre des événements de Polar. **Écartée.**
- Attendre `subscription.revoked`, envoyé par Polar après la révocation, comme pour #370 et pour le refus d'un payeur (ADR 0055). **Retenue.**

## Décision

### 1. Un remboursement total révoque l'abonnement enregistré de l'espace

Le webhook traite `order.refunded`. Polar l'envoie quand un remboursement de la commande réussit, partiel ou total. dezyn révoque l'abonnement quand :

- la commande est remboursée en entier : son statut est `refunded`, que Polar pose quand le montant remboursé atteint le montant net de la commande (`partially_refunded` sinon) ;
- elle appartient à un abonnement (`subscription_id`) ;
- cet abonnement est l'abonnement enregistré d'un espace, et il n'est pas terminé.

Le payeur, propriétaire ou non, ne compte pas : le remboursement total vient de l'opérateur, ou de Polar quand il prévient un litige. Toute commande de l'abonnement compte, pas seulement la dernière.

Rien ne change pour un remboursement partiel, une commande hors abonnement, un abonnement inconnu de dezyn, déjà terminé ou refusé (ADR 0055, qui le révoque déjà), ni pour les événements `refund.*`, `order.created`, `order.paid` et `order.updated`.

### 2. L'espace repasse en Free à la révocation

dezyn ne change ni l'abonnement ni le plan à la réception du remboursement. Polar envoie `subscription.revoked` après la révocation, et ce seul événement repasse l'espace en Free (ADR 0050 §4).

### 3. L'intention est durable, rejouée, et réservée à un seul exécutant

Dans le webhook, dezyn écrit l'intention dans `space_refund_revocation` (abonnement Polar, espace, commande, date de réception), réservée tout de suite à cet exécutant (`settling_since`), puis appelle Polar et marque la révocation faite. L'abonnement Polar est la clé : un webhook rejoué, même en même temps, n'écrit rien et n'appelle pas Polar.

La tâche planifiée qui rejoue les résiliations et les refus (ADR 0050 §3, ADR 0055 §3) rejoue aussi les révocations qui ne sont pas faites, après la même réservation de cinq minutes.

### 4. Le journal distingue ce qui est fait de ce qu'il faut faire

- Révocation faite : `warn`.
- Révocation laissée à la tâche planifiée par le webhook : `warn`.
- Remboursement partiel ou commande hors abonnement, et remboursement total sans abonnement à révoquer : `info`.
- Révocation que la tâche planifiée n'a pas pu faire : `error`, qui dit de révoquer à la main dans Polar.

Ce volet amende l'ADR 0050 §1 : un remboursement total fait dans le tableau de bord de Polar met aussi fin à l'abonnement. Les remboursements partiels et les litiges restent dans le tableau de bord. Il amende aussi le §3 : l'abonnement d'un espace finit aussi par le remboursement total d'une de ses commandes.

## Conséquences

### Positives

- Un remboursement total suffit : la personne remboursée n'est plus débitée, sans second geste.
- Un webhook rejoué ou une panne de Polar ne révoquent jamais deux fois, et ne perdent pas l'intention.

### Négatives

- Le webhook de production et celui du sandbox doivent être abonnés à `order.refunded`. Sans cet abonnement, un remboursement total laisse l'abonnement actif, comme avant.
- Un geste commercial du montant total d'une ancienne commande révoque l'abonnement en cours : pour garder l'abonnement, rembourser une partie seulement.
- Le rôle `app` reçoit `UPDATE` sur deux colonnes d'une nouvelle table (`revoked_at`, `settling_since`).
- Une révocation qui ne peut pas se faire journalise une erreur à chaque passage de la tâche planifiée, jusqu'au traitement à la main.

### Risques et mitigations

- **Révoquer un vrai client** : seule une commande au statut `refunded`, d'un abonnement enregistré et pas terminé, déclenche la révocation (§1). Les tests couvrent le remboursement partiel, puis complété, d'un abonnement payé par un propriétaire, et chaque événement qui n'est pas `order.refunded`.
- **Révoquer deux fois** : la clé de la table et la réservation sérialisent les exécutants, et Polar répond `AlreadyCanceledSubscription` à une seconde révocation, comptée comme faite.
- **Polar change le sens du statut `refunded`** : la version d'API est figée à 2027-01 (ADR 0050 §7), et dezyn lit la commande par un schéma à la frontière, limité à `id`, `status` et `subscription_id`.

## Notes d'implémentation

1. Migration `0031_space_refund_revocation` : la table, sans clé étrangère vers `space` (un espace orphelin peut être purgé, ADR 0052). `GRANT SELECT, INSERT, UPDATE ("revoked_at", "settling_since")` au rôle `app`.
2. Port `MerchantOfRecord` : la notification `order_refunded` ; la révocation réutilise `revokeNow` (ADR 0055).
3. `pnpm polar:production`, `pnpm polar:sandbox` et le runbook d'hébergement abonnent le webhook à `order.refunded`.

## Liens

- [ADR 0050](0050-polar-en-merchant-of-record-un-abonnement-par-espace-et-un-espace-gele-sans-perte-au-retour-en-free.md) — les remboursements à la main (§1), l'abonnement de l'espace (§3), l'ordre des événements (§4).
- [ADR 0055](0055-un-abonnement-paye-par-un-non-proprietaire-est-revoque-et-rembourse-automatiquement.md) — la révocation immédiate, la réservation et le rejeu, repris ici.
- [ADR 0052](0052-le-worker-de-purge-supprime-un-espace-orphelin-apres-la-fin-de-sa-periode-payee.md) — la purge d'un espace orphelin, que la nouvelle table ne bloque pas.
- [Remboursements de Polar](https://polar.sh/docs/features/refunds) et [`order.refunded`](https://polar.sh/docs/api-reference/webhooks/order.refunded).
