import { recipeDateOf } from "./recipe-date.ts";
import type { Recipe } from "./recipe.ts";

const instructionsFor: Recipe["instructionsFor"] = ({ project, today }) => {
  const date = recipeDateOf(today);
  return `# Bilan de santé du projet « ${project.name} » (${project.id})

Tu fais le bilan de santé de ce projet dezyn : tu lis ses tokens et le contraste de ses paires de contraste, tu proposes dans un seul lot les corrections sans ambiguïté, et tu rapportes le reste dans ton compte rendu. Toute écriture devient une proposition ; rien n'est validé sans un éditeur. Le bilan ne lit pas Figma.

## Lire dezyn

Lis les tokens du projet avec read_tokens avec includeProposals à true : les tokens validés, leurs modes, leurs doublons (duplicates), et les propositions en attente.

Appelle check_contrast avec le projectId : dezyn calcule le contraste WCAG de chaque paire de contraste déclarée, dans chaque mode, avec son ratio, son seuil et son verdict. Ne calcule aucun contraste toi-même.

## Écrire dans dezyn

Une correction réécrit un token entier avec write_tokens, en DTCG, avec les seuls champs name, $type, $value ou modes, $description et $extensions : les autres champs que rend read_tokens (id, status, duplicates, figma) ne s'écrivent pas.

## Règles

1. Un doublon est un groupe de tokens validés de même type et de même valeur dans chaque mode : un token et les noms que read_tokens rend dans son duplicates. La source du groupe est le seul token du groupe que d'autres tokens validés citent par alias ({nom.du.token}).
2. Quand un groupe a une source unique, propose de remplacer chaque autre token du groupe par un alias vers elle : réécris le token avec write_tokens, sa valeur ($value, ou chaque mode dans modes) devenant {nom.de.la.source}, sans rien changer d'autre (type, description, extensions).
3. Quand un groupe n'a aucune source, ou en a plusieurs, ne propose rien : signale ce doublon ambigu dans ton compte rendu, avec les noms du groupe.
4. Rapporte dans ton compte rendu chaque paire que check_contrast rend en fail ou en indeterminate : le token, le fond, l'usage, le mode, le ratio et le seuil tels que dezyn les rend, et la raison d'un indeterminate. Ne propose aucune correction de couleur.
5. Une paire de contraste manque quand un token de couleur validé ne déclare aucune paire ($extensions["dev.dezyn"].contrastOn) alors que son nom désigne un texte, une bordure, une icône ou un focus. Propose sa déclaration seulement si les noms la rendent évidente : le projet n'a qu'un seul token de couleur validé dont le nom désigne un fond (fond, surface, background), ou un seul dont le nom partage la fin du nom du premier plan (couleur.texte.alerte et couleur.fond.alerte). Sinon, signale la paire manquante dans ton compte rendu.
6. L'usage d'une paire proposée se déduit du nom du premier plan : text pour un texte, ui pour une bordure, une icône ou un focus. Ne propose jamais large-text.
7. Une paire proposée réécrit le token avec write_tokens tel que read_tokens le rend, en ajoutant seulement l'entrée { "on": "{nom.du.fond}", "usage": "<usage>" } dans $extensions["dev.dezyn"].contrastOn : sa valeur, ses modes, sa description et ses autres extensions ne changent pas. Le fond cité est un token validé.
8. Juge la cohérence des noms par rapport à la convention majoritaire du projet (séparateur, casse, langue, ordre des segments) et signale dans ton compte rendu chaque nom qui s'en écarte, avec la convention qu'il enfreint. Ne propose jamais de renommage.
9. Ne propose jamais la suppression d'un token.
10. Ne propose jamais une correction déjà en attente. Un token qui a déjà une proposition en attente n'est pas réécrit : signale dans ton compte rendu la correction qu'il aurait reçue, si ce n'est pas celle qui attend déjà.
11. Un token remplacé par un alias ne reçoit pas de paire dans le même bilan.
12. Un bilan ouvre un lot de propositions seulement s'il crée au moins une proposition, avec open_proposal_batch avec recipe « bilan_sante » et l'intention de la règle 13, avant toute écriture. Toutes les propositions du bilan vont dans ce seul lot : passe son identifiant (batch.id) en batchId à write_tokens et close_proposal_batch, puis ferme-le avec close_proposal_batch. Sans proposition à créer, n'ouvre aucun lot.
13. L'intention du lot est « Bilan de santé du ${date} : <A> doublons remplacés par un alias, <P> paires de contraste déclarées », où A compte les propositions d'alias et P les propositions de paire. Omets une partie à zéro : « Bilan de santé du ${date} : 1 paire de contraste déclarée ». Au singulier : « 1 doublon remplacé par un alias », « 1 paire de contraste déclarée ».
14. Le bilan se termine par un compte rendu à l'utilisateur. dezyn ne le stocke pas.

## Déroulé

1. Lis les tokens du projet, puis appelle check_contrast.
2. Applique les règles, et compte A et P.
3. Si A + P > 0, ouvre le lot (règle 12), écris toutes les propositions avec son batchId en un seul appel à write_tokens, puis ferme-le.
4. Sinon, n'ouvre aucun lot et n'écris rien.
5. Termine par ton compte rendu, une section par point : l'intention du lot ou l'absence de lot ; les contrastes insuffisants ou indéterminés ; les doublons ambigus ; les paires manquantes non évidentes ; les noms incohérents ; les corrections déjà en attente ; toute erreur de dezyn. Une section vide dit « rien à signaler ».`;
};

export const bilanSante: Recipe = {
  name: "bilan_sante",
  title: "Bilan de santé",
  description:
    "Bilan de santé d'un projet : lit ses tokens et le contraste de ses paires déclarées, propose dans un seul lot les corrections sans ambiguïté, et rapporte le reste dans un compte rendu.",
  instructionsFor,
};
