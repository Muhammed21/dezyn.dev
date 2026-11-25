# 0060 — L'accès MCP vit avec la chaîne de refresh tokens, séparé de la session web

- Statut : Accepté
- Date : 2026-11-25
- Décideurs : Muhammed Cavus
- Amende : ADR 0018 (§2, chaque appel vérifie la chaîne de refresh tokens du jeton, et non plus l'expiration de la session web ; §3, un rejeu hors fenêtre coupe aussi toutes les chaînes de l'utilisateur)

## Contexte et problématique

Un agent planifié, par exemple pour le relevé Figma (ADR 0059), demande un accès MCP qui tient sans humain : il travaille chaque lundi, et personne ne revient sur le web entre deux passages.

L'IA du client accède au MCP par OAuth (ADR 0018). Faits du code, avec better-auth et `@better-auth/oauth-provider` 1.7.7 :

- Le jeton d'accès vit 15 minutes, le refresh token 60 jours. Le refresh token tourne à chaque usage, avec une fenêtre de rejeu de 30 secondes. Le scope `offline_access` est demandé (`identity/infrastructure/better-auth.ts`).
- La durée de session n'est pas surchargée : elle vaut le défaut de better-auth, 7 jours (`3600 * 24 * 7`, `better-auth/dist/context/create-context.mjs`). Seule la lecture de la session par le cookie de l'app web la prolonge, au plus une fois par jour (`updateAge`).
- Le jeton porte la session web depuis laquelle l'utilisateur a autorisé l'IA (`sid`), et son heure d'authentification (`authTime`, la création de cette session).
- Le garde du rafraîchissement refuse au-delà de 180 jours depuis `authTime`, sans consentement, ou sans session liée (`session_id` à `NULL`). Sur un rejeu hors fenêtre, il supprime toutes les sessions de l'utilisateur, et `@better-auth/oauth-provider` supprime tous les refresh tokens de ce client pour cet utilisateur (`identity/domain/refresh-grant.ts`, `invalidateRefreshFamily`).
- Chaque appel MCP vérifie en base que la session `sid` existe et n'est pas expirée, et que le consentement du client existe (`identity/infrastructure/postgres-active-grants.ts`, ADR 0018 §2).

Aujourd'hui, un rafraîchissement ne prolonge pas la session. `handleRefreshTokenGrant` réutilise la session du refresh token sans la modifier. Sept jours sans visite de l'app web depuis ce navigateur, la session expire. Le rafraîchissement réussit encore, mais chaque appel MCP répond `401` : l'agent perd l'accès.

La fin d'une session ne se lit pas de façon fiable dans sa ligne :

- La déconnexion supprime la ligne de session : sans stockage secondaire, `deleteSession` fait un `DELETE`. Les clés étrangères des jetons OAuth passent à `NULL` (`onDelete: "set null"`). Le crochet de suppression de session de `@better-auth/oauth-provider` révoque les jetons d'accès liés, mais garde les refresh tokens `offline_access`, « pour qu'un accès d'API de longue durée survive à la session du navigateur ». La révocation d'une session depuis la liste des sessions fait de même.
- better-auth supprime aussi une session expirée quand son cookie lui est encore présenté (`getSession`, `better-auth/dist/api/routes/session.mjs`). Cette suppression passe par le même `DELETE` et les mêmes crochets.
- Ni better-auth ni dezyn ne purgent les sessions expirées de façon planifiée. Une session expirée reste en base tant que son cookie n'est pas présenté.

Un `session_id` à `NULL` ne distingue donc pas une déconnexion d'une session expirée qui a disparu.

Problématique : comment l'accès MCP d'un agent tient-il sans humain au-delà de 7 jours, sans allonger la session web et sans perdre les moyens de le couper ?

## Facteurs de décision

- Un agent qui rafraîchit régulièrement garde l'accès sans que l'utilisateur revienne sur le web.
- L'accès s'arrête de lui-même : un agent oublié ne le garde pas indéfiniment.
- Le retrait du consentement, la déconnexion et le rejeu d'un refresh token coupent l'accès à l'appel suivant (ADR 0018).
- La session web garde sa durée : un cookie volé ne vaut pas plus longtemps qu'aujourd'hui.
- Pas de nouvel objet d'accès à exposer, à gérer et à révoquer.

## Options envisagées

### Option A — Un rafraîchissement prolonge la session web liée

- Avantage : rien ne change au contrôle de chaque appel.
- Inconvénient : la session liée est la session web de l'utilisateur. Son cookie, s'il est volé, resterait valable jusqu'à 180 jours tant que l'agent rafraîchit.
- **Écartée** pour cette raison.

### Option B — Un accès d'agent dédié par projet

Un jeton propre à un agent, créé dans les réglages du projet, sans session web.

- Avantage : indépendant de la session de l'utilisateur.
- Inconvénient : un nouvel objet d'accès, avec sa création, son affichage, sa révocation et son historique ; un second chemin d'authentification à côté d'OAuth (ADR 0007 §4).
- **Écartée.**

### Option C — Une réautorisation hebdomadaire

L'utilisateur revient sur le web, ou réautorise l'IA, au moins une fois par semaine.

- Avantage : rien à changer.
- Inconvénient : l'agent planifié s'arrête dès que l'utilisateur oublie, ce qu'il cherche justement à éviter.
- **Écartée.**

### Option D — L'accès MCP vit avec la chaîne de refresh tokens

- Avantage : la session web garde ses 7 jours ; l'agent garde l'accès tant qu'il rafraîchit.
- Avantage : les coupures restent : retrait du consentement, déconnexion, rejeu, 180 jours.
- Inconvénient : le contrôle de chaque appel et la déconnexion changent, sur un chemin d'authentification.
- **Retenue.**

