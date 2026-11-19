import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import type { LogRecord } from "#platform/logging.ts";
import { assertSchemaVersion, LATEST_MIGRATION } from "@repo/db";
import { migrate, schema } from "@repo/db";
import { withThrowawayDatabase } from "@repo/db/testing";

import { createPurgeWorker } from "../purge-worker.ts";

const { historyAuthor, historyEntry, idempotencyKey, identityUser, project, space, spaceMember } =
  schema;

const HYPERDRIVE_LOCAL = "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE";

const FREE_LIMIT = 500_000_000;

const seedSpaceAtItsLimit = async (app: PostgresDatabase) => {
  const spaceId = randomUUID();
  const ownerId = randomUUID();
  const authorId = randomUUID();
  const projectId = randomUUID();
  const ownerEmail = `${ownerId}@dezyn.test`;
  await app.orm.insert(identityUser).values({ id: ownerId, name: "Ada", email: ownerEmail });
  await app.orm
    .insert(space)
    .values({ id: spaceId, name: "Studio Ada", plan: "free", createdAt: new Date() });
  await app.orm
    .insert(spaceMember)
    .values({ id: randomUUID(), spaceId, userId: ownerId, role: "owner", joinedAt: new Date() });
  await app.orm
    .insert(project)
    .values({ id: projectId, spaceId, name: "Site vitrine", createdAt: new Date() });
  await app.orm.update(project).set({ storedBytes: FREE_LIMIT }).where(eq(project.id, projectId));
  await app.orm.insert(historyAuthor).values({ id: authorId, spaceId, userId: ownerId });
  await app.orm.insert(historyEntry).values({
    id: randomUUID(),
    spaceId,
    projectId,
    action: "project.created",
    authorId,
    clientId: null,
    before: null,
    after: { name: "Site vitrine" },
    correlationId: "semis",
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  return { projectId, ownerEmail };
};

const KEY_LIFETIME_MINUTES = 24 * 60;

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

const seedIdempotencyKey = async (
  app: PostgresDatabase,
  {
    userId,
    response,
    createdAt,
  }: { readonly userId: string; readonly response: string | null; readonly createdAt: Date },
) => {
  const id = randomUUID();
  await app.orm.insert(idempotencyKey).values({
    id,
    userId,
    scope: "mcp:write_tokens",
    key: randomUUID(),
    fingerprint: "empreinte",
    state: response === null ? "in_progress" : "completed",
    response,
    createdAt,
  });
  return id;
};

const seedUser = async (app: PostgresDatabase) => {
  const userId = randomUUID();
  await app.orm
    .insert(identityUser)
    .values({ id: userId, name: "Ada", email: `${userId}@dezyn.test` });
  return userId;
};

const revokeAsMigrator = async (migratorUrl: string, statement: ReturnType<typeof sql>) => {
  const migrator = createPostgresDatabase({ url: migratorUrl });
  try {
    await migrator.orm.execute(statement);
  } finally {
    await migrator.close();
  }
};

const runPurgePass = async (maintainerUrl: string) => {
  const logged: LogRecord[] = [];
  const pending: Promise<unknown>[] = [];
  const worker = createPurgeWorker({
    log: (record) => logged.push(record),
    assertSchema: async () => undefined,
    fetch: () => Promise.reject(new Error("aucun appel sortant attendu")),
  });
  const thrown = await worker
    .scheduled(
      { cron: "*/15 * * * *", scheduledTime: Date.now() },
      {
        HYPERDRIVE: { connectionString: maintainerUrl },
        MAIL_FROM: "no-reply@dezyn.dev",
        EMAIL_DELIVERY: "log",
      },
      { waitUntil: (promise) => pending.push(promise) },
    )
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  await Promise.all(pending);
  return { logged, thrown };
};

const jsonLines = (messages: readonly string[]): readonly unknown[] =>
  messages.flatMap((message) => {
    try {
      return [JSON.parse(message)];
    } catch {
      return [];
    }
  });

const withPurgeWorker = async (
  databaseUrl: string,
  run: (
    scheduled: () => Promise<{ readonly outcome: string }>,
    logs: () => readonly unknown[],
  ) => Promise<void>,
) => {
  process.env[HYPERDRIVE_LOCAL] = databaseUrl;
  const server = createTestHarness({
    root: new URL("../..", import.meta.url).pathname,
    workers: [{ configPath: "./wrangler.purge.jsonc", vars: { EMAIL_DELIVERY: "log" } }],
  });
  try {
    await server.listen();
    const worker = server.getWorker("dezyn-purge");
    await run(
      () => worker.scheduled({ cron: "*/15 * * * *", scheduledTime: new Date() }),
      () => jsonLines(server.getLogs().map(({ message }) => message)),
    );
  } finally {
    await server.close();
    delete process.env[HYPERDRIVE_LOCAL];
  }
};

describe("le Worker dezyn-purge en production (ADR 0042 §2)", () => {
  it(
    "un passage planifié purge un espace à sa limite et prévient son propriétaire",
    () =>
      withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
        await migrate({ connectionString: migratorUrl });
        const app = createPostgresDatabase({ url: appUrl });
        try {
          const { projectId, ownerEmail } = await seedSpaceAtItsLimit(app);

          await withPurgeWorker(maintainerUrl, async (scheduled, logs) => {
            expect(await scheduled()).toMatchObject({ outcome: "ok" });

            expect(
              await app.orm
                .select()
                .from(historyEntry)
                .where(eq(historyEntry.projectId, projectId)),
            ).toEqual([]);
            expect(logs()).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  msg: "email logged instead of sent",
                  to: ownerEmail,
                  subject: "L'historique de l'espace « Studio Ada » a été purgé sur dezyn",
                }),
                expect.objectContaining({ msg: "history_purge_pass", purgedSpaces: 1 }),
              ]),
            );
          });
        } finally {
          await app.close();
        }
      }),
    60_000,
  );
});

