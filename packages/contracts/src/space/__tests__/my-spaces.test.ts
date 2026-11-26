import { describe, expect, it } from "vitest";
import { z } from "zod";

import { checkOutputSchema, MySpaceOutput, MySpacesOutput, SpaceOutput } from "../../index.ts";

const makeSpace = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Ada Lovelace",
  plan: "free",
  role: "owner",
  allowedActions: ["space.read", "project.create"],
  ...overrides,
});

describe("sortie de la liste de mes espaces", () => {
  it("garde un plan et un rôle ajoutés plus tard par le serveur (ADR 0023 §2)", () => {
    const later = makeSpace({ plan: "enterprise", role: "viewer" });

    expect(MySpacesOutput.parse({ spaces: [later] })).toEqual({ spaces: [later] });
  });

  it("garde une clé ajoutée plus tard par le serveur (ADR 0023 §1)", () => {
    const later = { spaces: [makeSpace({ projectCount: 3 })], nextCursor: null };

    expect(MySpacesOutput.parse(later)).toEqual(later);
  });

  it("garde une action ajoutée plus tard par le serveur (ADR 0023 §2)", () => {
    const later = makeSpace({ allowedActions: ["space.read", "space.archive"] });

    expect(MySpacesOutput.parse({ spaces: [later] })).toEqual({ spaces: [later] });
  });

  it("refuse un espace sans ses actions permises", () => {
    const { allowedActions: _omitted, ...withoutActions } = makeSpace();

    expect(MySpacesOutput.safeParse({ spaces: [withoutActions] }).success).toBe(false);
  });

  it("lit un espace seul avec ses actions permises, et le refuse sans elles", () => {
    const { allowedActions: _omitted, ...withoutActions } = makeSpace();

    expect(MySpaceOutput.parse(makeSpace())).toEqual(makeSpace());
    expect(MySpaceOutput.safeParse(withoutActions).success).toBe(false);
  });

  it("refuse un identifiant d'espace qui n'est pas un UUID", () => {
    expect(MySpacesOutput.safeParse({ spaces: [makeSpace({ id: "espace-1" })] }).success).toBe(
      false,
    );
  });

  it("annonce à l'IA les plans, les rôles et les actions connus", () => {
    expect(z.toJSONSchema(MySpacesOutput)).toMatchObject({
      properties: {
        spaces: {
          items: {
            properties: {
              plan: { anyOf: [{ enum: ["free", "team"] }, { type: "string" }] },
              role: { anyOf: [{ enum: ["owner", "editor"] }, { type: "string" }] },
              allowedActions: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      enum: [
                        "space.read",
                        "project.create",
                        "member.invite",
                        "member.leave",
                        "member.manage",
                        "project.setFigmaFile",
                        "token.create",
                        "token.delete",
                        "token.declareFigmaState",
                        "proposal.review",
                        "subscription.checkout",
                      ],
                    },
                    { type: "string" },
                  ],
                },
              },
            },
          },
        },
      },
    });
  });
});

const NOT_FROZEN = { frozen: false, exceededFreeLimits: [] } as const;

const makeStorage = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  usedBytes: 400_000_000,
  limitBytes: 500_000_000,
  alertReached: true,
  ...overrides,
});

describe("sortie de la lecture d'un espace, avec son stockage (ADR 0032)", () => {
  it("lit l'espace, son stockage utilisé, la limite de son plan et l'alerte à 80 %", () => {
    const read = makeSpace({ ...NOT_FROZEN, storage: makeStorage() });

    expect(SpaceOutput.parse(read)).toEqual(read);
  });

  it("refuse un espace lu sans son stockage", () => {
    expect(SpaceOutput.safeParse(makeSpace()).success).toBe(false);
  });

  it.each([
    ["un stockage négatif", { usedBytes: -1 }],
    ["une limite fractionnaire", { limitBytes: 1.5 }],
    ["une alerte qui n'est pas un booléen", { alertReached: "oui" }],
  ])("refuse %s", (_case, storage) => {
    expect(
      SpaceOutput.safeParse(makeSpace({ ...NOT_FROZEN, storage: makeStorage(storage) })).success,
    ).toBe(false);
  });

  it("garde une clé de stockage ajoutée plus tard par le serveur (ADR 0023 §1)", () => {
    const later = makeSpace({ ...NOT_FROZEN, storage: makeStorage({ purgeAt: "2026-12-01" }) });

    expect(SpaceOutput.parse(later)).toEqual(later);
  });
});

