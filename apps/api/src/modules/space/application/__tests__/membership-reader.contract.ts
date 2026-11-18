import { describe, expect, it } from "vitest";

import type { MembershipRecord } from "../membership-reader.fake.ts";
import type { MembershipReader } from "../membership-reader.ts";

export type MakeMembershipReader = (
  memberships: readonly MembershipRecord[],
) => Promise<MembershipReader>;

const SPACE_ID = "6d1f0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const OTHER_SPACE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ADA = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const GRACE = "9b8a7f6e-5d4c-4b3a-8f2e-1d0c9b8a7f6e";

const CLOSED_STATE = { closedAt: new Date("2026-10-01T08:00:00.000Z") };

const makeMembershipRecord = (overrides: Partial<MembershipRecord> = {}): MembershipRecord => ({
  spaceId: SPACE_ID,
  userId: ADA,
  role: "editor",
  closedAt: null,
  ...overrides,
});

export const describeMembershipReaderContract = (make: MakeMembershipReader) => {
  describe("contrat de MembershipReader", () => {
    it("rend l'adhésion d'un éditeur de l'espace, avec son rôle", async () => {
      const reader = await make([makeMembershipRecord({ role: "editor" })]);

      expect(await reader.activeMembership({ spaceId: SPACE_ID, userId: ADA })).toStrictEqual({
        spaceId: SPACE_ID,
        userId: ADA,
        role: "editor",
      });
    });

    it("rend l'adhésion d'un propriétaire de l'espace, avec son rôle", async () => {
      const reader = await make([makeMembershipRecord({ role: "owner" })]);

      expect(await reader.activeMembership({ spaceId: SPACE_ID, userId: ADA })).toStrictEqual({
        spaceId: SPACE_ID,
        userId: ADA,
        role: "owner",
      });
    });

    it("rend l'adhésion du membre demandé parmi ceux de l'espace", async () => {
      const reader = await make([
        makeMembershipRecord({ userId: ADA, role: "owner" }),
        makeMembershipRecord({ userId: GRACE, role: "editor" }),
      ]);

      expect(await reader.activeMembership({ spaceId: SPACE_ID, userId: GRACE })).toStrictEqual({
        spaceId: SPACE_ID,
        userId: GRACE,
        role: "editor",
      });
    });

    it("ne rend rien pour un utilisateur qui n'est pas membre de l'espace", async () => {
      const reader = await make([makeMembershipRecord({ userId: ADA })]);

      expect(await reader.activeMembership({ spaceId: SPACE_ID, userId: GRACE })).toBeUndefined();
    });

    it("ne rend rien pour un membre d'un autre espace", async () => {
      const reader = await make([makeMembershipRecord({ spaceId: OTHER_SPACE_ID })]);

      expect(await reader.activeMembership({ spaceId: SPACE_ID, userId: ADA })).toBeUndefined();
    });

    it("ne rend rien pour un membre parti de l'espace", async () => {
      const reader = await make([makeMembershipRecord(CLOSED_STATE)]);

      expect(await reader.activeMembership({ spaceId: SPACE_ID, userId: ADA })).toBeUndefined();
    });

    it("rend l'adhésion en cours d'un membre revenu dans l'espace après en être parti", async () => {
      const reader = await make([
        makeMembershipRecord({ ...CLOSED_STATE, role: "owner" }),
        makeMembershipRecord({ role: "editor" }),
      ]);

      expect(await reader.activeMembership({ spaceId: SPACE_ID, userId: ADA })).toStrictEqual({
        spaceId: SPACE_ID,
        userId: ADA,
        role: "editor",
      });
    });
  });
};
