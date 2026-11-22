# 0050 — Polar en Merchant of Record, un abonnement par espace, et un espace gelé sans perte au retour en Free

- Statut : Accepté
- Date : 2026-11-22
- Décideurs : Muhammed Cavus
- Amende : ADR 0006 (§1, prix HT et abonnement par espace ; §4, pas de purge à la limite Free pour un espace gelé), ADR 0011 (§4, un espace gelé garde ses éditeurs, suspendus), ADR 0042 (§3, la limite d'un espace gelé est celle du plan Team)

## Contexte et problématique

Le plan Team existe dans le produit (ADR 0006, ADR 0011), mais personne ne peut y souscrire : la colonne `plan` d'un espace ne change jamais. dezyn n'encaisse aucun revenu, et une équipe qui veut travailler à plusieurs reste bloquée (spec #343).

Vendre un abonnement en ligne à des clients de tous pays oblige le vendeur à calculer, collecter et reverser la TVA ou la taxe de vente de chaque pays, et à émettre des factures conformes. Un _Merchant of Record_ vend à sa place et porte ces obligations. dezyn est développé par une seule personne.

Le retour au plan Free pose une seconde question. L'ADR 0006 §4 purge un espace à la limite de son plan, et l'ADR 0042 §3 le ramène à 90 % de cette limite. Un espace Team de plusieurs Go qui redevient Free serait purgé jusqu'à 450 Mo, et perdrait la quasi-totalité de son historique pour une carte expirée ou une résiliation. L'ADR 0011 §4 limite aussi un espace Free à un membre, alors que ses éditeurs y sont encore.

Le SDK Polar et le plugin `@polar-sh/better-auth` tournent tous deux dans le Worker de l'API ([spike du 2026-11-22](../spikes/2026-11-22-polar-dans-le-worker-de-l-api.md)). L'endpoint de webhook de la sandbox est réglé sur la version d'API Polar 2027-01.

Problématique : par quel prestataire et sous quelle forme un espace souscrit-il au plan Team, et que devient un espace qui redevient Free au-dessus des limites Free ?

## Facteurs de décision

- Ne pas porter la TVA mondiale, ni la facturation, avec une seule personne.
- Ne jamais confier une carte à dezyn.
- Payer espace par espace, sans toucher les autres espaces du payeur.
- Ne rien perdre au retour en Free : aucun projet, token ou entrée d'historique supprimé.
- Garder le stockage de chaque espace borné (ADR 0006).
- Le MCP n'est jamais bloqué pour le propriétaire (ADR 0006 §3).
- Pouvoir changer de prestataire sans toucher aux règles du domaine (ADR 0022).
- Un Worker qui reste léger (ADR 0034).

## Options envisagées

### Le prestataire de paiement

#### Option A — Polar, Merchant of Record

- Avantage : Polar vend à la place de dezyn, encaisse, calcule et reverse la TVA de chaque pays, gère l'autoliquidation d'un numéro de TVA de l'UE, et émet les factures.
- Avantage : un checkout et un portail client hébergés : la carte ne passe jamais par dezyn.
- Avantage : une sandbox complète, un SDK TypeScript qui tourne dans workerd (spike, a).
- Inconvénient : une commission d'environ 4 % + 0,40 $ par paiement, sur le montant TTC encaissé. À 34,99 € HT, le revenu net avoisine 33 € par mois et par espace.
- Inconvénient : un prestataire jeune.
- **Retenue.**

#### Option B — Stripe

- Avantage : le prestataire le plus éprouvé, avec la commission la plus basse.
- Inconvénient : dezyn reste le vendeur. Il porte l'inscription et les déclarations de TVA dans chaque juridiction, et la conformité de ses factures.
- **Écartée** : la TVA mondiale et la facturation coûtent plus à une personne seule que l'écart de commission.

### Ce que porte l'abonnement

#### Option A — L'abonnement appartient à l'espace et a un payeur

- Avantage : un espace se paie seul, et les autres espaces du même utilisateur ne changent pas (spec #343, story 26).
- Avantage : le plan reste porté par l'espace (ADR 0011 §1).
- Inconvénient : un payeur qui quitte l'espace laisse un abonnement qu'un autre propriétaire ne reprend pas.
- **Retenue.**

### Un espace qui redevient Free au-dessus des limites Free

#### Option A — Appliquer les limites Free, purge comprise (ADR 0006 §4)

- Avantage : aucune règle nouvelle.
- Inconvénient : l'espace perd son historique jusqu'à 450 Mo. Un impayé ou une résiliation détruit des données qu'un retour au plan Team ne rend pas.
- Inconvénient : les éditeurs d'un espace Free (ADR 0011 §4) doivent être retirés.
- **Écartée.**

#### Option B — Geler l'espace sans rien supprimer

- Avantage : rien n'est perdu, et l'espace repart tel quel au retour du plan Team.
- Avantage : le propriétaire continue de travailler, MCP compris.
- Inconvénient : un espace gelé garde jusqu'à 20 Go sans payer.
- **Retenue.**

### Le stockage d'un espace gelé

#### Option A — Purger à la limite Free (500 Mo)

- **Écartée** : c'est la perte que l'espace gelé évite.

#### Option B — Ne jamais purger un espace gelé

- Inconvénient : le stockage d'un espace gelé n'a plus de borne, contre l'ADR 0006.
- **Écartée.**

#### Option C — Purger à la limite Team (20 Go)

- Avantage : le stockage reste borné, à la valeur que l'espace atteignait déjà en Team.
- **Retenue.**

### L'intégration dans le Worker de l'API

#### Option A — Le plugin `@polar-sh/better-auth`

- Avantage : checkout, portail et webhooks en quelques lignes, sur l'auth existante (ADR 0008).
- Inconvénient : son endpoint `/auth/checkout` accepte n'importe quel `reference_id`, sans vérifier que l'appelant est propriétaire de l'espace (spike, a). Le plugin n'offre aucun crochet pour l'autoriser.
- Inconvénient : il fige l'API Polar en 2026-10, alors que l'endpoint de webhook est en 2027-01.
- Inconvénient : la facturation vit dans le module identity, hors d'un port, et le plugin appelle le SDK sans qu'une fausse passerelle puisse le remplacer en test.
- Inconvénient : +26,65 Kio gzip au bundle (spike, c).
- **Écartée.**

#### Option B — Le SDK `@polar-sh/sdk` seul, derrière un port

- Avantage : les routes de checkout et de portail sont des routes `/v1` qui autorisent le propriétaire comme les autres.
- Avantage : la version d'API se choisit par l'import (`@polar-sh/sdk/2027-01`), et les types suivent le format reçu.
- Avantage : `validateEvent` vérifie la signature Standard Webhooks par WebCrypto dans workerd (spike, b).
- Avantage : +3,76 Kio gzip au bundle.
- Inconvénient : dezyn écrit lui-même la route de webhook et la correspondance des événements.
- **Retenue.**

#### Option C — Appels HTTP directs et vérification Standard Webhooks à la main

- Avantage : aucune dépendance.
- Inconvénient : dezyn réécrit les types, les erreurs et la vérification de signature, que le SDK fournit et qui tournent dans workerd.
- **Écartée** : c'était l'option de repli si le SDK ne tournait pas dans le Worker, et il y tourne.

### La version d'API Polar

#### Option A — 2027-01, pour les requêtes et l'endpoint de webhook

- Avantage : la version qui devient courante le 1ᵉʳ janvier 2027, déjà réglée sur l'endpoint de la sandbox.
- Avantage : elle retire seulement des champs que dezyn ne lit pas (`user_id`, `user`, `price_id`, `price` d'un abonnement). La signature et les types d'événements ne changent pas (spike, constats).
- **Retenue.**

#### Option B — 2026-10, la version du plugin

- **Écartée** : elle devient ancienne en janvier 2027, et le plugin n'est pas retenu.

## Décision

### 1. Polar est le Merchant of Record de dezyn

Polar vend le plan Team à la place de dezyn, encaisse, calcule et reverse la taxe de chaque pays, et émet les factures. Le paiement passe par le checkout hébergé de Polar. Le payeur gère sa carte, ses factures et sa résiliation dans le portail client de Polar. Les remboursements et les litiges se traitent dans le tableau de bord de Polar.

Les previews et le développement utilisent la sandbox de Polar, et la production l'environnement de production. Le jeton d'accès, le secret de webhook, l'identifiant du produit Team et l'environnement (`sandbox` ou `production`) sont lus et validés par la configuration de l'API.

### 2. Le plan Team est un abonnement mensuel de 34,99 € HT par espace

Un seul produit Polar, « Team » : mensuel, prix fixe de 34,99 € HT par espace, sans engagement ni essai. Le plan Free sert d'essai. La taxe s'ajoute au prix HT selon le pays et le statut du client.

### 3. L'abonnement appartient à l'espace et a un payeur

- Le checkout porte `metadata.referenceId` = l'identifiant de l'espace. L'abonnement Polar le garde dans ses métadonnées.
- Le client Polar est l'utilisateur qui paie : son `external_id` est l'identifiant de l'utilisateur. C'est le **payeur** de l'espace.
- Seul un propriétaire de l'espace lance un checkout pour cet espace. Seul le payeur ouvre le portail client de l'espace ; les autres propriétaires voient qui paie et la date de renouvellement ou de fin, sans ouvrir le portail.
- L'abonnement d'un espace porte l'identifiant de l'abonnement Polar, le payeur, un statut (actif, résilié en fin de période, en retard de paiement, terminé) et la date de fin de la période en cours.
- Le plan de l'espace se déduit de son abonnement par une fonction pure : Team tant que l'abonnement n'est pas terminé, Free sinon.
- La colonne `plan` reste, comme valeur dérivée écrite dans la même transaction que l'abonnement.
- Quand le payeur quitte l'espace ou supprime son compte, dezyn résilie l'abonnement en fin de période et prévient les autres propriétaires. Un autre propriétaire souscrit à nouveau après la fin de la période.
- Chaque changement de plan d'un espace écrit une ligne d'audit : l'événement Polar, l'identifiant de l'abonnement, le plan avant et après. Ce n'est pas l'historique d'un projet (ADR 0025).

### 4. Les événements Polar fixent l'abonnement, dans l'ordre de Polar

- Un abonnement actif donne Team.
- Un abonnement résilié en fin de période garde Team jusqu'à sa révocation.
- Un abonnement en retard de paiement garde Team pendant les relances de Polar, avec un bandeau pour les propriétaires.
- Un abonnement révoqué ou terminé donne Free.
- Le statut Polar est un enum ouvert (ADR 0023). Une valeur inconnue ne change pas le plan, et elle est journalisée.

Chaque événement porte l'état complet de l'abonnement. Le traitement est idempotent, et il n'applique pas un état plus ancien que celui enregistré, d'après le `modified_at` de Polar. Un événement pour un espace inconnu est journalisé et accusé en 200.

### 5. Un espace Free au-dessus d'une limite Free est gelé, sans rien perdre

Un espace est **gelé** quand son plan est Free et qu'il dépasse au moins une limite Free : plus de 3 projets, plus de 500 Mo, ou plus d'un membre. Le gel est une règle pure du domaine, calculée à partir du plan, du nombre de projets, du stockage et du nombre de membres. Il n'est pas stocké.

Dans un espace gelé :

- aucun projet, token ni entrée d'historique n'est supprimé ;
- la création de projet et l'invitation restent refusées (`plan-required`) ;
- les éditeurs gardent leur appartenance, mais toute requête d'un éditeur sur l'espace, en HTTP comme en MCP, est refusée par le problème `space-frozen` (403) ;
- le propriétaire garde la lecture et l'écriture, MCP compris : le MCP n'est jamais bloqué pour lui (ADR 0006 §3).

Le gel se lève seul dès que l'espace repasse Team ou revient sous toutes les limites Free. Les éditeurs retrouvent alors leur accès, sans nouvelle invitation.

Ce volet amende l'ADR 0011 §4 : un espace Free gelé garde ses éditeurs, suspendus, jusqu'à la levée du gel.

### 6. La purge d'un espace gelé applique la limite Team

La purge ne ramène pas un espace gelé à la limite Free. Elle lui applique la limite du plan Team, 20 Go. Un espace gelé qui atteint 20 Go est purgé jusqu'à 90 % de cette limite (ADR 0042 §3), dans l'ordre des ADR 0016 et 0042 §1. Un espace Free qui n'est pas gelé reste sous 500 Mo par définition, et la purge à 500 Mo ne le concerne jamais.

Ce volet amende l'ADR 0006 §4 et l'ADR 0042 §3 pour les espaces gelés.

### 7. L'API intègre Polar par le SDK seul, en version 2027-01, derrière un port

- L'API dépend de `@polar-sh/sdk`, importé par `@polar-sh/sdk/2027-01` et ses fonctions autonomes. Elle ne dépend pas de `@polar-sh/better-auth`.
- Un port du domaine décrit ce que dezyn attend de son Merchant of Record : créer un checkout pour un espace et un payeur, ouvrir le portail d'un payeur, résilier un abonnement en fin de période. L'adaptateur Polar l'implémente. Une fausse passerelle l'implémente en test.
- Deux routes `/v1` renvoient l'URL du checkout, réservée aux propriétaires de l'espace, et celle du portail, réservée à son payeur.
- Les webhooks arrivent sur la route Hono `POST /webhooks/polar`, hors de `/auth` et de `/v1`. Leur format est le contrat de Polar, versionné par sa version d'API, pas celui de l'API de dezyn ; et Polar n'a ni session ni jeton, sa seule preuve est la signature, donc aucun middleware de `/v1/*` ne doit s'appliquer. La route lit le corps brut et le vérifie par `webhooks.validateEvent` avec le secret de l'endpoint. Une signature invalide reçoit 401, et un type d'événement inconnu 200, journalisé.
- Les requêtes du SDK et l'endpoint de webhook sont réglés sur la même version d'API Polar, 2027-01. Un changement de version est un changement d'import et de réglage d'endpoint, fait ensemble dans une même PR.

## Conséquences

### Positives

- dezyn n'a ni TVA à déclarer, ni facture à émettre, ni carte à protéger.
- Un impayé ou une résiliation ne détruit rien : l'espace repart tel quel au retour du plan Team.
- Une carte expirée ne bloque pas l'équipe pendant les relances de Polar.
- Le prestataire reste derrière un port : changer de Merchant of Record ne touche ni au plan ni au gel.
- Le Worker de l'API ne grossit que de 3,76 Kio gzip.

### Négatives

- La commission de Polar, environ 4 % + 0,40 $ par paiement, porte sur le montant TTC.
- Un espace gelé garde jusqu'à 20 Go sans payer.
- dezyn écrit et teste lui-même la route de webhook, la correspondance des statuts et l'ordre des événements, que le plugin aurait fournis en partie.
- Le transfert d'un abonnement à un autre propriétaire n'existe pas : au départ du payeur, l'espace redevient Free en fin de période, puis gelé s'il dépasse les limites Free.
- Les éditeurs d'un espace gelé perdent l'accès, sans y pouvoir rien.
- Un propriétaire qui n'est pas le payeur ne change ni la carte ni la résiliation : il s'adresse au payeur.

### Risques et mitigations

- **Polar disparaît ou change ses conditions** : l'adaptateur reste derrière un port, et le plan se déduit d'un abonnement propre à dezyn.
- **Un événement arrive en double ou dans le désordre** : le traitement est idempotent et n'applique pas un état plus ancien que celui enregistré (§4).
- **Polar change le format d'un événement** : la version est figée par l'import et par l'endpoint (§7). Le SDK ne valide pas la forme du corps, donc dezyn lit l'abonnement par un schéma à la frontière, limité aux champs qu'il utilise.
- **Le secret de webhook ou la clé de signature diffèrent de ce que le spike a vérifié** : `validateEvent` accepte le secret Standard Webhooks sous ses deux formes. Le premier événement reçu par une preview le confirme (spike, non vérifié).
- **Un propriétaire lance un checkout pour un espace qui n'est pas le sien** : la route `/v1` vérifie le rôle avant d'appeler le port (§7).
- **Un espace gelé reste gelé indéfiniment** : son stockage est borné à 20 Go (§6), et son propriétaire voit un bandeau qui explique le gel.

## Notes d'implémentation

1. Configuration de l'API : `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_TEAM_PRODUCT_ID`, `POLAR_SERVER` (`sandbox` ou `production`), validés comme les autres secrets. Le wizard `pnpm polar:sandbox` (#344) les met en place.
2. Domaine : les fonctions pures « plan d'un espace selon son abonnement » et « espace gelé selon ses limites ». Prior art : `storage-limit`, `project-limit`.
3. Stockage : l'abonnement de l'espace, la colonne `plan` dérivée dans la même transaction, la ligne d'audit d'un changement de plan.
4. Port du Merchant of Record et adaptateur Polar (`@polar-sh/sdk/2027-01`) :

   ```ts
   const client = createPolarCore({ accessToken, environment });
   const checkout = await createCheckouts(client)({
     products: [teamProductId],
     external_customer_id: payerId,
     metadata: { referenceId: spaceId },
     success_url: planUrl,
   });
   ```

5. Route `POST /webhooks/polar`. Le wizard de #344 et le runbook d'hébergement visent cette URL.
6. Routes `/v1` du checkout et du portail, `SpaceOutput` avec `subscription` (propriétaires seuls) et `frozen`.
7. Gel : refus `space-frozen` des éditeurs en HTTP et en MCP. La purge lit la limite Team pour un espace gelé : `history_maintainer` lit déjà `space`, `project` et `space_member` (ADR 0042 §7).
8. App web : page « Plan », retour du checkout, liens `plan_required`, bandeaux de retard de paiement et d'espace gelé.

## Liens

- [ADR 0006](0006-plans-free-et-team-mcp-complet-dans-tous-les-plans.md) — les plans Free et Team ; le §1 prend le prix HT par espace, le §4 ne purge pas un espace gelé à 500 Mo.
- [ADR 0008](0008-hono-pour-le-backend-better-auth-pour-l-authentification.md) — better-auth reste l'authentification, sans plugin Polar.
- [ADR 0011](0011-l-espace-possede-les-projets-et-porte-le-plan.md) — l'espace porte le plan ; le §4 garde les éditeurs d'un espace gelé, suspendus.
- [ADR 0016](0016-la-purge-d-un-espace-commence-par-le-projet-qui-consomme-le-plus.md) — l'ordre de la purge, inchangé pour un espace gelé.
- [ADR 0022](0022-architecture-hexagonale-a-coeur-fonctionnel-pour-le-backend.md) — le Merchant of Record derrière un port.
- [ADR 0023](0023-reponses-ouvertes-enums-ouverts-et-unions-extensibles-dans-les-contrats.md) — le statut Polar, enum ouvert.
- [ADR 0034](0034-l-api-est-servie-par-un-worker-cloudflare.md) — le Worker de l'API, où tourne le SDK.
- [ADR 0042](0042-la-purge-de-l-historique-tourne-dans-un-worker-planifie-et-ramene-l-espace-a-90-pourcent-de-sa-limite.md) — la purge à 90 % ; le §3 prend la limite Team pour un espace gelé.
- [Spike du 2026-11-22](../spikes/2026-11-22-polar-dans-le-worker-de-l-api.md) — le SDK et le plugin dans workerd, la version 2027-01, la taille du bundle.
