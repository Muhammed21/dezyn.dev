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

const { historyAuthor, historyEntry, identityUser } = schema;

const BEFORE_STORED_SIZE = "0019_idempotency_key_purge";

const NOT_NULL_VIOLATION = "23502";

const STORED_SIZE_FUNCTIONS = [
  "history_entry_json_length",
  "history_entry_stored_size",
  "history_entry_fill_stored_size",
];

const seedProjectWithAuthor = async (app: PostgresDatabase) => {
  const userId = randomUUID();
  const spaceId = randomUUID();
  const projectId = randomUUID();
  const authorId = randomUUID();
  await app.orm
    .insert(identityUser)
    .values({ id: userId, name: "Ada Lovelace", email: `${userId}@dezyn.test` });
  await app.orm.execute(sql`
    INSERT INTO space (id, name, plan, created_at)
    VALUES (${spaceId}, 'Studio Ada', 'free', ${new Date().toISOString()})`);
  await app.orm.execute(sql`
    INSERT INTO project (id, space_id, name, created_at)
    VALUES (${projectId}, ${spaceId}, 'Site vitrine', ${new Date().toISOString()})`);
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

  it("history_entry n'a plus de trigger, et les fonctions qui calculaient la taille en SQL n'existent plus", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
      await migrate({ connectionString: migratorUrl });
      await withApp(appUrl, async (app) => {
        const triggers = await app.orm.execute(sql`
          SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'history_entry'::regclass AND NOT tgisinternal`);
        const functions = await app.orm.execute(sql`
          SELECT proname FROM pg_proc
          WHERE proname IN ${STORED_SIZE_FUNCTIONS}`);

        expect(triggers.rows).toEqual([]);
        expect(functions.rows).toEqual([]);
      });
    }));

  it("refuse une entrée écrite sans taille", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
      await migrate({ connectionString: migratorUrl });
      await withApp(appUrl, async (app) => {
        const seeded = await seedProjectWithAuthor(app);
        const payload = { clientId: null, before: null, after: "texte seul", correlationId: "c" };

        await expect(seedEntryWithoutStoredSize(app, { seeded, payload })).rejects.toMatchObject({
          cause: { code: NOT_NULL_VIOLATION, column: "stored_size" },
        });
      });
    }));
});
