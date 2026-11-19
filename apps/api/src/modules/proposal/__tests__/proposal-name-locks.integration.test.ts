import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PostgresTransaction } from "#db";
import { type App, callMcp, withIdentityApp } from "#testing/authorization-flow.ts";
import { whileHolding } from "#testing/lock-wait.ts";
import { seedProject } from "#testing/project-fixtures.ts";
import { storageMeterOn } from "#testing/project-storage.ts";
import { makeColorToken } from "#testing/token-fixtures.ts";
import { schema } from "@repo/db";

import { postgresProposalStore } from "../infrastructure/postgres-proposals.ts";

const CONTESTED_NAME = "couleur.fond.primaire";

const HELD_NAMES = ["couleur.accent", CONTESTED_NAME, "couleur.texte"];

const HELD_VALUE = { colorSpace: "srgb", components: [0.9, 0.1, 0.1] };

const seedHeldProposal = async (
  tx: PostgresTransaction,
  { projectId, userId }: { readonly projectId: string; readonly userId: string },
) => {
  const batchId = randomUUID();
  const writtenAt = new Date();
  await tx.insert(schema.proposalBatch).values({
    id: batchId,
    projectId,
    userId,
    clientId: randomUUID(),
    intent: null,
    state: "open",
    openedAt: writtenAt,
    lastWrittenAt: writtenAt,
  });
  await tx.insert(schema.proposal).values({
    id: randomUUID(),
    projectId,
    batchId,
    tokenName: CONTESTED_NAME,
    kind: "create",
    payload: makeColorToken({ name: CONTESTED_NAME, $value: HELD_VALUE }),
    status: "proposed",
    createdAt: writtenAt,
  });
};

const holdNames = async (
  tx: PostgresTransaction,
  writer: { readonly projectId: string; readonly userId: string },
) => {
  await postgresProposalStore(tx, storageMeterOn(tx)).pendingOf(writer.projectId, HELD_NAMES);
  await seedHeldProposal(tx, writer);
};

const writeContestedToken = async (
  app: App,
  { accessToken, projectId }: { readonly accessToken: string; readonly projectId: string },
) => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "tools/call",
    params: {
      name: "write_tokens",
      arguments: { projectId, tokens: [makeColorToken({ name: CONTESTED_NAME })] },
    },
  });
  const { result } = await response.json();
  return result;
};

describe("une écriture attend les noms qu'une autre écriture tient", () => {
  it("un write_tokens sur un nom tenu au milieu d'une autre écriture remplace la proposition qu'elle pose", () =>
    withIdentityApp(async (app, db) => {
      const { accessToken, projectId, userId } = await seedProject(app, db);

      const written = await whileHolding(db, {
        hold: (tx) => holdNames(tx, { projectId, userId }),
        meanwhile: () => writeContestedToken(app, { accessToken, projectId }),
      });

      expect(written.isError).toBeUndefined();
      expect(written.structuredContent.replaced).toEqual([
        expect.objectContaining({ name: CONTESTED_NAME }),
      ]);
      expect(written.structuredContent.proposals).toEqual([
        expect.objectContaining({ name: CONTESTED_NAME, kind: "create" }),
      ]);
    }));
});
