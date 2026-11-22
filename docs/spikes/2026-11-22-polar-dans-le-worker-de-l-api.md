# Spike — Polar dans le Worker de l'API

- Date : 2026-11-22
- Origine : spec #343, § Décisions d'implémentation : « Un spike doit d'abord vérifier que le SDK Polar et le plugin tournent dans le Worker de l'API (Cloudflare Workers). » ; ticket #345.
- Durée : une session
- Code du spike : jetable, non versionné. Les extraits utiles sont reproduits ici.

## Question

Le SDK Polar et le plugin `@polar-sh/better-auth` tournent-ils dans le Worker de l'API (workerd, `nodejs_compat`) pour créer un checkout sandbox du produit Team qui porte l'espace, ouvrir le portail client, et vérifier la signature d'un webhook dont l'endpoint est réglé sur la version d'API Polar 2027-01 ? Quelle intégration retenir : le plugin, le SDK seul, ou des appels HTTP directs avec une vérification Standard Webhooks à la main ?

## Réponse courte

Les deux tournent dans workerd, sans import Node nouveau. Le spike recommande le **SDK seul**, importé par sa version `@polar-sh/sdk/2027-01`, derrière un port du domaine. Le plugin n'est pas retenu.

- **a. Checkout et portail** : prouvés contre la sandbox, par le SDK comme par le plugin. Le checkout du produit Team porte `metadata.referenceId` = l'espace et `external_customer_id` = le payeur, en EUR, 34,99 € HT (`net_amount` 3499). Le portail renvoie une URL `sandbox.polar.sh`.
- **b. Signature d'un webhook au format 2027-01** : prouvée. `validateEvent` vérifie la signature par WebCrypto, rejette une signature fausse, un corps modifié et un horodatage de plus de 5 minutes. Il ne valide pas la forme du corps : un corps 2027-01 passe tel quel, même par le plugin, qui est construit sur 2026-10.
- **c. Plugin dans le better-auth de l'API** : il s'intègre sous `basePath: "/auth"`. `tsc` passe, et le bundle gzip passe de 792,61 à 819,26 Kio (+26,65 Kio). Avec le SDK seul, il passe à 796,37 Kio (+3,76 Kio).

Le plugin n'est pas retenu pour trois raisons :

- son endpoint `/auth/checkout` accepte n'importe quel `reference_id` sans vérifier que l'appelant est propriétaire de l'espace ;
- il fige l'API Polar en 2026-10 ;
- il loge la facturation dans le module identity, hors d'un port qu'une fausse passerelle peut remplacer en test.

La version 2027-01 ne gêne pas l'intégration : elle retire des champs que dezyn ne lit pas, et ne change ni la signature ni les types d'événements.

## Montage

- macOS (Darwin 25.6.0), Node 22.23.2, pnpm 11.25.0.
- `wrangler` 4.152.0 (workerd `1.20261019.1`), `wrangler dev` en local, `compatibility_date: "2026-10-20"`, `compatibility_flags: ["nodejs_compat"]` : la configuration de `apps/api/wrangler.jsonc`.
- `@polar-sh/sdk` 1.3.2, `@polar-sh/better-auth` 2.1.5 (pair : `@polar-sh/sdk ^1.3.1`, `better-auth ^1.7.0`), `better-auth` 1.7.7, `zod` 4.6.7 : les versions publiées le jour du spike, et celles de l'API pour better-auth et zod.
- Sandbox Polar de #344, lue depuis le `.env` du dépôt par `wrangler dev --env-file` (jeton d'organisation, identifiant du produit Team, secret de webhook `whsec_…`). Aucune valeur n'est recopiée ici.
- Deux montages jetables, hors du dépôt :
  - un Worker de spike, avec trois routes SDK (`/sdk/checkout`, `/sdk/portal`, `/sdk/webhook`) et un better-auth sous `/auth` muni du plugin (`checkout`, `portal`, `webhooks`), sur la base mémoire de better-auth ;
  - une copie du dépôt, où le plugin est branché dans `identityAuthOptions` puis, à la place, le SDK seul, pour mesurer le bundle avec la commande de la CI : `wrangler deploy --env preview --dry-run`.

## Constats

### La version 2027-01

