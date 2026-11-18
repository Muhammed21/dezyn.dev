# 0046 — L'app web suit un projet par un signal WebSocket, servi par un Durable Object par projet dans un Worker `dezyn-realtime`

- Statut : Accepté
- Date : 2026-11-18
- Décideurs : Muhammed Cavus

## Contexte et problématique

L'app web est une SPA React qui lit ses données avec TanStack Query (ADR 0037). React Query recharge à l'ouverture d'une page et au retour du focus, sans polling. Les écritures de l'IA arrivent par le MCP, depuis un autre outil : un membre qui garde l'app web ouverte à côté ne voit rien bouger. Deux relecteurs du même lot peuvent aussi se marcher dessus, et le second reçoit `409 already_reviewed`.

L'API est un Worker Cloudflare (ADR 0034), sur le plan Workers Free (ADR 0043). Un Worker est sans état : une requête ne voit pas les événements des autres requêtes.

- Les Durable Objects sont disponibles en Free, avec le stockage SQLite seulement, et 100 000 requêtes par jour.
- Une WebSocket tenue par l'API en hibernation d'un Durable Object n'est pas facturée en durée au repos. Un message sortant n'est pas facturé ; un message entrant compte pour 1/20 de requête.
- Cloudflare ne génère pas de preview URL (version URL) pour un Worker qui implémente un Durable Object (documentation « Previews », limitations). Les previews de l'API reposent sur ces URLs (ADR 0045). Le cas d'un Worker qui se lie seulement au Durable Object d'un autre Worker (`script_name`) n'est pas documenté.
- PostgreSQL `LISTEN`/`NOTIFY` est exclu : le Worker passe par Hyperdrive, sans connexion persistante.

Problématique : comment l'app web apprend-elle qu'un projet a changé, par quel transport, et où vit l'état des connexions sans casser les previews de l'API ?

## Facteurs de décision

- Le membre voit les écritures de l'IA et des autres membres sans recharger.
- Les autorisations et les contrats restent à un seul endroit : les routes REST de `/v1` (ADR 0044).
- Le plan Workers Free suffit, et Neon n'est pas tenu éveillé par des lectures inutiles.
- Les previews de l'API restent en place (ADR 0045).
- Un signal perdu ne corrompt rien, et une écriture ne dépend pas de la réussite du signal.
- Chaque côté se teste sans l'infrastructure de Cloudflare, sauf la classe du Durable Object elle-même.

## Options envisagées

### Le transport

#### Option A — Polling ciblé de React Query

- Avantage : rien à construire côté serveur ; un `refetchInterval` sur les pages concernées.
- Inconvénient : chaque onglet ouvert interroge l'API, donc Neon reste éveillé.
- Inconvénient : l'écran reste en retard d'un intervalle.

**Écartée.**

#### Option B — Server-Sent Events servis par le Worker de l'API

- Inconvénient : un Worker sans état ne reçoit pas les événements des autres requêtes ; il lui faudrait un relais.

**Écartée.**

#### Option C — Server-Sent Events servis par un Durable Object

- Inconvénient : le Durable Object reste actif tant que le flux est ouvert, et sa durée est facturée ; SSE n'a pas d'hibernation.

**Écartée.**

#### Option D — WebSocket servie par un Durable Object, en hibernation

- Avantage : pas de durée facturée au repos, et les messages sortants ne sont pas facturés.
- Avantage : un Durable Object par projet réunit les connexions de ce projet et reçoit les signaux de toutes les requêtes.
- Inconvénient : une classe de Durable Object à tester dans workerd.

**Retenue.**

### Le contenu du message

#### Option E — Pousser les données dans le message

- Avantage : le client n'a pas de relecture à faire.
- Inconvénient : les autorisations et les contrats des routes REST se dupliquent dans le chemin du signal.

**Écartée.**

#### Option F — Un signal sans données

- Avantage : le client relit par les routes REST existantes, avec leurs autorisations et leurs contrats.
- Avantage : un signal perdu ou en double ne coûte qu'une relecture.
- Inconvénient : une requête REST de plus par signal et par client.

**Retenue.**

### Le Worker du Durable Object

#### Option G — Le Durable Object dans `dezyn-api`

- Avantage : un seul Worker à déployer.
- Inconvénient : `dezyn-api` implémente un Durable Object, et Cloudflare ne lui génère plus de preview URL : les previews de l'API (ADR 0045) cassent.

**Écartée.**

#### Option H — Le Durable Object dans un Worker séparé, `dezyn-realtime`

- Avantage : `dezyn-api` ne fait que s'y lier et garde ses preview URLs, sous réserve de vérification.
- Inconvénient : un Worker de plus à configurer et à déployer avant `dezyn-api`.

**Retenue.**

## Décision

### 1. Le serveur pousse un signal, pas des données

Le message est `{"type":"changed","topics":[...]}`. Les sujets sont `proposals`, `history` et `tokens`. À la réception, l'app web invalide les requêtes React Query des sujets reçus et relit par les routes REST de `/v1`.

### 2. Un Durable Object par projet, en hibernation

Chaque projet a son Durable Object, obtenu par `getByName(projectId)`. Il tient les WebSockets de ses abonnés par l'API WebSocket en hibernation, et diffuse chaque signal reçu à toutes ses connexions. Il ne stocke rien.

### 3. Le Durable Object vit dans le Worker `dezyn-realtime`

`dezyn-realtime` est un paquet à part, `apps/realtime`, avec son `wrangler.jsonc`, sur le modèle de `apps/preview-router` : le code du Durable Object a besoin des types workerd, incompatibles avec les types Node du tsconfig de l'API. `dezyn-api` se lie à sa classe par `script_name` et n'implémente aucun Durable Object.