describe("un passage du Worker dezyn-purge", () => {
  it("purge, envoie l'email par Resend, journalise le passage et ferme la base", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const app = createPostgresDatabase({ url: appUrl });
      try {
        const { projectId, ownerEmail } = await seedSpaceAtItsLimit(app);
        const logged: LogRecord[] = [];
        const sent: { readonly url: string; readonly body: unknown }[] = [];
        const pending: Promise<unknown>[] = [];
        const worker = createPurgeWorker({
          log: (record) => logged.push(record),
          assertSchema: (databaseUrl) =>
            assertSchemaVersion({ connectionString: databaseUrl, migration: LATEST_MIGRATION }),
          fetch: async (url, init) => {
            sent.push({
              url: String(url),
              body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
            });
            return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
          },
        });

        await worker.scheduled(
          { cron: "*/15 * * * *", scheduledTime: Date.now() },
          {
            HYPERDRIVE: { connectionString: maintainerUrl },
            RESEND_API_KEY: "re_cle",
            MAIL_FROM: "no-reply@dezyn.dev",
          },
          { waitUntil: (promise) => pending.push(promise) },
        );
        await Promise.all(pending);

        expect(
          await app.orm.select().from(historyEntry).where(eq(historyEntry.projectId, projectId)),
        ).toEqual([]);
        expect(sent).toEqual([
          {
            url: "https://api.resend.com/emails",
            body: expect.objectContaining({
              from: "dezyn <no-reply@dezyn.dev>",
              to: ownerEmail,
              subject: "L'historique de l'espace « Studio Ada » a été purgé sur dezyn",
            }),
          },
        ]);
        expect(logged).toContainEqual({
          level: "info",
          msg: "history_purge_pass",
          purgedSpaces: 1,
        });
        expect(pending).toHaveLength(1);
      } finally {
        await app.close();
      }
    }));
});

