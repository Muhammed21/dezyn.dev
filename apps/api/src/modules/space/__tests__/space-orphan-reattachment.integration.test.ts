import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import { remainsOfSpace, seedSpaceWithData } from "#testing/orphan-space-fixtures.ts";
import { migrate, schema } from "@repo/db";
import { withThrowawayDatabase } from "@repo/db/testing";

import { orphanSpacePurge } from "../space-module.ts";

const RUNBOOK = new URL("../../../../../../docs/runbooks/hebergement.md", import.meta.url);

const SECTION = "### Rattacher un espace orphelin à un compte";

const DAY_MS = 24 * 60 * 60 * 1000;

const runbookQueries = () => {
  const runbook = readFileSync(RUNBOOK, "utf8");
  const section = runbook.slice(runbook.indexOf(SECTION)).split(/\n### /)[0] ?? "";
  const [verify = "", attach = "", check = ""] = [
    ...section.matchAll(/```sql\n([\s\S]*?)```/g),
  ].map(([, query]) => query ?? "");
  return { verify, attach, check };
};

const StatementResults = z.array(
  z.object({
    command: z.string().nullable(),
    rowCount: z.number().nullable(),
    rows: z.array(z.record(z.string(), z.unknown())),
  }),
);

type Session = { readonly spaceId: string; readonly email: string };

const runAsApp = async (appUrl: string, query: string, { spaceId, email }: Session) => {
  const client = new Client({ connectionString: appUrl });
  await client.connect();
  try {
    const text = query
      .replaceAll(":'space_id'", `'${spaceId}'`)
      .replaceAll(":'email'", `'${email}'`);
    return StatementResults.parse([await client.query(text)].flat());
  } finally {
    await client.end();
  }
};

const seedAccount = async (db: PostgresDatabase) => {
  const id = randomUUID();
  const email = `${id}@dezyn.test`;
  await db.orm.insert(schema.identityUser).values({ id, name: "Margaret Hamilton", email });
  return { id, email };
};

type Databases = {
  readonly app: PostgresDatabase;
  readonly maintainer: PostgresDatabase;
  readonly appUrl: string;
};

const withDatabases = (run: (databases: Databases) => Promise<void>) =>
  withThrowawayDatabase(async ({ migratorUrl, appUrl, maintainerUrl }) => {
    await migrate({ connectionString: migratorUrl });
    const app = createPostgresDatabase({ url: appUrl });
    const maintainer = createPostgresDatabase({ url: maintainerUrl });
    try {
      await run({ app, maintainer, appUrl });
    } finally {
      await Promise.all([app.close(), maintainer.close()]);
    }
  });

const summaryOf = (results: z.infer<typeof StatementResults>) =>
  results.map(({ command, rowCount }) => `${command ?? ""} ${rowCount ?? 0}`);

describe("la procédure de rattachement d'un espace orphelin du runbook, avec le rôle app (ADR 0056)", () => {
  it("rattache un espace orphelin en délai de grâce au compte, qui en devient propriétaire, et la purge ne le touche plus", () =>
    withDatabases(async ({ app, maintainer, appUrl }) => {
      const { spaceId } = await seedSpaceWithData(app, {
        orphanedAt: new Date(Date.now() - DAY_MS),
      });
      const account = await seedAccount(app);
      const session = { spaceId, email: account.email };
      const { verify, attach, check } = runbookQueries();
      const before = await remainsOfSpace(app, spaceId);

      const [orphan, user] = await runAsApp(appUrl, verify, session);
      const attached = await runAsApp(appUrl, attach, session);
      const [owner] = await runAsApp(appUrl, check, session);

      expect(orphan?.rows).toEqual([expect.objectContaining({ id: spaceId, projects: "1" })]);
      expect(user?.rows).toEqual([expect.objectContaining({ id: account.id })]);
      expect(summaryOf(attached)).toEqual([
        "BEGIN 0",
        "SELECT 1",
        "INSERT 1",
        "UPDATE 1",
        "COMMIT 0",
      ]);
      expect(owner?.rows).toEqual([
        expect.objectContaining({ role: "owner", email: account.email, orphaned_at: null }),
      ]);
      expect(
        await orphanSpacePurge({
          db: maintainer,
          log: () => undefined,
          now: () => new Date(Date.now() + 30 * DAY_MS),
        })(),
      ).toEqual({ purgedSpaces: 0, waitingSpaces: 0 });
      expect(await remainsOfSpace(app, spaceId)).toEqual({ ...before, space_member: 2 });
    }));

  it("ne change rien à un espace dont le délai de grâce est passé", () =>
    withDatabases(async ({ app, appUrl }) => {
      const orphanedAt = new Date(Date.now() - 7 * DAY_MS - 60_000);
      const { spaceId } = await seedSpaceWithData(app, { orphanedAt });
      const account = await seedAccount(app);
      const session = { spaceId, email: account.email };
      const { attach, check } = runbookQueries();

      const attached = await runAsApp(appUrl, attach, session);

      expect(summaryOf(attached)).toEqual([
        "BEGIN 0",
        "SELECT 1",
        "INSERT 0",
        "UPDATE 0",
        "COMMIT 0",
      ]);
      expect((await runAsApp(appUrl, check, session))[0]?.rows).toEqual([]);
    }));
});
