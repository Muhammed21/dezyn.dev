# Plan : l'app web suit un projet en temps réel

**Branche** : feat/temps-reel-propositions
**Statut** : Actif

## But

Un membre qui regarde un projet dans l'app web voit arriver les écritures de l'IA et les décisions des autres membres sans recharger la page.

## Besoin

- **Acteur** : un membre de l'espace (éditeur ou lecteur) qui garde l'app web ouverte, souvent à côté de l'outil où tourne son IA.
- **Capacité** : voir les propositions, l'historique et les tokens du projet changer pendant que l'IA ou un autre membre écrit.
- **Résultat** : relire un lot pendant qu'il se remplit, sans recharger, et sans valider une proposition déjà décidée par un autre membre (`409 already_reviewed`).
- **Contrainte actuelle** : React Query recharge à l'ouverture d'une page et au retour du focus. Rien ne bouge quand l'IDE et l'app web sont côte à côte, ni quand un autre membre agit.

## Découpage

| Story                                                                | Valeur                                                            | Inclut                                                                                                                                                                            | Reporte                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **1. Les propositions écrites par l'IA apparaissent sans recharger** | La boucle centrale IA → relecture ; lève le risque d'architecture | Worker `dezyn-realtime` et son Durable Object par projet, route WebSocket authentifiée, signal après `write_tokens`, rafraîchissement de la liste des lots et de la page d'un lot | Décisions des membres, autres producteurs de propositions, reconnexion |
| 2. La connexion perdue se rétablit et rattrape l'écart               | Un déploiement ou une coupure réseau ne fige pas l'écran          | Reconnexion avec délai croissant, rechargement des données à la reconnexion                                                                                                       | —                                                                      |
| 3. Les décisions d'un autre membre apparaissent                      | Évite les `409 already_reviewed`                                  | Signal après validation et rejet (une proposition, un lot), ouverture et fermeture d'un lot                                                                                       | —                                                                      |
| 4. Les autres sources de propositions apparaissent                   | Couverture complète                                               | `declare_figma_states`, propositions remplacées par l'ajout d'un token ou par un import                                                                                           | —                                                                      |
| 5. L'historique avance en direct                                     | « Je vois l'IA travailler » (synthèse, L15)                       | Signal `history` à chaque entrée, rafraîchissement de la page d'historique                                                                                                        | Pagination en direct                                                   |
| 6. Les tokens validés apparaissent                                   | Moindre : le rechargement au focus couvre déjà la plupart des cas | Signal `tokens` après validation et import                                                                                                                                        | —                                                                      |

Chaque story reste livrable seule : sans les suivantes, l'app web garde son comportement actuel sur les écrans non couverts.

## Décisions de conception (ADR à rédiger avec la story 1)

1. **Un signal, pas des données.** Le serveur pousse `{ "type": "changed", "topics": ["proposals"] }`. Le client invalide les requêtes React Query des sujets reçus et relit par les routes REST existantes : les autorisations et les contrats restent à un seul endroit, et un signal perdu ne corrompt rien.
2. **Un Durable Object par projet** (`getByName(projectId)`), avec l'API WebSocket en hibernation : pas de facturation de durée au repos. Le plan Workers Free suffit (100 000 requêtes par jour, stockage SQLite non utilisé).
3. **Le Durable Object vit dans un Worker séparé, `dezyn-realtime`**, dans son propre paquet `apps/realtime` (son `wrangler.jsonc`, ses types workerd), comme `apps/preview-router`. Cloudflare ne génère pas de preview URL pour un Worker qui implémente un Durable Object ; `dezyn-api` ne fait que s'y lier (`script_name`) et garde ses previews (ADR 0045).
4. **`GET /v1/projects/:projectId/events`** accepte la mise à niveau WebSocket dans `dezyn-api` : cookie de session et contrôle de l'origine (ADR 0044), droit `space.read` sur le projet, puis transmission au Durable Object. Une requête sans `Upgrade: websocket` répond 426 sans toucher au Durable Object.
5. **Le signal part après le commit, au mieux.** Un port `ProjectSignals` (`changed({ projectId, topics })`) est appelé par les cas d'usage après la transaction. Son échec est journalisé et ne fait pas échouer l'écriture ; le rechargement au focus reste le filet.
6. **Adapters** : le Durable Object en production et en preview ; un enregistreur en mémoire pour les tests d'intégration Node, qui affirment « tel appel signale tel sujet pour tel projet » ; aucun signal pour l'API Node locale (`pnpm dev`).
7. **Côté app web**, un port `ProjectEvents` (abonnement à un projet, sujets reçus), un adapter WebSocket du navigateur, et un faux en mémoire pour les tests de Vitest Browser Mode.