describe("le Worker dezyn-purge oublie les clés d'idempotence de plus de 24 heures", () => {
  it("supprime les clés de plus de 24 heures, terminées ou en cours, et garde les clés récentes", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const app = createPostgresDatabase({ url: appUrl });
      try {
        const userId = await seedUser(app);
        await seedIdempotencyKey(app, {
          userId,
          response: "{}",
          createdAt: minutesAgo(KEY_LIFETIME_MINUTES + 1),
        });
        await seedIdempotencyKey(app, {
          userId,
          response: null,
          createdAt: minutesAgo(KEY_LIFETIME_MINUTES + 1),
        });
        const recent = await seedIdempotencyKey(app, {
          userId,
          response: "{}",
          createdAt: minutesAgo(KEY_LIFETIME_MINUTES - 1),
        });

        const { logged, thrown } = await runPurgePass(maintainerUrl);

        expect(thrown).toBeUndefined();
        expect(await app.orm.select({ id: idempotencyKey.id }).from(idempotencyKey)).toEqual([
          { id: recent },
        ]);
        expect(logged).toContainEqual({
          level: "info",
          msg: "idempotency_purge_pass",
          purgedKeys: 2,
        });
      } finally {
        await app.close();
      }
    }));
});

describe("les deux purges d'un passage du Worker dezyn-purge sont indépendantes", () => {
  it("purge les clés d'idempotence quand la purge de l'historique échoue, journalise l'échec et le relève", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const app = createPostgresDatabase({ url: appUrl });
      try {
        const userId = await seedUser(app);
        await seedIdempotencyKey(app, {
          userId,
          response: "{}",
          createdAt: minutesAgo(KEY_LIFETIME_MINUTES + 1),
        });
        await revokeAsMigrator(migratorUrl, sql`revoke select on "space" from history_maintainer`);

        const { logged, thrown } = await runPurgePass(maintainerUrl);

        expect(thrown).toEqual(
          expect.objectContaining({ message: expect.stringContaining("space") }),
        );
        expect(await app.orm.select().from(idempotencyKey)).toEqual([]);
        expect(logged).toContainEqual(
          expect.objectContaining({
            level: "error",
            msg: "history purge failed",
            error: expect.stringContaining("space"),
          }),
        );
        expect(logged).toContainEqual({
          level: "info",
          msg: "idempotency_purge_pass",
          purgedKeys: 1,
        });
      } finally {
        await app.close();
      }
    }));

  it("purge l'historique quand la purge des clés d'idempotence échoue, journalise l'échec et le relève", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const app = createPostgresDatabase({ url: appUrl });
      try {
        const { projectId } = await seedSpaceAtItsLimit(app);
        await revokeAsMigrator(
          migratorUrl,
          sql`revoke delete on "idempotency_key" from history_maintainer`,
        );

        const { logged, thrown } = await runPurgePass(maintainerUrl);

        expect(thrown).toEqual(
          expect.objectContaining({ message: expect.stringContaining("idempotency_key") }),
        );
        expect(
          await app.orm.select().from(historyEntry).where(eq(historyEntry.projectId, projectId)),
        ).toEqual([]);
        expect(logged).toContainEqual({
          level: "info",
          msg: "history_purge_pass",
          purgedSpaces: 1,
        });
        expect(logged).toContainEqual(
          expect.objectContaining({
            level: "error",
            msg: "idempotency purge failed",
            error: expect.stringContaining("idempotency_key"),
          }),
        );
      } finally {
        await app.close();
      }
    }));

  it("journalise les deux échecs quand les deux purges échouent, et relève le premier", () =>
    withThrowawayDatabase(async ({ migratorUrl, maintainerUrl }) => {
      await migrate({ connectionString: migratorUrl });
      await revokeAsMigrator(migratorUrl, sql`revoke select on "space" from history_maintainer`);
      await revokeAsMigrator(
        migratorUrl,
        sql`revoke delete on "idempotency_key" from history_maintainer`,
      );

      const { logged, thrown } = await runPurgePass(maintainerUrl);

      expect(thrown).toEqual(
        expect.objectContaining({ message: expect.stringContaining("space") }),
      );
      expect(logged).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ level: "error", msg: "history purge failed" }),
          expect.objectContaining({ level: "error", msg: "idempotency purge failed" }),
        ]),
      );
    }));
});
