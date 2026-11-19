# API REST

**Type:** reference

L'API REST de dezyn est servie sous `/v1`. Ses schémas partagés avec les clients vivent dans `packages/contracts` (ADR 0023, 0044).

## Erreurs

Une erreur répond en `application/problem+json` (RFC 9457) : `type`, `title`, `status`, `instance` (le chemin de la requête) et `correlationId`. Un refus propre à dezyn a un `type` de la forme `https://dezyn.dev/problems/<nom>` ; les autres ont `about:blank`.

## Idempotence des écritures

Un client qui renvoie une écriture après un timeout, sans savoir si la première est passée, joint l'en-tête `Idempotency-Key`. Tant que la même clé revient, dezyn rejoue la réponse de la première requête sans rien réécrire.

Routes qui acceptent la clé (les autres écritures suivent avec #293) :

- `POST /v1/projects/{projectId}/tokens`

Sans en-tête, la route répond comme toute requête.

### Règles

- **Format** : de 1 à 255 caractères ASCII imprimables.
- **Portée** : une clé appartient au membre authentifié, à la méthode et au chemin de la requête. La même clé sur un autre chemin, une autre méthode ou pour un autre membre est une nouvelle requête.
- **Empreinte** : le corps de la requête. La même clé avec un autre corps est refusée.
- **Réponses mémorisées** : les 2xx et les 4xx. Une 5xx n'est pas mémorisée : la clé est libérée et une relance s'exécute pour de bon.
- **Rejeu** : même statut, même corps, même `content-type`, avec l'en-tête `Idempotency-Replayed: true`. Un rejeu n'écrit rien : pas de nouvelle entrée d'historique, pas de signal temps réel.
- **Accès** : avant un rejeu, dezyn revérifie que le membre a encore le droit d'écrire. Un membre qui l'a perdu (retiré de l'espace, par exemple) reçoit la réponse d'un envoi sans clé, sans `Idempotency-Replayed`.
- **Durée** : l'oubli d'une clé au bout de 24 heures et la purge des clés expirées arrivent avec #294.

### Refus

| `type`                                               | Statut | Quand                                                                     |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `https://dezyn.dev/problems/invalid-idempotency-key` | 400    | La clé est vide, dépasse 255 caractères ou contient un caractère interdit |
| `https://dezyn.dev/problems/idempotency-in-progress` | 409    | Une requête avec la même clé est encore en cours ; réessayer plus tard    |
| `https://dezyn.dev/problems/idempotency-key-reused`  | 422    | La clé a déjà servi avec un autre corps ; choisir une clé nouvelle        |

Contrats : `IDEMPOTENCY_KEY_HEADER`, `IDEMPOTENCY_REPLAYED_HEADER`, `InvalidIdempotencyKeyProblem`, `IdempotencyInProgressProblem` et `IdempotencyKeyReusedProblem` dans `@repo/contracts`.
