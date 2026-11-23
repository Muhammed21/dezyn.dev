# 0051 — Le seul membre d'un espace supprime son compte et laisse un espace orphelin

- Statut : Accepté
- Date : 2026-11-23
- Décideurs : Muhammed Cavus
- Amende : ADR 0011 (§5, le seul membre d'un espace supprime son compte sans nommer de successeur)

## Contexte et problématique

L'ADR 0011 §5 pose qu'un espace a toujours au moins un propriétaire : le dernier propriétaire ne quitte pas l'espace et ne supprime pas son compte sans avoir nommé un autre propriétaire.

La suppression de compte (#360) applique cette règle quand l'espace a d'autres membres. Mais chaque utilisateur a un espace personnel dont il est le seul membre, et l'app ne permet pas encore de supprimer un espace. Appliquer l'ADR 0011 §5 à la lettre empêcherait presque tout le monde de supprimer son compte.

Problématique : que devient un espace dont le seul membre supprime son compte ?

## Facteurs de décision

- Tout utilisateur peut supprimer son compte depuis l'app, sans aide.
- Une équipe ne perd pas son espace quand une personne part (ADR 0011).
- Les données d'un espace que plus personne ne peut ouvrir ne restent pas indéfiniment.
- Un abonnement payé prend fin avec son payeur (ADR 0050 §3).

## Options envisagées

### Option A — Refuser, comme pour un départ

- Inconvénient : sans suppression d'espace dans l'app, le seul membre d'un espace ne peut jamais supprimer son compte.
- **Écartée.**

### Option B — Supprimer l'espace avec le compte

- Avantage : aucune donnée ne survit au compte.
- Inconvénient : suppression en cascade d'un espace (projets, tokens, historique, fichiers stockés), qui n'existe pas encore et alourdit la suppression du compte.
- **Écartée pour l'instant.**

### Option C — L'espace reste orphelin, puis il est purgé

- Avantage : la suppression du compte reste simple et toujours possible.
- Inconvénient : les données de l'espace restent en base jusqu'à sa purge.
- **Retenue.**

## Décision

Le refus de l'ADR 0011 §5 ne vise que le dernier propriétaire d'un espace qui a d'autres membres. Le seul membre d'un espace supprime son compte sans nommer de successeur.

L'espace reste alors **orphelin** : sans aucun membre, personne ne peut plus l'ouvrir. Ses projets, tokens et entrées d'historique restent en base, sous un membre supprimé (ADR 0015). S'il avait un abonnement payé par ce membre, l'abonnement est résilié en fin de période, comme pour un départ du payeur (ADR 0050 §3).

Un espace orphelin est purgé en entier. Cette purge fait l'objet du ticket #364.

## Conséquences

### Positives

- Tout utilisateur peut supprimer son compte depuis l'app.
- Une équipe garde son espace : le dernier propriétaire d'un espace à plusieurs membres nomme toujours un successeur.

### Négatives

- Tant que la purge des espaces orphelins n'existe pas, leurs données restent en base sans que personne ne puisse y accéder.
- Quitter un espace et supprimer son compte suivent deux règles différentes pour le seul membre : le départ est refusé, la suppression est acceptée.
