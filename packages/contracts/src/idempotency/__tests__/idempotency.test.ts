import { describe, expect, it } from "vitest";

import {
  checkOutputSchema,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdempotencyInProgressProblem,
  IdempotencyKeyReusedProblem,
  InvalidIdempotencyKeyProblem,
} from "../../index.ts";

const makeProblem = (
  type: string,
  status: number,
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  type: `https://dezyn.dev/problems/${type}`,
  title: "Refus d'idempotence",
  status,
  ...overrides,
});

const PROBLEMS = [
  ["InvalidIdempotencyKeyProblem", InvalidIdempotencyKeyProblem, "invalid-idempotency-key", 400],
  ["IdempotencyInProgressProblem", IdempotencyInProgressProblem, "idempotency-in-progress", 409],
  ["IdempotencyKeyReusedProblem", IdempotencyKeyReusedProblem, "idempotency-key-reused", 422],
] as const;

describe("en-têtes d'idempotence d'une écriture REST", () => {
  it("nomme l'en-tête de la clé et celui du rejeu", () => {
    expect([IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER]).toEqual([
      "Idempotency-Key",
      "Idempotency-Replayed",
    ]);
  });
});

describe.each(PROBLEMS)("refus %s", (name, schema, type, status) => {
  it("lit le refus et garde une clé ajoutée plus tard par le serveur (ADR 0023)", () => {
    const later = makeProblem(type, status, { instance: "/v1/projects/x/tokens" });

    expect(schema.parse(later)).toEqual(later);
  });

  it.each([
    ["d'un autre type", { type: "about:blank" }],
    ["d'un autre statut", { status: 500 }],
    ["sans titre", { title: undefined }],
  ])("refuse un problème %s", (_case, overrides) => {
    expect(schema.safeParse(makeProblem(type, status, overrides)).success).toBe(false);
  });

  it("respecte les conventions de sortie (ADR 0023 §4)", () => {
    expect(checkOutputSchema(name, schema)).toEqual([]);
  });
});

describe("les trois refus d'idempotence se distinguent par leur type", () => {
  it.each(PROBLEMS)("%s refuse le type d'un autre refus", (_name, schema, type, status) => {
    const others = PROBLEMS.filter(([, , other]) => other !== type);

    expect(
      others.map(([, , other]) => schema.safeParse(makeProblem(other, status)).success),
    ).toEqual([false, false]);
  });
});
