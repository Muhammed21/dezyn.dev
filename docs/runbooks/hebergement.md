# Recréer et vérifier l'hébergement

**Type:** how-to

L'API tourne dans le Worker Cloudflare `dezyn-api`, sur `api.dezyn.dev`, et joint la branche Neon `production` par Hyperdrive (ADR 0034). Chaque PR a sa preview : l'API sur le Worker `dezyn-api-preview` et sa propre branche Neon, servie sur `pr-<N>-api-preview.dezyn.dev`, et l'app web sur le Worker `dezyn-web-preview`, servie sur `pr-<N>-preview.dezyn.dev`, toutes deux par le Worker `dezyn-preview-router` (ADR 0045). Le déploiement, le rollback et les rôles PostgreSQL : voir [RELIABILITY](../RELIABILITY.md#deploy-vs-release).

Les étapes suivent l'ordre des dépendances. Les commandes `pnpm` se lancent depuis la racine du dépôt, dans un vrai terminal : elles demandent des confirmations et des valeurs masquées, et n'affichent ni secret ni URL de connexion. Chaque commande est relançable : sur une ressource déjà en place, elle ne change rien sans confirmation.

## 1. Prérequis

- Un compte Cloudflare, un compte Neon, un compte Resend, et les droits d'administration du dépôt GitHub.
- Les CLI connectées :

  ```
  gh auth login
  npx neonctl@2.47.0 auth
  (cd apps/api && npx wrangler login)
  ```

## 2. Cloudflare : la zone et les jetons

1. **La zone `dezyn.dev`** doit être active dans le compte. Sans elle, `wrangler deploy` échoue avec « Can't infer zone from route », car la route `api.dezyn.dev` de `apps/api/wrangler.jsonc` est un domaine personnalisé de cette zone. Le premier déploiement crée le domaine `api.dezyn.dev` et le Worker `dezyn-api`.
2. **Le sous-domaine `workers.dev`** du compte : il donne les URLs des alias de preview, `https://pr-<N>-dezyn-api-preview.<sous-domaine>.workers.dev`. Le noter pour l'étape 4.
3. **L'enregistrement DNS `*`** de la zone, de type `AAAA`, vers `100::`, proxifié. Il fait aboutir chez Cloudflare les hôtes de preview, que la route `*-preview.dezyn.dev/*` donne au Worker `dezyn-preview-router`. Les enregistrements explicites gardent la priorité sur lui.
4. **Le jeton de production**, rangé dans le secret GitHub `CLOUDFLARE_API_TOKEN` de l'environnement `production` (étape 4), avec ces permissions :
   - Account : Workers Scripts Edit ;
   - Account : Hyperdrive Read ;
   - Zone `dezyn.dev` : Zone Read et Workers Routes Edit.
5. **Le jeton de preview**, distinct, rangé dans le secret `CLOUDFLARE_API_TOKEN` de l'environnement `preview` : le modèle « Edit Cloudflare Workers », qui doit couvrir la zone `dezyn.dev` en Workers Routes Edit pour que `deploy.yml` pose la route du Worker `dezyn-preview-router`.

Workers Logs est activé par `observability` dans `apps/api/wrangler.jsonc` : il n'y a rien à créer. Les logs d'une URL de preview n'y passent pas.

## 3. Neon : le projet, la base de production et Hyperdrive

1. **Le projet Neon.** Sa branche par défaut s'appelle `production`. Noter l'identifiant du projet pour l'étape 4.
2. **Hyperdrive**, créé sur l'URL directe de la branche `production` (l'hôte sans `-pooler`), sans cache. Tant que le rôle `app` n'existe pas, il pointe sur `neondb_owner` ; l'étape suivante le fait pointer sur `app` :

   ```
   (cd apps/api && npx wrangler hyperdrive create dezyn-prod --caching-disabled --connection-string="$(npx neonctl@2.47.0 connection-string production --project-id <projet>)")
   ```

   Reporter l'identifiant renvoyé dans `hyperdrive[0].id` de `apps/api/wrangler.jsonc` et dans `HYPERDRIVE_ID` de `scripts/env/lib.sh`.

