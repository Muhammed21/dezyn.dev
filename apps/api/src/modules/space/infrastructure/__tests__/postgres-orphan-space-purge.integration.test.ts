import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import { remainsOfSpace, seedSpaceWithData } from "#testing/orphan-space-fixtures.ts";
import { migrate } from "@repo/db";
import { withThrowawayDatabase } from "@repo/db/testing";

import { postgresOrphanPurgeUnitOfWork } from "../postgres-orphan-space-purge.ts";

type Databases = { readonly app: PostgresDatabase; readonly maintainer: PostgresDatabase };

const withDatabases = (run: (databases: Databases) => Promise<void>) =>
  withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
    await migrate({ connectionString: migratorUrl });
    const app = createPostgresDatabase({ url: appUrl });
    const maintainer = createPostgresDatabase({ url: maintainerUrl });
    try {
      await run({ app, maintainer });
    } finally {
      await Promise.all([app.close(), maintainer.close()]);
    }
  });

const ALWAYS_PURGEABLE = () => true;

describe("une étape de purge relit l'espace dans sa transaction (ADR 0052 §4)", () => {
  it("saute un espace qui a un membre ouvert, et annule la suppression de ses invitations", () =>
    withDatabases(async ({ app, maintainer }) => {
      const { spaceId } = await seedSpaceWithData(app, { openMember: true });
      const before = await remainsOfSpace(app, spaceId);

      expect(
        await postgresOrphanPurgeUnitOfWork(maintainer).step({
          spaceId,
          purgeable: ALWAYS_PURGEABLE,
        }),
      ).toBe("skipped");

      expect(await remainsOfSpace(app, spaceId)).toEqual(before);
      expect(before).toMatchObject({ space_invitation: 1 });
    }));

  it("saute un espace orphelin que la règle de l'abonnement ou du délai de grâce ne laisse plus purger, et le laisse intact", () =>
    withDatabases(async ({ app, maintainer }) => {
      const orphanedAt = new Date("2026-11-20T10:00:00.000Z");
      const { spaceId } = await seedSpaceWithData(app, {
        orphanedAt,
        subscription: { status: "active", currentPeriodEnd: null },
      });
      const before = await remainsOfSpace(app, spaceId);
      const seen: unknown[] = [];

      expect(
        await postgresOrphanPurgeUnitOfWork(maintainer).step({
          spaceId,
          purgeable: (orphan) => {
            seen.push(orphan);
            return false;
          },
        }),
      ).toBe("skipped");

      expect(seen).toEqual([
        {
          spaceId,
          orphanedAt,
          subscription: { status: "active", currentPeriodEnd: undefined, cancelRequested: false },
        },
      ]);
      expect(await remainsOfSpace(app, spaceId)).toEqual(before);
    }));

  it("saute un espace qui n'existe plus", () =>
    withDatabases(async ({ maintainer }) => {
      expect(
        await postgresOrphanPurgeUnitOfWork(maintainer).step({
          spaceId: randomUUID(),
          purgeable: ALWAYS_PURGEABLE,
        }),
      ).toBe("skipped");
    }));

  it("relève une erreur de l'étape au lieu de sauter l'espace", () =>
    withDatabases(async ({ app, maintainer }) => {
      const { spaceId } = await seedSpaceWithData(app);

      await expect(
        postgresOrphanPurgeUnitOfWork(maintainer).step({
          spaceId,
          purgeable: () => {
            throw new Error("règle indisponible");
          },
        }),
      ).rejects.toThrow("règle indisponible");
    }));
});
