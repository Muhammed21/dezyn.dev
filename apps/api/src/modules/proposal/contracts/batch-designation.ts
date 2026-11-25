import { Uuid } from "@repo/contracts";

import type { DesignationRefusal } from "../domain/proposal-batch.ts";

export type { DesignationRefusal } from "../domain/proposal-batch.ts";

export const DESIGNATION_REFUSAL_TEXT: Readonly<Record<DesignationRefusal, string>> = {
  unknown_batch: "batchId : Lot introuvable",
  closed_batch: "batchId : Lot fermé",
};

export const BatchIdArgument = Uuid.optional().describe(
  "L'identifiant d'un lot désigné, rendu par open_proposal_batch ouvert avec une recette. Sans lui, l'appel vise le lot ouvert de l'IA dans ce projet, comme avant. Un lot inconnu, fermé ou qui n'est pas celui de l'IA dans ce projet est refusé, sans rien écrire.",
);

export const isDesignationRefusal = (failure: unknown): failure is DesignationRefusal =>
  failure === "unknown_batch" || failure === "closed_batch";