## Décision

### 1. La session web garde sa durée

Un rafraîchissement OAuth ne touche pas la session web : ni son expiration, ni son cookie. Elle vit 7 jours, prolongés seulement par l'app web.

### 2. L'accès MCP vit avec la chaîne de refresh tokens

La chaîne est la suite des refresh tokens issus d'une autorisation par rotation. L'accès MCP d'une IA est valide tant que :

- le refresh token courant de la chaîne est valide : 60 jours glissants, renouvelés à chaque rafraîchissement ;
- moins de 180 jours se sont écoulés depuis `authTime` (ADR 0018 §4) ;
- le consentement de l'utilisateur pour ce client existe ;
- la chaîne n'est coupée ni par une déconnexion ni par un rejeu.

L'expiration de la session web liée ne coupe pas l'accès.

### 3. Chaque appel vérifie la chaîne, pas la session web

Après la signature, l'émetteur, l'audience et l'expiration du jeton, l'API vérifie en base que la chaîne du jeton est encore valide (§2). Le contrôle ne lit pas l'expiration de la session web, et ne dépend pas de l'existence de sa ligne : une session expirée peut disparaître à tout moment.

Ce volet amende l'ADR 0018 §2.

### 4. Les coupures restent, enregistrées sur la chaîne

- **Retrait du consentement** : il coupe l'accès à l'appel suivant et refuse le rafraîchissement.
- **Déconnexion** : la fin d'une session encore valide, par la déconnexion ou la révocation de cette session, coupe les chaînes autorisées depuis elle. La coupure s'enregistre sur la chaîne au moment de la déconnexion. La disparition d'une session déjà expirée ne coupe rien.
- **Rejeu hors fenêtre** : il coupe toutes les chaînes de l'utilisateur, en plus de ses sessions.
- **180 jours depuis `authTime`** : le rafraîchissement est refusé, et l'appel aussi.

Ce volet amende l'ADR 0018 §3 pour le rejeu.

## Conséquences

### Positives

- Un agent qui rafraîchit au moins tous les 60 jours garde l'accès jusqu'à 180 jours, sans que l'utilisateur revienne sur le web.
- Le relevé planifié chaque semaine (ADR 0059) ne s'arrête pas au bout de 7 jours.
- La session web et son cookie ne valent pas plus longtemps qu'aujourd'hui.
- Aucun nouvel objet d'accès ni chemin d'authentification.

### Négatives

- Le contrôle de chaque appel MCP change de source : il lit la chaîne, plus la session.
- La déconnexion doit couper les chaînes elle-même : le `session_id` à `NULL` ne suffit plus, puisqu'une session expirée le met aussi à `NULL`.
- Un refresh token volé donne l'accès MCP jusqu'à 60 jours sans session web valide, tant qu'il n'est pas rejoué en même temps que le légitime.
- Au bout de 180 jours, l'agent perd l'accès sans prévenir ; l'utilisateur doit réautoriser l'IA.

### Risques et mitigations

- **Une déconnexion ne coupe pas l'agent** : les tests d'identité couvrent la déconnexion, la révocation d'une session et la suppression d'une session expirée, chacune avec son effet attendu sur l'appel suivant et le rafraîchissement.
- **Un agent oublié garde l'accès** : 180 jours au plus depuis `authTime`, et l'utilisateur retire le consentement ou se déconnecte quand il veut.
- **Un refresh token volé** : la rotation et le rejeu hors fenêtre le neutralisent au premier usage concurrent (ADR 0018 §3).
- **Un agent planifié s'arrête après 180 jours** : l'indice « Dernier relevé Figma » est mis en avant au-delà de 14 jours (ADR 0059 §6).

## Notes d'implémentation

Ce que le code doit savoir :

- Le garde du rafraîchissement refuse aujourd'hui un refresh token sans session (`orphaned`). Une session expirée puis supprimée produit le même `NULL` qu'une déconnexion : ce refus doit lire la coupure enregistrée sur la chaîne, plus le `session_id`.
- Le crochet de suppression de session de `@better-auth/oauth-provider` voit passer la déconnexion et la suppression d'une session expirée. L'expiration de la ligne supprimée les distingue.
- `invalidateRefreshFamily` ne supprime que les refresh tokens du client rejoué ; le rejeu doit couper aussi les chaînes des autres clients de l'utilisateur.
- La suppression d'un compte supprime ses refresh tokens (`onDelete: "cascade"` sur `user_id`).

Tests d'identité, de même genre que ceux du rafraîchissement :

- un agent qui rafraîchit chaque semaine garde l'accès au-delà de 7 jours, et la session web expire à 7 jours ;
- l'accès est refusé au-delà de 180 jours, après le retrait du consentement, après une déconnexion et après un rejeu ;
- la suppression d'une session déjà expirée ne coupe pas l'accès.

Les chemins d'authentification relèvent du palier de revue `critical` (ADR 0007, notes d'implémentation).

## Liens

- [ADR 0018](0018-jetons-d-acces-jwt-lies-a-l-api-session-verifiee-en-base-a-chaque-appel.md) — la session vérifiée à chaque appel, la rotation et la durée absolue ; amendé ici.
- [ADR 0007](0007-un-seul-backend-api-et-mcp-streamable-http-oauth.md) — OAuth 2.1 pour le MCP, seul chemin d'authentification de l'IA.
- [ADR 0044](0044-l-app-web-appelle-v1-avec-le-cookie-de-session-controle-par-l-origine-et-partage-les-contrats-de-l-api.md) — la session web de l'app, qui garde sa durée.
- [ADR 0059](0059-les-agents-sont-des-recettes-servies-en-prompt-mcp-le-releve-figma-est-la-premiere.md) — les agents planifiés, qui demandent cet accès.
