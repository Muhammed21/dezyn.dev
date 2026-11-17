# Plan : valider un lot en un nombre fixe de requêtes SQL

**Issue** : #258
**Statut** : Actif

## But

Valider un lot de propositions prend le même nombre d'allers-retours avec PostgreSQL, quelle que soit la taille du lot : un lot de 67 tokens se valide en moins d'une seconde en production au lieu de plus de 15.

## Diagnostic

Mesuré le 2026-11-15 par une boucle jetable (test d'intégration qui crée un lot de N tokens, le ferme, appelle `POST /v1/proposal-batches/:id/validate` et compte les requêtes du pilote `pg`, avec une latence simulée par requête).

| Tokens | Requêtes | Durée, 15 ms par requête |
| -----: | -------: | -----------------------: |
|      1 |       30 |                    0,5 s |
|     10 |      165 |                    2,9 s |
|     67 |    1 020 |                     18 s |

Les requêtes suivent 15 + 15 × N. `validateBatch` (`apps/api/src/modules/proposal/application/review-proposals.ts`) traite les propositions une par une avec `inSequence`, dans une transaction ; en production, chaque requête est un aller-retour Worker → Hyperdrive → Neon. Pour 67 tokens :

| Requête                                                                  | Nombre |
| ------------------------------------------------------------------------ | -----: |
| `update project set stored_bytes` (compteur de stockage)                 |    268 |
| relecture de la proposition, des modes et de l'état Figma                | 68 × 3 |
| `select … from token where project_id` (tous les tokens, à chaque token) |     67 |
| `insert token`, `insert token_value`                                     | 67 × 2 |
| `update proposal`, `update token_figma_state`                            | 67 × 2 |
| `select` puis `insert history_author` (le même auteur à chaque entrée)   | 67 × 2 |
| `insert history_entry`                                                   |     67 |

## Décisions

- Les ports d'écriture utilisés par la relecture deviennent des ports de lot : une liste en entrée, un nombre fixe de requêtes par appel. La relecture d'une seule proposition (`reviewProposal`) appelle les mêmes ports avec une liste d'un élément, sans chemin dupliqué.
- Le comportement ne change pas : ordre des propositions, premier token invalide qui annule tout le lot avec `invalid_proposition` et son `proposalId`, `name_taken` sur une création concurrente, alerte de stockage, entrées d'historique (une par proposition, mêmes champs).
- Le compteur de stockage reçoit une seule variation par lot et par projet, somme des tailles ajoutées et retirées.
- L'auteur de l'historique est résolu une fois par lot.
- Les contrôles d'un token (références, types, nom pris) se font en mémoire sur un instantané lu une fois : les tokens validés du projet plus les propositions en attente, comme aujourd'hui.
- Mesure : un utilitaire de test `#testing/round-trips.ts` compte les requêtes envoyées par le pilote `pg` pendant un appel. Il sert de seam aux tests de non-régression, qui comparent un lot de N à un lot de 1 plutôt qu'un nombre absolu.

## Critères d'acceptation

- [ ] Valider un lot de 67 propositions envoie le même nombre de requêtes qu'un lot d'une proposition, en création, en modification et en rejet.
- [ ] Les tests existants de la relecture et de la validation passent sans modification.
- [ ] La boucle de diagnostic à 15 ms par requête passe de 18 s à moins d'1 s pour 67 tokens.
- [ ] Un bench `validate`, 130 propositions, rejoint `apps/api/bench` et la table de `docs/PERFORMANCE.md`.

## Tranches

Chaque tranche suit RED, GREEN, MUTATE, KILL MUTANTS, REFACTOR. Avant le code : `tdd`, `testing`, `mutation-testing`, `refactoring`.

### Tranche 1 : les décisions d'un lot s'écrivent en un nombre fixe de requêtes

**Valeur** : rejeter un lot, et la part « décisions » de toute validation, ne dépend plus de la taille du lot.
**Chemin** : `validateBatch` → `unit.proposals.settle`, `unit.figmaStates`, `unit.history.append` et le compteur de stockage deviennent des appels de lot (statuts en un `update` par statut, états Figma en un `update`, auteur résolu une fois, entrées d'historique en un `insert`, une variation du compteur).
**Critères** :

- Rejeter les 67 propositions d'un lot envoie le même nombre de requêtes que rejeter un lot d'une proposition.
- Statuts, états Figma, entrées d'historique et `stored_bytes` identiques à aujourd'hui (tests existants inchangés).
- `#testing/round-trips.ts` existe et sert ce test.
  **RED** : test d'intégration « rejeter 67 propositions coûte autant de requêtes qu'en rejeter une » ; il échoue (la différence est d'environ 7 requêtes par proposition).
  **MUTATE** : Stryker sur les fichiers touchés de `proposal`, `history`, `token` (états Figma) et `project` (compteur).

### Tranche 2 : les tokens créés par un lot s'écrivent en un nombre fixe de requêtes

**Valeur** : un lot d'import (des créations) se valide en temps constant ; c'est le cas de l'exemple de 67 tokens.
**Chemin** : `unit.tokens.create` devient une création de lot : un instantané des tokens lu une fois, contrôles en mémoire dans l'ordre du lot, un `insert` des tokens (`on conflict do nothing`, le premier absent donne `name_taken`), un `insert` des valeurs, un `insert` des références, une variation du compteur.
**Critères** :

- Valider un lot de 67 créations envoie le même nombre de requêtes qu'un lot d'une création.
- Un lot dont la 40e proposition est invalide est refusé avec son `proposalId`, sans rien écrire.
- Une référence vers un token créé plus tôt dans le même lot reste acceptée.
  **RED** : test d'intégration « valider 67 créations coûte autant de requêtes qu'en valider une ».
  **MUTATE** : Stryker sur `postgres-tokens.ts` et `review-proposals.ts`.
  **Mesure** : boucle de diagnostic rejouée à 15 ms ; bench `validate` ajouté, ligne dans `docs/PERFORMANCE.md` (« Optimization Ledger »).

### Tranche 3 : les tokens modifiés par un lot s'écrivent en un nombre fixe de requêtes

**Valeur** : un lot de modifications (réimport d'un fichier changé) se valide aussi en temps constant.
**Chemin** : `unit.tokens.replace` en lot : tokens avant lus en un `select`, descriptions et extensions mises à jour en un `update … from (values …)`, anciennes valeurs et références supprimées en un `delete` chacune, nouvelles valeurs insérées en un `insert`, une variation du compteur.
**Critères** :

- Valider un lot de 67 modifications envoie le même nombre de requêtes qu'un lot d'une modification.
- Valeurs, références et `stored_bytes` après modification identiques à aujourd'hui.
  **RED** : test d'intégration « valider 67 modifications coûte autant de requêtes qu'en valider une ».
  **Clôture** : la PR dit « Closes #N » et supprime ce plan.

## Hors périmètre

- `write_tokens` (MCP) suit peut-être le même schéma : à mesurer avec la même boucle, dans une issue séparée si c'est le cas.
- La latence réelle par requête en production : les logs `request` du Worker (`durationMs`) la donneront après la tranche 2.

---

_Supprimer ce fichier quand le plan est terminé._
