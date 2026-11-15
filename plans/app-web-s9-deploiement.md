# Plan : App web S9, déployer l'app web avec ses previews

**Issue** : #211 (Linear DEZ-107 si synchronisée)
**Statut** : Actif

## But

L'app web est servie sur `app.dezyn.dev`, et chaque PR publie une preview de l'app web qui se connecte à l'API de preview de la même PR (ADR 0037, ADR 0044).

## Décisions

- L'apex `dezyn.dev` garde sa landing. L'app web de production est servie sur `app.dezyn.dev`. `WEB_URL` de production devient `https://app.dezyn.dev` : CORS, contrôle d'`Origin`, `trustedOrigins` et liens des emails suivent. `app.dezyn.dev` et `api.dezyn.dev` restent le même site, donc le cookie `SameSite=Lax` passe. L'ADR 0037 §2 est amendé.
- Les previews vivent sous `dezyn.dev`, pas sur `workers.dev`, qui est un suffixe public : deux URLs `workers.dev` sont deux sites, et le cookie ne passerait pas entre elles.
  - App web de la PR N : `https://pr-N-preview.dezyn.dev`.
  - API de la PR N : `https://pr-N-api-preview.dezyn.dev`.
  - Un Worker routeur `dezyn-preview-router`, déployé depuis `main` sur la route `*-preview.dezyn.dev/*`, relaie chaque hôte vers l'alias `workers.dev` de la version de preview correspondante (`pr-N-dezyn-web-preview…` et `pr-N-dezyn-api-preview…`). Un autre hôte répond 404.
  - Le motif de la route ne commence que par `*` (Cloudflare refuse un joker au milieu) et ne touche que les hôtes qui finissent par `-preview.dezyn.dev`. Il n'atteint donc ni `api.dezyn.dev`, ni `app.dezyn.dev`, ni la landing.
- L'API de preview prend `BETTER_AUTH_URL=https://pr-N-api-preview.dezyn.dev` et `WEB_URL=https://pr-N-preview.dezyn.dev`. Les redirections de better-auth et le parcours OAuth du MCP de preview passent donc par l'hôte `dezyn.dev`.
- L'app web est construite par la CI de la PR avec `VITE_API_URL` de sa cible. Le workflow de preview ne fait que téléverser le build, sans exécuter le code de la PR dans le contexte de `main` (même règle que pour le bundle de l'API).
- Les réglages Cloudflare (DNS, plan, permissions du jeton de la CI) sont faits par l'utilisateur, d'après la liste de chaque tranche.

## Critère d'acceptation (#211)

- [ ] Une PR publie une preview qui se connecte à l'API de preview.

## Tranches

Chaque tranche suit RED, GREEN, MUTATE, KILL MUTANTS, REFACTOR pour son code (Worker routeur, scripts de vérification). La configuration et les workflows sont vérifiés par un `--dry-run` de wrangler et par un contrôle après déploiement.

### Tranche 1 : l'app web est servie en production sur `app.dezyn.dev`

**Valeur** : un membre ouvre `https://app.dezyn.dev`, se connecte et voit ses espaces.
**Chemin** :

- `apps/web/wrangler.jsonc` déclare le Worker `dezyn-web` : `assets` sur `./dist`, `not_found_handling: "single-page-application"`, custom domain `app.dezyn.dev`, sans script.
- La CI construit l'app web avec `VITE_API_URL=https://api.dezyn.dev`.
- `deploy.yml` déploie `dezyn-web` après l'API, puis vérifie qu'une adresse profonde (`/espaces/x`) renvoie la page de l'app.
- `WEB_URL` de production passe à `https://app.dezyn.dev`.
- Un ADR amende 0037 §2 et note la décision sur les previews.

**Réglages Cloudflare avant la tranche** : aucun enregistrement DNS existant sur `app.dezyn.dev`, et un jeton de la CI qui peut créer un custom domain sur la zone (déjà le cas pour `api.dezyn.dev`).

### Tranche 2 : l'API de preview de chaque PR répond sur `pr-N-api-preview.dezyn.dev`

**Valeur** : la preview de l'API a une adresse sous `dezyn.dev`, prête pour le cookie de l'app web.
**Chemin** :

- Le Worker routeur (fonction pure `upstreamOf(host)`, puis relais de la requête entière : méthode, en-têtes, corps, `Set-Cookie` de la réponse) est testé en TDD et déployé depuis `main`.
- `preview.yml` passe `BETTER_AUTH_URL` et `WEB_URL` aux hôtes `dezyn.dev`, vérifie `/health` sur `https://pr-N-api-preview.dezyn.dev` et l'indique dans le commentaire de preview.

**Réglages Cloudflare avant la tranche** : un enregistrement DNS `*` proxifié sur `dezyn.dev` (les enregistrements explicites gardent la priorité) et le droit « Workers Routes : Edit » pour le jeton de la CI.

### Tranche 3 : chaque PR publie une preview de l'app web connectée à son API de preview

**Valeur** : un relecteur ouvre `https://pr-N-preview.dezyn.dev`, se connecte et parcourt la PR comme en production.
**Chemin** :

- La CI de la PR construit l'app web avec `VITE_API_URL=https://pr-N-api-preview.dezyn.dev`.
- `preview.yml` téléverse le build dans `dezyn-web-preview` sous l'alias `pr-N`.
- Le contrôle après téléversement vérifie que la page répond, puis que le préflight CORS de l'API de preview autorise l'origine de la preview avec `credentials`.
- Le commentaire liste les URL de l'app web et de l'API.
- Je vérifie une fois dans un vrai navigateur : inscription, connexion, puis liste des espaces sur la preview.

## Avant chaque PR

1. Stryker sur le code modifié.
2. Évaluation du refactoring.
3. `pnpm lint`, `pnpm check-types`, tests.

---

_Supprimer ce fichier quand le plan est terminé._
