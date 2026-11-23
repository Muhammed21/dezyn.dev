import { describe, expect, it } from "vitest";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import {
  NOTHING_LEFT,
  remainsOfSpace,
  seedHistory,
  seedSpaceProject,
  seedSpaceWithData,
} from "#testing/orphan-space-fixtures.ts";
import { migrate } from "@repo/db";
import { withThrowawayDatabase } from "@repo/db/testing";

import { orphanPurgeLockOn, orphanSpacePurge } from "../space-module.ts";

const NOW = new Date("2026-11-23T10:00:00.000Z");

const BEFORE_NOW = new Date(NOW.getTime() - 60_000);

const AFTER_NOW = new Date(NOW.getTime() + 60_000);

const MORE_THAN_ONE_BATCH = 1_201;

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

const purgeOf = (maintainer: PostgresDatabase, now: Date = NOW) =>
  orphanSpacePurge({ db: maintainer, log: () => undefined, now: () => now })();

describe("la purge des espaces orphelins, avec le rôle history_maintainer (ADR 0051)", () => {
  it("supprime un espace sans membre ouvert ni abonnement, avec toutes ses données", () =>
    withDatabases(async ({ app, maintainer }) => {
      const { spaceId } = await seedSpaceWithData(app);

      expect(await purgeOf(maintainer)).toEqual({ purgedSpaces: 1, waitingSpaces: 0 });

      expect(await remainsOfSpace(app, spaceId)).toEqual(NOTHING_LEFT);
    }));

  it("ne touche jamais un espace qui a encore un membre ouvert", () =>
    withDatabases(async ({ app, maintainer }) => {
      const kept = await seedSpaceWithData(app, { openMember: true });
      const before = await remainsOfSpace(app, kept.spaceId);
      const orphan = await seedSpaceWithData(app);

      expect(await purgeOf(maintainer)).toEqual({ purgedSpaces: 1, waitingSpaces: 0 });

      expect(await remainsOfSpace(app, kept.spaceId)).toEqual(before);
      expect(before).toMatchObject({ space: 1, project: 1, token: 3, history_entry: 2 });
      expect(await remainsOfSpace(app, orphan.spaceId)).toEqual(NOTHING_LEFT);
    }));

  it("supprime un espace orphelin dont l'abonnement est terminé", () =>
    withDatabases(async ({ app, maintainer }) => {
      const { spaceId } = await seedSpaceWithData(app, {
        subscription: { status: "ended", currentPeriodEnd: AFTER_NOW },
      });

      expect(await purgeOf(maintainer)).toEqual({ purgedSpaces: 1, waitingSpaces: 0 });

      expect(await remainsOfSpace(app, spaceId)).toEqual(NOTHING_LEFT);
    }));

  it("attend la fin de la période payée d'un abonnement qui n'est pas terminé, puis supprime l'espace", () =>
    withDatabases(async ({ app, maintainer }) => {
      const { spaceId } = await seedSpaceWithData(app, {
        subscription: { status: "canceling", currentPeriodEnd: AFTER_NOW },
      });
      const before = await remainsOfSpace(app, spaceId);

      expect(await purgeOf(maintainer, NOW)).toEqual({ purgedSpaces: 0, waitingSpaces: 1 });
      expect(await remainsOfSpace(app, spaceId)).toEqual(before);

      expect(await purgeOf(maintainer, AFTER_NOW)).toEqual({ purgedSpaces: 1, waitingSpaces: 0 });
      expect(await remainsOfSpace(app, spaceId)).toEqual(NOTHING_LEFT);
    }));

  it("attend tant que la résiliation n'a pas été envoyée à Polar, même après la fin de la période", () =>
    withDatabases(async ({ app, maintainer }) => {
      const { spaceId } = await seedSpaceWithData(app, {
        subscription: {
          status: "active",
          currentPeriodEnd: BEFORE_NOW,
          cancelRequestedAt: BEFORE_NOW,
        },
      });
      const before = await remainsOfSpace(app, spaceId);

      expect(await purgeOf(maintainer)).toEqual({ purgedSpaces: 0, waitingSpaces: 1 });

      expect(await remainsOfSpace(app, spaceId)).toEqual(before);
    }));

  it("supprime en plusieurs lots un historique de plusieurs projets plus grand qu'un lot", () =>
    withDatabases(async ({ app, maintainer }) => {
      const { spaceId, projectId, authorId } = await seedSpaceWithData(app);
      await seedHistory(app, { spaceId, projectId, authorId, entries: MORE_THAN_ONE_BATCH });
      await seedSpaceProject(app, { spaceId, authorId, entries: MORE_THAN_ONE_BATCH });

      expect(await purgeOf(maintainer)).toEqual({ purgedSpaces: 1, waitingSpaces: 0 });

      expect(await remainsOfSpace(app, spaceId)).toEqual(NOTHING_LEFT);
    }));

  it("saute un espace qu'un autre passage purge déjà, le laisse intact, et purge les autres", () =>
    withDatabases(async ({ app, maintainer }) => {
      const locked = await seedSpaceWithData(app);
      const free = await seedSpaceWithData(app);
      const before = await remainsOfSpace(app, locked.spaceId);

      await maintainer.orm.transaction(async (tx) => {
        expect(await orphanPurgeLockOn(tx).tryTake(locked.spaceId)).toBe(true);

        expect(await purgeOf(maintainer)).toEqual({ purgedSpaces: 1, waitingSpaces: 0 });
      });

      expect(await remainsOfSpace(app, locked.spaceId)).toEqual(before);
      expect(await remainsOfSpace(app, free.spaceId)).toEqual(NOTHING_LEFT);
    }));
});