3. **Les rôles et le schéma** :

   ```
   pnpm prod:db
   ```

   La commande crée en SQL les rôles `migrator`, `app` et `history_maintainer` (ADR 0036), migre, et ne seede pas. Sur Neon, la base `neondb` appartient à `neondb_owner`, qui ne peut pas la céder à `migrator` ; la commande donne donc à `migrator` les deux droits que les migrations exigent :

   ```sql
   GRANT CREATE ON DATABASE neondb TO migrator;
   GRANT CREATE ON SCHEMA public TO migrator;
   ```

   Elle pose aussi le secret GitHub `DATABASE_URL_MIGRATOR` et fait pointer Hyperdrive sur `app`. Si la pose échoue, elle affiche comment la refaire.

Ne jamais créer un rôle de dezyn par la console ou l'API de Neon : il serait membre de `neon_superuser`, et `app` pourrait réécrire l'historique (ADR 0019). Pour remplacer un tel rôle : `pnpm roles:replace <branche>` (section 8).

## 4. GitHub : les environnements de déploiement

```
pnpm prod:github
pnpm preview:github
```

| Ressource                                    | Où                         | Posée par                                                          |
| -------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Environnement `production`                   | GitHub, réservé à `main`   | `prod:github`                                                      |
| `DEPLOY_ENABLED`                             | variable de dépôt          | `prod:github`, seulement si elle manque                            |
| `PURGE_DEPLOY_ENABLED`                       | variable de dépôt          | à la main, à l'étape 5                                             |
| `CLOUDFLARE_API_TOKEN` (production)          | environnement `production` | `prod:github`, saisi masqué                                        |
| `DATABASE_URL_MIGRATOR`                      | environnement `production` | `prod:db` à la création du rôle, ou `prod:github`                  |
| Environnement `preview`                      | GitHub, réservé à `main`   | `preview:github`                                                   |
| `WORKERS_SUBDOMAIN`, `NEON_PROJECT_ID`       | variables de `preview`     | `preview:github`                                                   |
| `CLOUDFLARE_API_TOKEN` (preview)             | environnement `preview`    | `preview:github`, saisi masqué                                     |
| `NEON_API_KEY`                               | environnement `preview`    | `preview:github`, saisi masqué ; clé limitée au projet si possible |
| `PREVIEW_BETTER_AUTH_SECRET`                 | environnement `preview`    | `preview:github`, tiré par `openssl`                               |
| `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` | environnement `preview`    | `polar:sandbox`, saisis masqués (section 6)                        |
| `POLAR_TEAM_PRODUCT_ID`, `POLAR_SERVER`      | variables de `preview`     | `polar:sandbox` (section 6)                                        |
| `CLAUDE_CODE_OAUTH_TOKEN`                    | secret de dépôt            | à la main, depuis `claude setup-token` ; lu par la revue des PR    |

`prod:github` reconstruit `DATABASE_URL_MIGRATOR` depuis le rôle `migrator` de la branche `production`, sans changer son mot de passe : Neon rend le mot de passe d'un rôle créé en SQL.

Laisser `DEPLOY_ENABLED` à `false` jusqu'à l'étape 5.

## 5. Le Worker de production et les emails

1. **Le domaine d'envoi chez Resend** (ADR 0035) : ajouter `dezyn.dev` dans Resend, poser dans la zone Cloudflare les enregistrements SPF et DKIM qu'il donne, attendre l'état « Verified », puis créer une clé « Sending access » limitée à `dezyn.dev`.
2. **Les secrets du Worker** :

   ```
   pnpm prod:secrets
   ```

   | Secret                   | Posé par                                                  |
   | ------------------------ | --------------------------------------------------------- |
   | `BETTER_AUTH_SECRET`     | tiré par `openssl` ; seulement dans Cloudflare            |
   | `BETTER_AUTH_SECRET_<N>` | tiré par `openssl`, à chaque rotation ; voir la section 8 |
   | `RESEND_API_KEY`         | saisi masqué ; sans lui, les emails ne partent pas        |

   Chaque secret posé publie aussitôt une nouvelle version du Worker, avec le code déployé.

3. **Le premier déploiement** : passer `DEPLOY_ENABLED` à `true`, puis pousser sur `main`. `deploy.yml` migre, déploie et appelle `/health`.

   ```
   gh variable set DEPLOY_ENABLED --body true
   ```

