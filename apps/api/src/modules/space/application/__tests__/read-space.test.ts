import { describe, expect, it } from "vitest";

import { allowedActionsOf, type Membership } from "../../domain/can.ts";
import { spaceStorageOf } from "../../domain/storage-limit.ts";
import { inMemoryMembershipReader } from "../membership-reader.fake.ts";
import { readSpace } from "../read-space.ts";

const SPACE = {
  id: "6d1f0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
  name: "Studio Ada",
  plan: "team",
} as const;
const ADA = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const GRACE = "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e";

const makeMembership = (overrides: Partial<Membership> = {}): Membership => ({
  spaceId: SPACE.id,
  userId: ADA,
  role: "editor",
  ...overrides,
});

const STORED_BYTES = 1_200_000;

const readWith = (memberships: readonly Membership[], storedBytes = STORED_BYTES) =>
  readSpace({
    memberships: inMemoryMembershipReader(memberships),
    spaces: { find: async () => ({ ...SPACE, storedBytes }) },
  });

describe("lire un espace", () => {
  it("rend l'espace, le rôle du membre qui le lit et les actions que ce rôle lui permet", async () => {
    const read = readWith([makeMembership({ role: "editor" })]);

    expect(await read({ spaceId: SPACE.id, userId: ADA })).toEqual({
      ok: true,
      value: {
        ...SPACE,
        role: "editor",
        allowedActions: allowedActionsOf("editor"),
        storage: spaceStorageOf({ plan: SPACE.plan, storedBytes: STORED_BYTES }),
      },
    });
  });

  it.each(["owner", "editor"] as const)(
    "rend au rôle %s le stockage de l'espace, sa limite et l'alerte à 80 % (ADR 0032)",
    async (role) => {
      const read = readWith([makeMembership({ role })], 16_000_000_000);

      const space = await read({ spaceId: SPACE.id, userId: ADA });

      expect(space.ok && space.value.storage).toEqual({
        usedBytes: 16_000_000_000,
        limitBytes: 20_000_000_000,
        alertReached: true,
      });
    },
  );

  it("ne trouve pas l'espace pour un utilisateur qui n'en est pas membre", async () => {
    const read = readWith([makeMembership({ userId: ADA })]);

    expect(await read({ spaceId: SPACE.id, userId: GRACE })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("ne trouve pas l'espace pour un membre d'un autre espace", async () => {
    const read = readWith([makeMembership({ spaceId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" })]);

    expect(await read({ spaceId: SPACE.id, userId: ADA })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
