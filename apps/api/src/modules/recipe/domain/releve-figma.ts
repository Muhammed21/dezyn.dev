import type { Recipe, RecipeProject } from "./recipe.ts";

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });

export const releveDateOf = (today: Date): string => {
  const day = today.getUTCDate();
  return `${day === 1 ? "1er" : String(day)} ${MONTH.format(today)}`;
};

const figmaFileSectionOf = (project: RecipeProject): string => {
  if (project.figmaFile === null) {
    return [
      "Le projet n'a pas encore de fichier Figma.",
      `Avant de comparer quoi que ce soit, demande à l'utilisateur le lien du fichier Figma du projet, puis enregistre-le avec set_project_figma_file (projectId ${project.id}, url : le lien). Si dezyn refuse le lien, montre l'erreur à l'utilisateur et redemande-le. Ne compare jamais un autre fichier, et n'en devine aucun.`,
    ].join("\n");
  }
  return `Le fichier Figma du projet est ${project.figmaFile.url} (clé ${project.figmaFile.key}).`;
};

const instructionsFor: Recipe["instructionsFor"] = ({ project, today }) => {
  const date = releveDateOf(today);
  return `# Relevé Figma du projet « ${project.name} » (${project.id})

Tu fais le relevé Figma de ce projet dezyn : tu compares son fichier Figma à ses tokens, tu déclares l'état Figma de chaque token comparé et, seulement s'il y a du nouveau, tu ouvres un seul lot de propositions qu'un éditeur relira. dezyn ne lit pas Figma : tu le lis avec tes propres accès. Toute écriture devient une proposition ; rien n'est validé sans un éditeur.

## Fichier Figma

${figmaFileSectionOf(project)}

## Lire Figma

Lis toutes les variables du fichier Figma : leurs collections, leurs modes, leurs valeurs et leurs alias. Prends le moyen dont tu disposes : use_figma du MCP distant de Figma, l'API REST des variables de Figma (Figma Enterprise), ou tout autre moyen qui lit le fichier entier. get_variable_defs ne suffit pas : il ne lit que la sélection. Si tu ne peux pas lire tout le fichier, arrête le relevé sans rien déclarer ni proposer, et dis pourquoi dans ton compte rendu.

## Lire dezyn

Lis les tokens du projet avec read_tokens avec includeProposals à true : les tokens validés, leurs modes, leur état Figma, et les propositions en attente.

## Règles

1. Un relevé compare un seul fichier Figma : celui du projet.
2. Une variable Figma correspond au token de même nom, les « / » du nom Figma lus comme les « . » du nom du token (couleur/fond/primaire correspond à couleur.fond.primaire). Quand plusieurs variables Figma correspondent au même token, déclare-le doublon dans Figma (duplicate_in_figma, avec leurs noms dans figmaVariables).
3. La comparaison porte sur les modes que le projet connaît. Un alias Figma vers une autre variable se compare à l'alias DTCG {nom.du.token}.
4. Déclare l'état Figma de chaque token comparé, même sans changement, avec declare_figma_states, 500 états au plus par appel (découpe au-delà) : synchronisé (synced) si la variable a la même valeur dans chaque mode, divergent (diverged) si sa valeur diffère dans au moins un mode, absent de Figma (missing_in_figma), doublon dans Figma (duplicate_in_figma).
5. Une variable absente de dezyn devient une proposition de création, écrite avec write_tokens en DTCG, une valeur par mode connu du projet.
6. Une valeur divergente devient une proposition (ADR 0024 §4) : déclare le token divergent (diverged) avec la valeur Figma dans figmaValue, et dezyn en fait la proposition. Ne l'écris pas aussi avec write_tokens.
7. Un token absent de Figma reçoit l'état absent de Figma (missing_in_figma). Ne propose jamais sa suppression.
8. Un mode présent seulement dans Figma n'est ni proposé ni créé : signale-le dans ton compte rendu.
9. Un relevé ouvre un lot de propositions seulement s'il crée au moins une proposition, avec open_proposal_batch avec recipe « releve_figma » et l'intention de la règle 10, avant toute écriture. Toutes les propositions du relevé vont dans ce seul lot : passe son identifiant (batch.id) en batchId à write_tokens, declare_figma_states et close_proposal_batch, puis ferme-le avec close_proposal_batch. Sans proposition à créer, n'ouvre aucun lot et déclare les états sans batchId.
10. L'intention du lot est « Relevé Figma du ${date} : <N> nouveaux tokens, <M> valeurs changées », où N compte les propositions de création et M les valeurs divergentes proposées. Omets une partie à zéro : « Relevé Figma du ${date} : 2 valeurs changées ». Au singulier : « 1 nouveau token », « 1 valeur changée ».
11. N et M ne comptent que les propositions créées par ce relevé. Compare la valeur Figma à la proposition en attente sur le même nom quand il y en a une, sinon à la valeur validée : une proposition encore en attente depuis un relevé précédent, de même valeur, n'est ni recopiée ni comptée.
12. Un token créé par un relevé n'a pas d'état Figma tant que sa proposition n'est pas validée : ne le déclare pas. Au relevé suivant, une fois validé, il est déclaré synchronisé (synced).
13. Le relevé se termine par un compte rendu à l'utilisateur. dezyn ne le stocke pas.

## Déroulé

1. Lis le fichier Figma du projet, puis les tokens du projet.
2. Compare-les selon les règles, et compte N et M.
3. Si N + M > 0, ouvre le lot (règle 9), écris les propositions de création avec son batchId, déclare les états Figma avec son batchId, puis ferme-le.
4. Sinon, déclare les états Figma sans batchId, et n'ouvre aucun lot.
5. Termine par ton compte rendu : l'intention du lot ou l'absence de lot, les tokens absents de Figma, les modes présents seulement dans Figma, et toute erreur de dezyn.`;
};

export const releveFigma: Recipe = {
  name: "releve_figma",
  title: "Relevé Figma",
  description:
    "Relevé Figma d'un projet : compare le fichier Figma du projet à ses tokens, déclare l'état Figma de chaque token comparé et, seulement s'il y a du nouveau, ouvre un seul lot de propositions à relire.",
  instructionsFor,
};
