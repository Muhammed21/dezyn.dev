import { describe, expect, it } from "vitest";

import { designatedBatch } from "../proposal-batch.ts";
import type { ProposalBatch } from "../proposal.ts";

const PROJECT_ID = "c0a80101-0000-4000-8000-0000000000aa";
const USER_ID = "c0a80101-0000-4000-8000-0000000000bb";
const CLIENT_ID = "claude-code";
const OPENED_AT = new Date("2026-11-25T09:00:00Z");

const makeBatch = (batch: Partial<ProposalBatch> = {}): ProposalBatch => ({
  id: "c0a80101-0000-4000-8000-000000000001",
  projectId: PROJECT_ID,
  userId: USER_ID,
  clientId: CLIENT_ID,
  intent: "Relevé Figma du 25 nov.",
  state: "open",
  openedAt: OPENED_AT,
  lastWrittenAt: OPENED_AT,
  ...batch,
});

const makeCaller = (caller: Partial<Record<"projectId" | "userId" | "clientId", string>> = {}) => ({
  projectId: PROJECT_ID,
  userId: USER_ID,
  clientId: CLIENT_ID,
  ...caller,
});

describe("un identifiant de lot désigne un lot ouvert de l'appelant (ADR 0059 §2)", () => {
  it("rend le lot ouvert du même utilisateur, du même client et du même projet", () => {
    const batch = makeBatch();

    expect(designatedBatch({ batch, caller: makeCaller(), now: OPENED_AT })).toEqual({ batch });
  });

  it("refuse un identifiant inconnu", () => {
    expect(designatedBatch({ batch: undefined, caller: makeCaller(), now: OPENED_AT })).toEqual({
      refusal: "unknown_batch",
    });
  });

  it.each([
    ["d'un autre utilisateur", { userId: "c0a80101-0000-4000-8000-0000000000cc" }],
    ["d'un autre client", { clientId: "cursor" }],
    ["d'un autre projet", { projectId: "c0a80101-0000-4000-8000-0000000000dd" }],
  ])("refuse le lot %s comme un lot inconnu", (_, other) => {
    expect(
      designatedBatch({ batch: makeBatch(), caller: makeCaller(other), now: OPENED_AT }),
    ).toEqual({ refusal: "unknown_batch" });
  });

  it("refuse le lot d'un membre supprimé comme un lot inconnu", () => {
    expect(
      designatedBatch({ batch: makeBatch({ userId: null }), caller: makeCaller(), now: OPENED_AT }),
    ).toEqual({ refusal: "unknown_batch" });
  });

  it("refuse un lot fermé", () => {
    expect(
      designatedBatch({
        batch: makeBatch({ state: "closed" }),
        caller: makeCaller(),
        now: OPENED_AT,
      }),
    ).toEqual({ refusal: "closed_batch" });
  });

  it("refuse un lot resté 30 minutes sans écriture", () => {
    expect(
      designatedBatch({
        batch: makeBatch(),
        caller: makeCaller(),
        now: new Date("2026-11-25T09:30:00Z"),
      }),
    ).toEqual({ refusal: "closed_batch" });
  });
});
