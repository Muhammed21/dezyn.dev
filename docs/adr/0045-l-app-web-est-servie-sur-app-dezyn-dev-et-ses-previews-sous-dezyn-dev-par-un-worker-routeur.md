# 0045 — L'app web est servie sur `app.dezyn.dev`, et ses previews sous `dezyn.dev` par un Worker routeur

- Statut : Proposé
- Date : 2026-11-14
- Décideurs : Muhammed Cavus
- Amende : ADR 0037 (§2 : l'hôte de l'app web ; risques : les previews sur `workers.dev`)

## Contexte et problématique

L'ADR 0037 sert l'app web sur `dezyn.dev`, par les fichiers statiques d'un Worker, avec une version de preview par PR. L'API répond sur `api.dezyn.dev`, et le cookie de session `SameSite=Lax` passe entre les deux, parce qu'ils forment un seul site (ADR 0037 §3, ADR 0044).

Deux faits changent la donne.

- L'apex `dezyn.dev` sert une landing, qui reste en place.
- Les previews de l'API répondent sur `pr-<N>-dezyn-api-preview.<compte>.workers.dev` (ADR 0034). `workers.dev` est un suffixe public : une preview de l'app web et une preview de l'API y seraient deux sites, et le cookie ne passerait pas entre elles. L'ADR 0037 laissait ce risque ouvert, avec deux pistes : un proxy même-origine ou des sous-domaines de `dezyn.dev`.

Problématique : sur quel hôte servir l'app web, et comment une preview de l'app web parle-t-elle à l'API de preview de sa PR ?

## Facteurs de décision

- La landing garde l'apex `dezyn.dev`.
- L'app web et l'API doivent rester un seul site, en production comme en preview, pour que le cookie `SameSite=Lax` passe.
- Une preview doit éprouver le même chemin que la production : cookie entre sous-domaines, CORS de `WEB_URL` et contrôle d'`Origin` (ADR 0044).
- Le circuit actuel des previews de l'API (versions téléversées sous un alias `pr-<N>`, ADR 0034) reste en place.
- Peu d'infrastructure à tenir.

## Options envisagées

### L'hôte de l'app web en production

#### Option A — `app.dezyn.dev`

- Avantage : la landing garde l'apex.
- Avantage : `app.dezyn.dev` et `api.dezyn.dev` sont le même site.
- Inconvénient : `WEB_URL` change, et avec elle les liens des emails.
- **Retenue.**

#### Option B — l'apex `dezyn.dev`

- Inconvénient : la landing doit partir ailleurs ou disparaître.
- **Écartée** : la landing reste.

### Les previews de l'app web

#### Option A — Des sous-domaines de `dezyn.dev`, servis par un Worker routeur

Un Worker routeur relaie `pr-<N>-preview.dezyn.dev` vers l'alias `workers.dev` de la preview de l'app web, et `pr-<N>-api-preview.dezyn.dev` vers celui de l'API.

- Avantage : même site qu'en production. Le cookie, le CORS et le contrôle d'`Origin` sont éprouvés tels quels.
- Avantage : les previews restent des versions téléversées sous un alias.
- Inconvénient : un Worker de plus, un enregistrement DNS joker et une route.
- Inconvénient : l'URL publique de l'API de preview change, et le parcours OAuth du MCP de preview passe par le nouvel hôte.
- **Retenue.**

#### Option B — Un proxy même-origine dans le Worker de l'app web

Le Worker de l'app web relaie `/v1` et `/auth` vers l'API de preview.

- Avantage : aucun DNS.
- Inconvénient : la preview ne passe plus par le CORS ni par le cookie entre sous-domaines, donc elle ne teste pas le chemin de production.
- Inconvénient : l'app web n'est plus purement statique, et l'URL publique de l'API de preview devient celle de l'app web.
- **Écartée** : la preview n'éprouverait pas ce qui peut casser en production.

