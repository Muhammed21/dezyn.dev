import { createApp } from "#create-app";
import type { HistoryUseCases } from "#modules/history/application/history-use-cases.ts";
import type { Auth } from "#modules/identity/application/auth.ts";
import type { ProjectUseCases } from "#modules/project/application/project-use-cases.ts";
import type { ProposalUseCases } from "#modules/proposal/application/proposal-use-cases.ts";
import type { SpaceUseCases } from "#modules/space/application/spaces.ts";
import type { ProjectAccess } from "#modules/space/contracts/membership.ts";
import type { TokenUseCases } from "#modules/token/application/token-use-cases.ts";
import type { Database } from "#platform/database.ts";
import type { Idempotent } from "#platform/idempotency.ts";
import type { LogRecord } from "#platform/logging.ts";
import { err, ok } from "@repo/result";

export const makeDatabase = (overrides: Partial<Database> = {}): Database => ({
  ping: () => Promise.resolve(),
  timeQueries: async (run) => {
    await run();
    return { queries: 0, durationMs: 0 };
  },
  ...overrides,
});

export const makeAuth = (overrides: Partial<Auth> = {}): Auth => ({
  baseURL: "http://127.0.0.1:3000",
  handle: () => Promise.resolve(new Response(null, { status: 404 })),
  authorizationServerMetadata: () => Promise.resolve(new Response(null, { status: 404 })),
  protectedResourceMetadata: () => Promise.resolve(new Response(null, { status: 404 })),
  verifyAccessToken: () => Promise.resolve(err("invalid_token")),
  sessionOf: () => Promise.resolve(ok(undefined)),
  checkSigningKey: () => Promise.resolve(ok(undefined)),
  ...overrides,
});

export const makeSpaces = (): SpaceUseCases => ({
  allowedInSpace: () => Promise.resolve(false),
  listMySpaces: () => Promise.resolve([]),
  readSpace: () => Promise.resolve(err("not_found")),
  listMembers: () => Promise.resolve(err("not_found")),
  inviteMember: () => Promise.resolve(err("not_found")),
  invitedSpaceOf: () => Promise.resolve(undefined),
  acceptInvitation: () => Promise.resolve(err("gone")),
  leaveSpace: () => Promise.resolve(err("not_found")),
  changeRole: () => Promise.resolve(err("not_found")),
  removeMember: () => Promise.resolve(err("not_found")),
});

export const makeProjects = (): ProjectUseCases => ({
  createProject: () => Promise.resolve(err("not_found")),
  listProjects: () => Promise.resolve(err("not_found")),
  subscribeToProject: () => Promise.resolve(err("not_found")),
});

export const makeHistory = (): HistoryUseCases => ({
  readHistory: () => Promise.resolve(err("not_found")),
  recordProjectCall: () => Promise.resolve(err("not_found")),
});

export const makeTokens = (): TokenUseCases => ({
  addToken: () => Promise.resolve(err("not_found")),
  readTokens: () => Promise.resolve({ modes: [], tokens: [] }),
  checkTokens: () => Promise.resolve([]),
  readProjectTokens: () => Promise.resolve(err("not_found")),
  declareFigmaStates: () => Promise.resolve(err("not_found")),
  exportTokens: () => Promise.resolve(err("not_found")),
  importTokens: () => Promise.resolve(err("not_found")),
});

export const makeProposals = (): ProposalUseCases => ({
  writeTokens: () => Promise.reject(new Error("Pas de proposition dans ce test")),
  openBatch: () => Promise.reject(new Error("Pas de lot dans ce test")),
  closeBatch: () => Promise.reject(new Error("Pas de lot dans ce test")),
  listBatches: () => Promise.resolve(err("not_found")),
  batchOf: () => Promise.resolve(err("not_found")),
  reviewProposal: () => Promise.resolve(err("not_found")),
  validateBatch: () => Promise.resolve(err("not_found")),
  pendingProposalsOf: () => Promise.resolve([]),
  projectOfProposal: () => Promise.resolve(undefined),
  projectOfBatch: () => Promise.resolve(undefined),
});

export const makeIdempotent =
  (): Idempotent =>
  async ({ run }) => ({ kind: "executed", response: (await run()).response });

export const makeProjectAccess = (): ProjectAccess => async () => undefined;

export const makeApp = ({
  db = makeDatabase(),
  auth = makeAuth(),
  webUrl = "https://dezyn.dev",
}: { readonly db?: Database; readonly auth?: Auth; readonly webUrl?: string } = {}) => {
  const records: LogRecord[] = [];
  const app = createApp({
    webUrl,
    db,
    auth,
    log: (record) => records.push(record),
    spaces: makeSpaces(),
    projects: makeProjects(),
    history: makeHistory(),
    tokens: makeTokens(),
    proposals: makeProposals(),
    idempotent: makeIdempotent(),
    projectAccess: makeProjectAccess(),
  });
  return { app, records };
};