## Tests du Durable Object

La classe du Durable Object se teste dans workerd avec `@cloudflare/vitest-plugin` (nouveau nom de `@cloudflare/vitest-pool-workers`), dans la configuration Vitest de `apps/realtime`. Le temps réel en local (`pnpm dev`) n'est pas couvert par la story 1 ; un adapter `ws` pour l'API Node peut devenir une story si le manque gêne.

## Risques

- **Une preview URL de `dezyn-api` liée à un Durable Object d'un autre Worker** : la documentation ne le dit pas. La story 1 le vérifie sur `pr-N-preview.dezyn.dev` avant tout le reste. Si ça échoue, le repli est de passer par le routeur de previews (ADR 0045) ou de servir les WebSockets par `dezyn-realtime` directement.
- **Cookie sur la poignée de main WebSocket** : `app.dezyn.dev` et `api.dezyn.dev` sont le même site, le cookie `SameSite=Lax` part. Le contrôle de l'origine reste obligatoire contre le détournement de WebSocket entre sites.
- **Un membre retiré** garde sa connexion jusqu'à la prochaine coupure. Il ne reçoit que des sujets sans données, et chaque relecture lui répond 404. Accepté pour la story 1.

## Story 1 en tranches

Chaque tranche suit RED, GREEN, MUTATE, KILL MUTANTS, REFACTOR. Avant le code : `tdd`, `testing`, `mutation-testing`, `refactoring`, plus `durable-objects` et `react-testing` selon la tranche.

### Tranche 1.1 : un membre s'abonne aux signaux d'un projet, et `write_tokens` y publie `proposals`

**Valeur** : prouve le chemin complet sur une preview, sans encore toucher à l'écran.
**Chemin** : `GET /v1/projects/:id/events` (authentification, origine, droit, 426) → Durable Object `dezyn-realtime` → `write_tokens` appelle `ProjectSignals.changed` après sa transaction → le Durable Object diffuse aux connexions du projet.
**Critères** :

- Un membre connecté du projet obtient 101 ; un non-membre 404 ; une origine étrangère 403 ; sans cookie 401 ; sans `Upgrade: websocket` 426.
- Un `write_tokens` réussi signale `proposals` pour son projet, une fois, après le commit ; un `write_tokens` refusé ne signale rien.
- Un signal qui échoue est journalisé et la réponse de `write_tokens` reste la même.
- Sur `pr-N-preview.dezyn.dev`, un client WebSocket connecté reçoit `{"type":"changed","topics":["proposals"]}` après un `write_tokens`.
- `deploy.yml` et `preview.yml` déploient `dezyn-realtime` avant `dezyn-api`.
- L'ADR du temps réel est accepté.

**RED** : tests d'intégration de la route (codes de réponse) et de `write_tokens` avec l'enregistreur en mémoire ; tests de la classe du Durable Object dans workerd (`@cloudflare/vitest-plugin`).

### Tranche 1.2 : l'app web rafraîchit les lots et la page d'un lot à la réception de `proposals`

**Valeur** : le membre voit les propositions de l'IA apparaître.
**Chemin** : les pages des propositions s'abonnent au projet par `ProjectEvents` → à la réception de `proposals`, invalidation des clés `proposal-batches` et `proposal-batch` → relecture REST.
**Critères** :

- Sur la page des lots ou d'un lot, un signal `proposals` du projet affiché fait apparaître les nouvelles propositions sans action du membre.
- Un signal d'un autre projet ne relit rien.
- Quitter la page ferme l'abonnement.

**RED** : tests Vitest Browser Mode des deux pages avec le faux `ProjectEvents`.

---

_Supprimer ce fichier quand le plan est terminé._