const makeSubscription = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  status: "active",
  currentPeriodEnd: "2026-12-22T10:00:00.000Z",
  payer: { name: "Ada Lovelace", email: "ada@dezyn.test", you: true, left: false },
  ...overrides,
});

describe("sortie de l'abonnement d'un espace, lu par ses propriétaires (ADR 0050 §3)", () => {
  it("lit le statut, la fin de la période en cours et le payeur", () => {
    const read = makeSpace({
      ...NOT_FROZEN,
      storage: makeStorage(),
      subscription: makeSubscription(),
    });

    expect(SpaceOutput.parse(read)).toEqual(read);
  });

  it("lit un espace sans abonnement", () => {
    const read = makeSpace({ ...NOT_FROZEN, storage: makeStorage() });

    expect(SpaceOutput.parse(read)).toEqual(read);
  });

  it("lit un abonnement dont le payeur a supprimé son compte, sans payeur", () => {
    const read = makeSpace({
      ...NOT_FROZEN,
      storage: makeStorage(),
      subscription: makeSubscription({ payer: null }),
    });

    expect(SpaceOutput.parse(read)).toEqual(read);
  });

  it("lit un abonnement sans fin de période", () => {
    const read = makeSpace({
      ...NOT_FROZEN,
      storage: makeStorage(),
      subscription: makeSubscription({ currentPeriodEnd: null }),
    });

    expect(SpaceOutput.parse(read)).toEqual(read);
  });

  it("garde un statut ajouté plus tard par le serveur (ADR 0023 §2)", () => {
    const later = makeSpace({
      ...NOT_FROZEN,
      storage: makeStorage(),
      subscription: makeSubscription({ status: "paused" }),
    });

    expect(SpaceOutput.parse(later)).toEqual(later);
  });

  it.each([
    ["une fin de période qui n'est pas une date", { currentPeriodEnd: "le mois prochain" }],
    ["un abonnement sans payeur", { payer: undefined }],
    [
      "un payeur sans l'indication que c'est moi",
      { payer: { name: "Ada", email: "a@b.c", left: false } },
    ],
    [
      "un payeur sans l'indication qu'il est parti",
      { payer: { name: "Ada", email: "a@b.c", you: false } },
    ],
  ])("refuse %s", (_case, subscription) => {
    expect(
      SpaceOutput.safeParse(
        makeSpace({
          ...NOT_FROZEN,
          storage: makeStorage(),
          subscription: makeSubscription(subscription),
        }),
      ).success,
    ).toBe(false);
  });
});

describe("sortie du gel d'un espace, avec les limites Free dépassées (ADR 0050 §5)", () => {
  it("lit un espace gelé et les limites Free qu'il dépasse", () => {
    const read = makeSpace({
      storage: makeStorage(),
      frozen: true,
      exceededFreeLimits: ["projects", "storage", "members"],
    });

    expect(SpaceOutput.parse(read)).toEqual(read);
  });

  it("garde une limite ajoutée plus tard par le serveur (ADR 0023 §2)", () => {
    const later = makeSpace({
      storage: makeStorage(),
      frozen: true,
      exceededFreeLimits: ["components"],
    });

    expect(SpaceOutput.parse(later)).toEqual(later);
  });

  it.each([
    ["un espace lu sans son gel", { frozen: undefined }],
    ["un gel qui n'est pas un booléen", { frozen: "oui" }],
    ["un espace lu sans ses limites dépassées", { exceededFreeLimits: undefined }],
  ])("refuse %s", (_case, overrides) => {
    expect(
      SpaceOutput.safeParse(makeSpace({ ...NOT_FROZEN, storage: makeStorage(), ...overrides }))
        .success,
    ).toBe(false);
  });
});

describe("conventions de sortie de la liste de mes espaces (ADR 0023 §4)", () => {
  it("SpaceOutput les respecte", () => {
    expect(checkOutputSchema("SpaceOutput", SpaceOutput)).toEqual([]);
  });

  it("MySpacesOutput les respecte", () => {
    expect(checkOutputSchema("MySpacesOutput", MySpacesOutput)).toEqual([]);
  });

  it("MySpaceOutput les respecte", () => {
    expect(checkOutputSchema("MySpaceOutput", MySpaceOutput)).toEqual([]);
  });
});