4. **Le Worker de purge** `dezyn-purge` (ADR 0042) passe toutes les 15 minutes, purge l'historique des espaces à leur limite et supprime les clés d'idempotence de plus de 24 heures. Il n'a ni route ni URL `workers.dev`, et se connecte par son propre Hyperdrive, en `history_maintainer` :

   ```
   (cd apps/api && npx wrangler hyperdrive create dezyn-purge-prod --caching-disabled --connection-string="$(npx neonctl@2.47.0 connection-string production --project-id <projet> --role-name history_maintainer)")
   ```

   Reporter l'identifiant renvoyé dans `hyperdrive[0].id` de `apps/api/wrangler.purge.jsonc`, puis passer `PURGE_DEPLOY_ENABLED` à `true` : `deploy.yml` déploie alors `dezyn-purge` après `dezyn-api`.

   ```
   gh variable set PURGE_DEPLOY_ENABLED --body true
   ```

   Après le premier déploiement, poser la clé Resend, sans laquelle les emails de purge sont journalisés sans partir :

   ```
   (cd apps/api && npx wrangler secret put RESEND_API_KEY --config wrangler.purge.jsonc)
   ```

   Chaque passage journalise `history_purge_pass` avec le nombre d'espaces purgés, puis `idempotency_purge_pass` avec le nombre de clés supprimées. Une purge qui échoue journalise `history purge failed` ou `idempotency purge failed`, l'autre purge s'exécute quand même, puis le passage finit en échec : `(cd apps/api && npx wrangler tail dezyn-purge --config wrangler.purge.jsonc)`. Sur le plan Workers Free, un passage peut dépasser les 10 ms de CPU par invocation et s'interrompre ; le lot en cours est annulé par sa transaction et le passage suivant reprend. Le plan Workers Paid lève cette limite (#161, ADR 0043).

   Pour lancer un passage sans attendre le cron, depuis un poste : `pnpm --filter @repo/api run purge`, avec `DATABASE_URL_HISTORY_MAINTAINER` sur la branche visée. Les emails partent alors par le SMTP de `SMTP_HOST`, `SMTP_PORT` et `MAIL_FROM`.

   `dezyn-api` a son propre cron, toutes les 15 minutes, qui rejoue auprès de Polar les résiliations en fin de période que Polar n'a pas reçues au départ du payeur. Chaque passage journalise `polar_cancellation_replay_pass` avec le nombre de résiliations rejouées et le nombre encore en attente ; une résiliation refusée journalise `payer departure: cancel the subscription at period end by hand in Polar` et reste en attente pour le passage suivant : `(cd apps/api && npx wrangler tail dezyn-api)`. La preview n'a pas ce cron.

## 6. La preview

`preview.yml` publie des versions des Workers `dezyn-api-preview` et `dezyn-web-preview`, qui doivent donc exister avant le premier run. Les créer une fois, sans secret ni binding de production (ADR 0034) :

```
(cd apps/api && npx wrangler deploy --env preview)
(cd apps/web && VITE_API_URL=https://api.dezyn.dev pnpm build && npx wrangler deploy --env preview)
```

La CI de chaque PR construit l'app web avec `VITE_API_URL=https://pr-<N>-api-preview.dezyn.dev` ; `preview.yml` téléverse ce build dans `dezyn-web-preview` sous l'alias `pr-<N>`, puis vérifie que `https://pr-<N>-preview.dezyn.dev` sert l'app et que l'API de preview autorise son origine avec les cookies.

Le Worker `dezyn-preview-router` se déploie depuis `main`, dans le job `preview-router` de `deploy.yml`, avec le jeton et `WORKERS_SUBDOMAIN` de l'environnement `preview`. Il relaie `pr-<N>-api-preview.dezyn.dev` vers l'alias `pr-<N>` de `dezyn-api-preview`, `pr-<N>-preview.dezyn.dev` vers celui de `dezyn-web-preview`, et répond 404 à tout autre hôte. Il joint les alias par l'Internet public (`global_fetch_strictly_public`) : sans ce drapeau, un Worker n'atteint pas une URL `workers.dev` du même compte.

Puis la branche Neon `preview` :

```
pnpm preview:db
```

La commande crée la branche Neon `preview` en schéma seul si elle manque, ses rôles, la migre, et seede le compte de démo `dev@dezyn.test` avec le mot de passe saisi. Chaque PR copie ensuite la branche `preview` en `pr-<N>`, et chaque version de preview reçoit `PREVIEW_BETTER_AUTH_SECRET`. `pnpm preview:clean` supprime les branches `pr-<N>` des PR fermées.

**Reconstruire la preview avec le bon secret.** Une branche `pr-<N>` garde dans `identity_jwks` une clé chiffrée avec le secret en place à sa création. Après un changement de `PREVIEW_BETTER_AUTH_SECRET`, supprimer les branches `pr-<N>` ouvertes ; le prochain run de `preview.yml` les recrée depuis `preview`, et la clé avec le nouveau secret :

```
npx neonctl@2.47.0 branches delete pr-<N> --project-id <projet>
```

**Le sandbox Polar.** Le développement et les previews paient le plan Team sur le sandbox de Polar :

```
pnpm polar:sandbox
```

Le wizard guide la création de l'organisation sandbox, du produit Team (mensuel, 34,99 € HT), du jeton d'accès et du webhook, puis écrit les valeurs dans `.env` et dans l'environnement GitHub `preview`. `preview.yml` les passe au Worker de preview : les deux secrets par `--secrets-file`, l'identifiant du produit et l'environnement par `--var`. Le webhook vise `https://pr-<N>-api-preview.dezyn.dev/webhooks/polar` (ADR 0050), en version d'API 2027-01, la preview de la PR qui teste le paiement ; pour une autre PR, modifier l'URL de l'endpoint dans Polar, son secret ne change pas.

## 7. Vérifier

```
pnpm prod:check
```

Chaque contrôle doit être `OK` : rôles de la branche `production`, secrets GitHub et `DEPLOY_ENABLED`, secret du Worker, Hyperdrive connecté en `app` au compute de `production`, et `/health`, qui répond 503 quand la base ne répond pas ou que la clé de signature des jetons est inutilisable.

## 8. Opérations courantes

### Remplacer des rôles créés par Neon

```
pnpm roles:replace <branche>
```

Sur `production`, passer d'abord `DEPLOY_ENABLED` à `false`, et répéter l'opération sur une copie de la branche. L'API répond 503 quelques secondes pendant le remplacement de `app`.

### Changer le secret d'authentification

better-auth chiffre la clé de signature des jetons, dans `identity_jwks`, avec le secret d'authentification. Le Worker lit `BETTER_AUTH_SECRET` et des versions `BETTER_AUTH_SECRET_<N>` : la version la plus haute chiffre les nouvelles clés, et chaque secret reste lu pour déchiffrer les clés qu'il a chiffrées. `BETTER_AUTH_SECRET` déchiffre les clés sans version.

Pour changer de secret, ajouter une version, sans jamais remplacer ni supprimer un secret existant :

```
pnpm prod:secrets
pnpm prod:check
```

`prod:secrets` propose `BETTER_AUTH_SECRET_<N+1>`. Les sessions web en cours se ferment, car leurs cookies sont signés avec le secret courant ; les jetons d'accès et les refresh tokens restent valides.

Une minute plus tard, une fois la nouvelle version du Worker propagée, terminer la rotation :

```
pnpm prod:secrets --expire-keys
```

La commande expire les clés de signature valides de la branche `production` et appelle `/health`, qui crée une clé chiffrée par la nouvelle version. Une clé expirée reste publiée un jour, ce qui couvre les jetons d'accès déjà émis. Sans cette étape, l'ancienne clé signe jusqu'à son expiration, au plus 90 jours. Expirer avant la propagation ferait répondre 500 aux instances encore sur l'ancienne version, qui ne déchiffrent pas la nouvelle clé. Si une clé dépend encore d'une ancienne version, la commande le dit : la relancer une minute plus tard.

### Retirer une ancienne version du secret

better-auth ne déchiffre que la clé de signature valide la plus récente. Chaque clé expire 90 jours après sa création, ou dès `pnpm prod:secrets --expire-keys`, et la suivante est chiffrée par la version la plus haute. Une version se retire quand aucune clé valide n'en dépend ; `pnpm prod:check` les liste :

```
INFO  Versions retirables, aucune clé valide n'en dépend : BETTER_AUTH_SECRET_2
```

Retirer chaque version listée, puis relancer `pnpm prod:check` :

```
(cd apps/api && npx wrangler secret delete BETTER_AUTH_SECRET_<N> --env="")
```

`prod:check` échoue si le Worker n'a plus un secret dont dépend une clé valide. `BETTER_AUTH_SECRET` et la version la plus haute ne se retirent pas.