### 4. `GET /v1/projects/:projectId/events` ouvre l'abonnement

La route vit dans `dezyn-api`. Elle exige, dans cet ordre :

1. une requête sans `Upgrade: websocket` répond 426, sans toucher au Durable Object ;
2. le cookie de session (ADR 0044 §1) ;
3. une origine égale à celle de `WEB_URL`, bien que la méthode soit `GET`, contre le détournement de WebSocket entre sites (ADR 0044 §2) ;
4. le droit `space.read` sur l'espace du projet ;
5. puis la requête est transmise au Durable Object du projet.

### 5. Le signal part après le commit, au mieux

Les cas d'usage appellent le port `ProjectSignals` (`changed({ projectId, topics })`) après la transaction. Un échec du signal est journalisé et ne change ni le résultat ni la réponse de l'écriture.

### 6. Les adapters de `ProjectSignals`

- Production : le Durable Object de `dezyn-realtime`, lié par le binding `PROJECT_ROOMS`.
- Preview : celui de `dezyn-realtime-preview`, l'environnement `preview` du même `wrangler.jsonc`. Le code d'une PR ne touche jamais le Worker de production ; ce Worker est commun à toutes les PRs, et la dernière publiée l'emporte.
- Tests d'intégration Node : un enregistreur en mémoire, qui affirme quel appel signale quel sujet pour quel projet.
- API Node locale (`pnpm dev`) : aucun signal.

### 7. Côté app web, le port `ProjectEvents`

Le port `ProjectEvents` abonne une page à un projet et lui remet les sujets reçus. Son adapter utilise la WebSocket du navigateur ; les tests de Vitest Browser Mode utilisent un faux en mémoire.

### 8. La classe du Durable Object se teste dans workerd

Elle se teste dans workerd avec `@cloudflare/vitest-plugin` (le nouveau nom de `@cloudflare/vitest-pool-workers`), dans la configuration Vitest de `apps/realtime`.

## Conséquences

### Positives

- Le membre voit les écritures de l'IA et des autres membres sans recharger.
- Les autorisations et les contrats restent dans les routes REST ; le signal n'expose que des noms de sujets.
- Le temps réel tient dans le plan Workers Free, sans durée facturée au repos.
- Les previews de `dezyn-api` restent en place si la liaison par `script_name` le permet.

### Négatives

- Un membre retiré garde sa connexion jusqu'à la prochaine coupure. Il ne reçoit que des sujets sans données, et chaque relecture lui répond 404.
- Pas de temps réel avec `pnpm dev`.
- Un nouveau Worker, `dezyn-realtime`, se déploie avant `dezyn-api` dans `deploy.yml` ; `dezyn-realtime-preview` se déploie avant chaque version de preview dans `preview.yml`, depuis le bundle de la CI de la PR.
- Une configuration de test workerd en plus.
- Chaque signal coûte une relecture REST par client abonné.

### Risques et mitigations

- **Une preview URL de `dezyn-api` liée au Durable Object d'un autre Worker** : la documentation ne le dit pas. La première tranche le vérifie sur `pr-N-preview.dezyn.dev` avant tout le reste. Si ça échoue, le repli est de passer par le Worker routeur des previews (ADR 0045) ou de servir les WebSockets par `dezyn-realtime` directement.
- **Le cookie part avec la poignée de main WebSocket** : `app.dezyn.dev` et `api.dezyn.dev` forment un seul site, et le cookie `SameSite=Lax` part. Le contrôle de l'origine de la route (§4) s'applique quand même à ce `GET`.
- **Un signal qui n'arrive pas** : l'écriture n'en dépend pas, et le rechargement au focus de React Query reste le filet.

## Notes d'implémentation

1. Tranche 1.1 : `dezyn-realtime` et son Durable Object, la route `GET /v1/projects/:projectId/events`, le port `ProjectSignals` appelé par `write_tokens` avec le sujet `proposals`, et le déploiement de `dezyn-realtime` avant `dezyn-api` dans `deploy.yml` et `preview.yml`. La vérification de la preview URL passe en premier.
2. Tranche 1.2 : `ProjectEvents` dans l'app web, et l'invalidation des clés `proposal-batches` et `proposal-batch` à la réception de `proposals`.
3. Les autres producteurs et les sujets `history` et `tokens` suivent, story par story.

## Liens

- [ADR 0034](0034-l-api-est-servie-par-un-worker-cloudflare.md) — le Worker de l'API, qui se lie au Durable Object.
- [ADR 0037](0037-l-app-web-est-une-spa-react-servie-en-statique-par-cloudflare.md) — la SPA et TanStack Query, qui relisent à chaque signal.
- [ADR 0042](0042-la-purge-de-l-historique-tourne-dans-un-worker-planifie-et-ramene-l-espace-a-90-pourcent-de-sa-limite.md) — `dezyn-purge`, modèle du Worker séparé.
- [ADR 0043](0043-le-worker-de-purge-verifie-le-schema-et-se-deploie-sans-attendre-le-plan-workers-paid.md) — le plan Workers Free.
- [ADR 0044](0044-l-app-web-appelle-v1-avec-le-cookie-de-session-controle-par-l-origine-et-partage-les-contrats-de-l-api.md) — le cookie de session et le contrôle de l'origine de la route d'abonnement.
- [ADR 0045](0045-l-app-web-est-servie-sur-app-dezyn-dev-et-ses-previews-sous-dezyn-dev-par-un-worker-routeur.md) — les previews de l'API que le Worker séparé préserve, et le repli par le routeur.
- [ADR 0022](0022-architecture-hexagonale-a-coeur-fonctionnel-pour-le-backend.md) — les ports `ProjectSignals` et `ProjectEvents` et leurs adapters.
