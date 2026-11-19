import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import {
  type EntryPayload,
  jsonSizeOfEntry,
  PAYLOADS_OF_EVERY_SHAPE,
} from "#testing/history-fixtures.ts";
import { migrate, schema } from "@repo/db";
import { migrateUntil, withThrowawayDatabase } from "@repo/db/testing";

const { historyAuthor, historyEntry, identityUser, project, space } = schema;

const BEFORE_STORED_SIZE = "0019_idempotency_key_purge";

const seedProjectWithAuthor = async (app: PostgresDatabase) => {
  const userId = randomUUID();
  const spaceId = randomUUID();
  const projectId = randomUUID();
  const authorId = randomUUID();
  await app.orm
    .insert(identityUser)
    .values({ id: userId, name: "Ada Lovelace", email: `${userId}@dezyn.test` });
  await app.orm
    .insert(space)
    .values({ id: spaceId, name: "Studio Ada", plan: "free", createdAt: new Date() });
  await app.orm
    .insert(project)
    .values({ id: projectId, spaceId, name: "Site vitrine", createdAt: new Date() });
  await app.orm.insert(historyAuthor).values({ id: authorId, spaceId, userId });
  return { spaceId, projectId, authorId };
};

const jsonOrNull = (value: unknown) => (value === null ? null : JSON.stringify(value));

const seedEntryWithoutStoredSize = (
  app: PostgresDatabase,
  {
    seeded,
    payload,
  }: {
    readonly seeded: {
      readonly spaceId: string;
      readonly projectId: string;
      readonly authorId: string;
    };
    readonly payload: EntryPayload;
  },
) =>
  app.orm.execute(sql`
    INSERT INTO history_entry
      (id, space_id, project_id, action, author_id, client_id, before, after, correlation_id, occurred_at)
    VALUES (${randomUUID()}, ${seeded.spaceId}, ${seeded.projectId}, 'token.updated', ${seeded.authorId},
      ${payload.clientId}, ${jsonOrNull(payload.before)}, ${jsonOrNull(payload.after)},
      ${payload.correlationId}, ${new Date("2026-01-01T00:00:00.000Z").toISOString()})`);

const seedEntriesOfEveryShape = async (
  app: PostgresDatabase,
  seeded: { readonly spaceId: string; readonly projectId: string; readonly authorId: string },
) => {
  await PAYLOADS_OF_EVERY_SHAPE.reduce<Promise<unknown>>(async (previous, payload) => {
    await previous;
    return seedEntryWithoutStoredSize(app, { seeded, payload });
  }, Promise.resolve());
};

const entriesOf = (app: PostgresDatabase, projectId: string) =>
  app.orm.select().from(historyEntry).where(eq(historyEntry.projectId, projectId));

const withApp = async (appUrl: string, run: (app: PostgresDatabase) => Promise<void>) => {
  const app = createPostgresDatabase({ url: appUrl });
  try {
    await run(app);
  } finally {
    await app.close();
  }
};

describe("chaque entrée de l'historique porte la taille de son JSON (ADR 0049)", () => {
  it("une entrée écrite avant la migration reçoit la taille de son JSON", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
      await migrateUntil({ connectionString: migratorUrl, tag: BEFORE_STORED_SIZE });
      await withApp(appUrl, async (app) => {
        const seeded = await seedProjectWithAuthor(app);
        await seedEntriesOfEveryShape(app, seeded);

        await migrate({ connectionString: migratorUrl });

        const entries = await entriesOf(app, seeded.projectId);
        expect(entries).toHaveLength(PAYLOADS_OF_EVERY_SHAPE.length);
        expect(entries.map(({ storedSize }) => storedSize)).toEqual(entries.map(jsonSizeOfEntry));
      });
    }));

  it("une entrée écrite sans taille, comme par la version précédente de l'API, reçoit la taille de son JSON", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
      await migrate({ connectionString: migratorUrl });
      await withApp(appUrl, async (app) => {
        const seeded = await seedProjectWithAuthor(app);

        await seedEntriesOfEveryShape(app, seeded);

        const entries = await entriesOf(app, seeded.projectId);
        expect(entries).toHaveLength(PAYLOADS_OF_EVERY_SHAPE.length);
        expect(entries.map(({ storedSize }) => storedSize)).toEqual(entries.map(jsonSizeOfEntry));
      });
    }));
});
