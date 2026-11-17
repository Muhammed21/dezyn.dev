import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import { GRACE, obtainAccessToken, withIdentityApp } from "#testing/authorization-flow.ts";
import { seedProject, seedProjectAsEditor } from "#testing/project-fixtures.ts";
import { bytesOfProjectRows, storageMeterOn, storedBytesOf } from "#testing/project-storage.ts";
import { schema } from "@repo/db";

import type { HistoryEntryDraft } from "../domain/history-writer.ts";
import { postgresHistoryWriter } from "../infrastructure/postgres-history-writer.ts";

const UNIQUE_VIOLATION = "23505";

const authorIdOf = async (db: PostgresDatabase, userId: string) => {
  const [author] = await db.orm
    .select({ id: schema.historyAuthor.id })
    .from(schema.historyAuthor)
    .where(eq(schema.historyAuthor.userId, userId));
  return String(author?.id);
};

const makeIdSequence = (first: string) => {
  let given = false;
  return () => {
    if (given) {
      return randomUUID();
    }
    given = true;
    return first;
  };
};

const makeEntryDraft = (
  overrides: Pick<HistoryEntryDraft, "spaceId" | "projectId" | "userId">,
): HistoryEntryDraft => ({
  action: "mcp.read_history",
  clientId: null,
  before: null,
  after: null,
  correlationId: randomUUID(),
  occurredAt: new Date("2026-10-23T09:00:00Z"),
  ...overrides,
});

const authorsByCorrelation = async (db: PostgresDatabase) => {
  const rows = await db.orm
    .select({
      correlationId: schema.historyEntry.correlationId,
      spaceId: schema.historyAuthor.spaceId,
      userId: schema.historyAuthor.userId,
    })
    .from(schema.historyEntry)
    .innerJoin(schema.historyAuthor, eq(schema.historyAuthor.id, schema.historyEntry.authorId));
  return new Map(rows.map(({ correlationId, ...author }) => [correlationId, author]));
};

const appendEntry = (
  db: PostgresDatabase,
  { entry, newId }: { readonly entry: HistoryEntryDraft; readonly newId: () => string },
) =>
  db.orm.transaction((tx) =>
    postgresHistoryWriter(tx, { newId, meter: storageMeterOn(tx) }).append([entry]),
  );

describe("l'écriture d'une entrée d'historique en base", () => {
  it("un identifiant d'auteur déjà pris n'est pas confondu avec un auteur déjà connu", () =>
    withIdentityApp(async (app, db) => {
      const { spaceId, projectId, userId } = await seedProject(app, db);
      const grace = await obtainAccessToken(app, { user: GRACE });
      const takenId = await authorIdOf(db, userId);

      await expect(
        appendEntry(db, {
          entry: makeEntryDraft({ spaceId, projectId, userId: grace.userId }),
          newId: makeIdSequence(takenId),
        }),
      ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
    }));

  it("un appel qui mêle plusieurs auteurs et plusieurs projets range chaque entrée chez son auteur et son projet", () =>
    withIdentityApp(async (app, db) => {
      const owner = await seedProject(app, db);
      const editor = await seedProjectAsEditor(app, db, { user: GRACE });
      const entries = [
        makeEntryDraft({
          spaceId: owner.spaceId,
          projectId: owner.projectId,
          userId: owner.userId,
        }),
        makeEntryDraft({
          spaceId: owner.spaceId,
          projectId: owner.projectId,
          userId: editor.userId,
        }),
        makeEntryDraft({
          spaceId: editor.spaceId,
          projectId: editor.projectId,
          userId: editor.userId,
        }),
        makeEntryDraft({
          spaceId: editor.spaceId,
          projectId: editor.projectId,
          userId: owner.userId,
        }),
      ];

      await db.orm.transaction((tx) =>
        postgresHistoryWriter(tx, { newId: randomUUID, meter: storageMeterOn(tx) }).append(entries),
      );

      const authors = await authorsByCorrelation(db);
      expect(entries.map(({ correlationId }) => authors.get(correlationId))).toEqual(
        entries.map(({ spaceId, userId }) => ({ spaceId, userId })),
      );
      expect(await storedBytesOf(db, owner.projectId)).toBe(
        await bytesOfProjectRows(db, owner.projectId),
      );
      expect(await storedBytesOf(db, editor.projectId)).toBe(
        await bytesOfProjectRows(db, editor.projectId),
      );
    }));
});