L'en-tête `Polar-Version` choisit la version d'une requête. La version d'un webhook est un réglage de l'endpoint (`api_version`). Le SDK fige la version par son chemin d'import : `@polar-sh/sdk/2026-10`, `@polar-sh/sdk/2027-01`. 2027-01 devient la version courante le 1ᵉʳ janvier 2027 ([changelog de l'API](https://polar.sh/docs/changelog/api), [versionnement](https://polar.sh/docs/api-reference/versioning)).

Ce que 2027-01 change pour dezyn :

- **Abonnements** : `user_id`, `user`, `price_id` et `price` disparaissent, au profit de `customer_id`, `customer` et `prices`. Les retraits valent aussi pour les corps de webhook.
- **Checkouts** : `customer_external_id` devient `external_customer_id`, et `subtotal_amount` devient `net_amount`.
- **Prix** : `type` et `recurring_interval` disparaissent des réponses de prix, et le schéma des prix récurrents hérités sort de l'union.
- **Inchangé** : `metadata`, `status`, `current_period_end`, `cancel_at_period_end`, `modified_at`, `customer.external_id`, les en-têtes et la signature.

Dans le SDK 1.3.2, le type `Subscription` de 2026-10 n'a déjà plus `price_id` ni `user_id`. Entre 2026-10 et 2027-01, il ne diffère que par `started_at` (non nul en 2027-01) et `prices` (sans prix hérité). Les deux versions connaissent le même ensemble de 41 types d'événements, dont `subscription.past_due`, `subscription.uncanceled` et `subscription.revoked`. Le statut d'un abonnement est un enum ouvert de 9 valeurs : `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused` et `trial_ended`.

Le plugin 2.1.5 importe exclusivement `@polar-sh/sdk/2026-10`, pour ses appels comme pour ses webhooks. Ses requêtes partent donc en 2026-10, et ses types d'événements décrivent des corps 2026-10, alors que l'endpoint en livre en 2027-01.

Depuis la version 2026-04, Polar signe en Standard Webhooks les endpoints dont le secret a été généré après le 8 septembre 2026. Le secret se donne tel quel à une bibliothèque Standard Webhooks.

### a. Checkout et portail

SDK 2027-01 dans workerd :

```ts
const client = createPolarCore({ accessToken, environment: "sandbox" });
const created = await createCheckouts(client)({
  products: [teamProductId],
  external_customer_id: payerId,
  metadata: { referenceId: spaceId },
  success_url: `${base}/spaces/${spaceId}/plan?checkout={CHECKOUT_ID}`,
});
```

```text
GET /sdk/checkout?space=space-spike-345
{"checkoutHost":"sandbox.polar.sh","status":"open","metadata":{"referenceId":"space-spike-345"},
 "externalCustomerIdMatches":true,"productMatches":true,"currency":"eur","netAmount":3499}
GET /sdk/portal
{"portalHost":"sandbox.polar.sh","hasToken":true}
```

Le checkout est relu par `getCheckouts` : Polar garde la métadonnée. La session client (`createCustomerSessions`, par `external_customer_id`) exige que le client Polar existe. Le checkout ne crée le client qu'une fois payé. Le spike crée donc le client avant (`createCustomers`).

Polar refuse l'email d'un client dont le domaine ne reçoit pas d'email (422, `The domain name example.com does not accept email`). `dezyn.dev` est refusé pour la même raison. Un test de contrat contre la sandbox doit utiliser un domaine qui reçoit des emails.

Plugin dans workerd, sous `/auth`, avec une session better-auth :

```text
POST /auth/sign-up/email                                  -> 200, cookie de session
POST /auth/checkout {"products":"<Team>","reference_id":"space-not-mine-999","redirect":false}
  -> {"url":"https://sandbox.polar.sh/checkout/polar_c_…","redirect":false}
POST /auth/customer/portal {"redirect":false}
  -> {"url":"https://sandbox.polar.sh/dezyn/portal?customer_session_token=…&email=…","redirect":false}
POST /auth/checkout sans session                           -> 401
```

Le checkout du plugin a été accepté pour `space-not-mine-999`, un espace qui n'existe pas. Le plugin n'offre aucun crochet pour autoriser le `reference_id`. Le portail n'a fonctionné qu'avec `createCustomerOnSignUp: true` : le plugin crée alors un client Polar à chaque inscription, met à jour son email et son nom, et le supprime avec le compte. L'URL du portail porte l'email du client en clair.

### b. Signature d'un webhook au format 2027-01

Le corps envoyé est un `subscription.active` construit sur le type `Subscription` de 2027-01 : sans `price_id`, avec `metadata.referenceId` et `customer.external_id`. Il est signé en Standard Webhooks (`v1,` HMAC-SHA256 de `id.timestamp.corps`) avec le secret de la sandbox.

```text
/sdk/webhook           signé, clé Standard Webhooks (base64)  -> 200 {"ok":true,"type":"subscription.active"}
/sdk/webhook           signé, secret brut en UTF-8             -> 200 {"ok":true,"type":"subscription.active"}
/sdk/webhook           signature fausse                        -> 401 PolarWebhookVerificationError
/sdk/webhook           horodatage de 10 minutes                -> 401 PolarWebhookVerificationError
/sdk/webhook           corps modifié après signature           -> 401 PolarWebhookVerificationError
/sdk/webhook           type inconnu, signé                     -> 400 PolarWebhookUnknownTypeError
/auth/polar/webhooks   signé, clé Standard Webhooks (base64)  -> 200 {"received":true}
/auth/polar/webhooks   signé, secret brut en UTF-8             -> 200 {"received":true}
/auth/polar/webhooks   signature fausse                        -> 403 No matching signature found
/auth/polar/webhooks   horodatage de 10 minutes                -> 403 Message timestamp too old
/auth/polar/webhooks   corps modifié après signature           -> 403 No matching signature found
/auth/polar/webhooks   type inconnu, signé                     -> 200 {"received":true}
reçu : type subscription.active, referenceId space-spike-345, external_id user-spike-345,
       status active, price_id absent
```

Les codes 401 et 400 des routes `/sdk/…` sont ceux que le Worker de spike choisit. Le plugin, lui, répond 403 à une signature invalide, 400 à un corps illisible et 500 quand le traitement échoue.

`validateEvent` (`webhooks-*.mjs` du SDK) n'emploie que `crypto.subtle` et `atob`. Il accepte deux clés : le secret en UTF-8, et le secret décodé de base64 après le préfixe `whsec_`. Il vérifie l'horodatage à ±300 secondes, puis renvoie le JSON tel quel, sans schéma. Un type inconnu lève `PolarWebhookUnknownTypeError`.

### c. Le plugin dans le better-auth de l'API

Branchement dans la copie de `apps/api/src/modules/identity/infrastructure/better-auth.ts`, avant `oauthProvider` :

```ts
polar({
  client: createPolarCore({ accessToken, environment: "sandbox" }), // @polar-sh/sdk/2026-10
  createCustomerOnSignUp: false,
  use: [
    checkout({ authenticatedUsersOnly: true, successUrl: "/plan" }),
    portal(),
    webhooks({ secret, onPayload: async () => {} }),
  ],
}),
```

| Variante de `dezyn-api` (`--env preview --dry-run`)       | Total     | gzip       | Écart gzip |
| --------------------------------------------------------- | --------- | ---------- | ---------- |
| `main` (eb9b281)                                          | 4 527 Kio | 792,61 Kio | —          |
| Plugin dans `identityAuthOptions`                         | 4 701 Kio | 819,26 Kio | +26,65 Kio |
| SDK seul (checkout, session client, abonnement, webhooks) | 4 545 Kio | 796,37 Kio | +3,76 Kio  |

- `tsc --noEmit` passe avec le plugin branché.
- Les imports `node:` du bundle restent les mêmes dans les trois variantes : `node:async_hooks`, `node:crypto`, `node:http` et `node:url`. Le SDK n'importe `node:timers/promises` que pour son module de mesure d'usage, que le tree-shaking retire.
- Le plugin ajoute ses crochets `databaseHooks.user` (création, mise à jour, suppression) à ceux de l'API. Ils n'agissent qu'avec `createCustomerOnSignUp` ou la synchronisation d'organisations.
- Dans le Worker de spike, `memoryAdapter` importé de `better-auth/adapters/memory` vaut `undefined` après le bundle esbuild (`TypeError: memoryAdapter is not a function`) : better-auth importe aussi ce module dynamiquement, et esbuild en fait un module à initialisation paresseuse. L'API utilise l'adaptateur Drizzle et n'est pas concernée. Le spike a contourné le problème avec la base mémoire par défaut de better-auth.

## Recommandation

1. Intégrer Polar par le SDK seul, importé par `@polar-sh/sdk/2027-01` et ses fonctions autonomes (`createCheckouts`, `createCustomerSessions`, `createCustomers`, `getStateExternalCustomers`, `updateSubscriptions`, `webhooks.validateEvent`), dans un adaptateur derrière un port du domaine.
2. Exposer le checkout et le portail par deux routes `/v1` réservées aux propriétaires, qui vérifient le rôle avant d'appeler le port, et posent `metadata.referenceId` = l'espace et `external_customer_id` = l'utilisateur.
3. Recevoir les webhooks sur une route Hono qui lit le corps brut, appelle `validateEvent` et répond 401 à une signature invalide. Un type d'événement inconnu est accusé en 200 et journalisé.
4. Régler les requêtes et l'endpoint de webhook sur la même version, 2027-01. Lire l'abonnement par les champs que 2027-01 garde (`id`, `status`, `metadata.referenceId`, `customer.external_id`, `current_period_end`, `cancel_at_period_end`, `ended_at`, `modified_at`), et traiter son `status` comme un enum ouvert.
5. Ouvrir le portail sur le client Polar du payeur de l'espace, que le paiement du checkout a créé avec son `external_id`. Ne créer aucun client Polar à l'inscription.
6. Ne pas ajouter `@polar-sh/better-auth`.

## Ce que le spike n'a pas vérifié

- **Un webhook signé par Polar lui-même.** L'endpoint de la sandbox vise une preview, et le jeton n'a pas de scope webhooks. Le spike a signé les corps lui-même, avec le vrai secret et selon Standard Webhooks. Le premier événement réel reçu par une preview doit confirmer la clé.
- **Le paiement d'un checkout.** Aucun abonnement réel n'a été créé : le corps `subscription.active` est construit sur le type 2027-01 du SDK, pas capturé. Le premier abonnement payé par carte de test doit être comparé à ce corps.
- **Le comportement en production** : déploiement réel, limite de CPU du plan Workers Free et temps de réponse de l'API Polar depuis Cloudflare.
- **L'ordre et la répétition des événements**, que traite l'implémentation (spec #343).
