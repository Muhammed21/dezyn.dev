import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import { seedSpaceAtItsLimit } from "#testing/history-fixtures.ts";
import { NOTHING_LEFT, remainsOfSpace, seedSpaceWithData } from "#testing/orphan-space-fixtures.ts";
import { migrate, schema } from "@repo/db";
import { withThrowawayDatabase } from "@repo/db/testing";

import { runManualPurge } from "../manual-purge.ts";

const SMTP_PORT = Number(process.env.MAILPIT_SMTP_PORT ?? 1025);
const MAILPIT_API = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? 8025}/api/v1`;

const Search = z.object({
  messages: z.array(z.object({ From: z.object({ Address: z.string() }), Subject: z.string() })),
});

const receivedBy = async (to: string) =>
  Search.parse(
    await (await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:${to}`)}`)).json(),
  ).messages.map(({ From, Subject }) => ({ from: From.Address, subject: Subject }));

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60_000);

const IN_TWO_DAYS = new Date(Date.now() + 2 * 24 * 60 * 60_000);

const seedExpiredIdempotencyKey = async (app: PostgresDatabase) => {
  const userId = randomUUID();
  await app.orm
    .insert(schema.identityUser)
    .values({ id: userId, name: "Ada", email: `${userId}@dezyn.test` });
  await app.orm.insert(schema.idempotencyKey).values({
    id: randomUUID(),
    userId,
    scope: "mcp:write_tokens",
    key: randomUUID(),
    fingerprint: "empreinte",
    state: "completed",
    response: "{}",
    createdAt: TWO_DAYS_AGO,
  });
};

const makeSensedDatabases = () => {
  const closed: string[] = [];
  const openDatabase = (options: Parameters<typeof createPostgresDatabase>[0]) => {
    const db = createPostgresDatabase(options);
    return {
      ...db,
      close: async () => {
        closed.push(options.url);
        await db.close();
      },
    };
  };
  return { closed, openDatabase };
};

describe("une purge manuelle réussie", () => {
  it("purge les espaces orphelins et compte ceux qui attendent la fin de leur période (ADR 0051)", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const app = createPostgresDatabase({ url: appUrl });
      try {
        const orphan = await seedSpaceWithData(app);
        await seedSpaceWithData(app, {
          subscription: { status: "canceling", currentPeriodEnd: IN_TWO_DAYS },
        });
        const printed: string[] = [];

        await runManualPurge({
          env: {
            DATABASE_URL_HISTORY_MAINTAINER: maintainerUrl,
            SMTP_HOST: "127.0.0.1",
            SMTP_PORT: "1025",
            MAIL_FROM: "dezyn <no-reply@dezyn.test>",
          },
          log: () => undefined,
          openDatabase: createPostgresDatabase,
          print: (output) => printed.push(output),
        });

        expect(printed).toEqual([
          JSON.stringify(
            { purged: [], purgedKeys: 0, orphans: { purgedSpaces: 1, waitingSpaces: 1 } },
            null,
            2,
          ),
        ]);
        expect(await remainsOfSpace(app, orphan.spaceId)).toEqual(NOTHING_LEFT);
      } finally {
        await app.close();
      }
    }));

  it("affiche les espaces purgés et les clés d'idempotence purgées, puis ferme la base", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const app = createPostgresDatabase({ url: appUrl });
      try {
        await seedExpiredIdempotencyKey(app);
        const { closed, openDatabase } = makeSensedDatabases();
        const printed: string[] = [];

        await runManualPurge({
          env: {
            DATABASE_URL_HISTORY_MAINTAINER: maintainerUrl,
            SMTP_HOST: "127.0.0.1",
            SMTP_PORT: "1025",
            MAIL_FROM: "dezyn <no-reply@dezyn.test>",
          },
          log: () => undefined,
          openDatabase,
          print: (output) => printed.push(output),
        });

        expect(printed).toEqual([
          JSON.stringify(
            { purged: [], purgedKeys: 1, orphans: { purgedSpaces: 0, waitingSpaces: 0 } },
            null,
            2,
          ),
        ]);
        expect(closed).toEqual([maintainerUrl]);
      } finally {
        await app.close();
      }
    }));

  it("prévient le propriétaire d'un espace purgé par le serveur SMTP configuré", () =>
    withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
      await migrate({ connectionString: migratorUrl });
      const app = createPostgresDatabase({ url: appUrl });
      try {
        const { spaceId, projectId, ownerEmail } = await seedSpaceAtItsLimit(app);
        const printed: string[] = [];

        await runManualPurge({
          env: {
            DATABASE_URL_HISTORY_MAINTAINER: maintainerUrl,
            SMTP_HOST: "127.0.0.1",
            SMTP_PORT: String(SMTP_PORT),
            MAIL_FROM: "dezyn <no-reply@dezyn.test>",
          },
          log: () => undefined,
          openDatabase: createPostgresDatabase,
          print: (output) => printed.push(output),
        });

        expect(printed).toEqual([
          JSON.stringify(
            {
              purged: [
                {
                  spaceId,
                  name: "Studio Ada",
                  projects: [
                    {
                      projectId,
                      name: "Site vitrine",
                      deletedEntries: 1,
                      purgedBefore: "2026-01-01T00:00:00.000Z",
                    },
                  ],
                },
              ],
              purgedKeys: 0,
              orphans: { purgedSpaces: 0, waitingSpaces: 0 },
            },
            null,
            2,
          ),
        ]);
        expect(await receivedBy(ownerEmail)).toEqual([
          {
            from: "no-reply@dezyn.test",
            subject: "L'historique de l'espace « Studio Ada » a été purgé sur dezyn",
          },
        ]);
      } finally {
        await app.close();
      }
    }));
});