#### Option C — Un Worker et des domaines dédiés par PR

Chaque PR déploie `dezyn-web-pr-<N>` et `dezyn-api-pr-<N>` avec leurs propres domaines, supprimés à la fermeture.

- Avantage : même site qu'en production, sans routeur.
- Inconvénient : il remplace le circuit des alias de preview de l'API, et il crée puis supprime des Workers à chaque PR.
- **Écartée** : plus de changements que l'option A pour la même garantie.

## Décision

### 1. L'app web de production est servie sur `app.dezyn.dev`

Le Worker `dezyn-web` sert le build de l'app web sur le domaine `app.dezyn.dev`, avec le repli SPA. `WEB_URL` de production vaut `https://app.dezyn.dev` : le CORS, le contrôle d'`Origin`, les `trustedOrigins` et les liens des emails le suivent (ADR 0044). L'apex `dezyn.dev` reste à la landing.

### 2. Les previews vivent sous `dezyn.dev`

Pour la PR N, l'app web répond sur `https://pr-<N>-preview.dezyn.dev` et l'API sur `https://pr-<N>-api-preview.dezyn.dev`. L'API de preview reçoit ces deux URL dans `WEB_URL` et `BETTER_AUTH_URL`.

### 3. Un Worker routeur relaie chaque hôte de preview vers son alias

Le Worker `dezyn-preview-router`, déployé depuis `main` sur la route `*-preview.dezyn.dev/*`, relaie la requête entière vers l'alias `workers.dev` de la version de preview correspondante. Un hôte qui ne correspond à aucune preview reçoit 404. La route ne commence que par `*` et ne touche que les hôtes qui finissent par `-preview.dezyn.dev`.

## Conséquences

### Positives

- La landing et l'app web coexistent.
- Une preview éprouve le chemin de production : cookie entre sous-domaines, CORS et contrôle d'`Origin`.
- Les previews de l'API gardent leur circuit d'alias.

### Négatives

- Un Worker de plus à déployer et à tester, et chaque requête de preview traverse un relais.
- Un enregistrement DNS joker `*` proxifié sur `dezyn.dev` : un sous-domaine inconnu aboutit chez Cloudflare au lieu d'échouer à la résolution DNS.
- Les liens des emails envoyés avant le changement de `WEB_URL` pointent vers `dezyn.dev`.

### Risques et mitigations

- Une route qui capture un hôte de production : une route l'emporte sur un custom domain du même hôte. Le motif `*-preview.dezyn.dev/*` ne peut atteindre ni `api.dezyn.dev`, ni `app.dezyn.dev`, ni l'apex.
- Une redirection de better-auth vers l'alias `workers.dev` : `BETTER_AUTH_URL` de la preview vaut l'hôte `dezyn.dev`, donc les redirections restent sur le même site.

## Notes d'implémentation

1. Servir l'app web sur `app.dezyn.dev` et passer `WEB_URL` de production à `https://app.dezyn.dev`.
2. Créer l'enregistrement DNS `*` proxifié, puis déployer le Worker routeur depuis `main`, et passer l'API de preview sur `pr-<N>-api-preview.dezyn.dev`.
3. Construire et téléverser la preview de l'app web avec `VITE_API_URL=https://pr-<N>-api-preview.dezyn.dev`.

## Liens

- [ADR 0037](0037-l-app-web-est-une-spa-react-servie-en-statique-par-cloudflare.md) — amendé : l'hôte de l'app web et le risque des previews sur `workers.dev`.
- [ADR 0034](0034-l-api-est-servie-par-un-worker-cloudflare.md) — les previews de l'API, versions téléversées sous un alias.
- [ADR 0044](0044-l-app-web-appelle-v1-avec-le-cookie-de-session-controle-par-l-origine-et-partage-les-contrats-de-l-api.md) — le cookie, le CORS et le contrôle d'`Origin` qui suivent `WEB_URL`.
