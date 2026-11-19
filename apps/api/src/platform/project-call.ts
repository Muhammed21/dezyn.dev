import type { Result } from "@repo/result";

export type RecordFailure = "not_found" | "history_unavailable";

export const RECORD_FAILURE_TEXT: Readonly<Record<RecordFailure, string>> = {
  not_found: "Projet introuvable",
  history_unavailable: "Historique indisponible",
};

export const isServerFailure = (failure: unknown): boolean => failure === "history_unavailable";

export type RecordProjectCall = <T, E>(call: {
  readonly tool: string;
  readonly projectId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly correlationId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly replayed?: boolean;
  readonly run: (project: { readonly spaceId: string }) => Promise<Result<T, E>>;
}) => Promise<Result<T, E | RecordFailure>>;
