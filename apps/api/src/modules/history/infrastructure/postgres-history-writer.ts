import { and, eq, or } from "drizzle-orm";
import { z } from "zod";

import type { PostgresTransaction } from "#db";
import type { StorageMeter } from "#modules/project/contracts/storage-meter.ts";
import { schema } from "@repo/db";

import type { HistoryEntryDraft, HistoryWriter } from "../domain/history-writer.ts";

const { historyAuthor, historyEntry } = schema;

const StoredAuthor = z.object({ id: z.string() });

type Author = Pick<HistoryEntryDraft, "spaceId" | "userId">;

const authorsOf = (entries: readonly HistoryEntryDraft[]): readonly Author[] => [
  ...new Map(
    entries.map(({ spaceId, userId }) => [`${spaceId}:${userId}`, { spaceId, userId }]),
  ).values(),
];

export const postgresHistoryWriter = (
  tx: PostgresTransaction,
  { newId, meter }: { readonly newId: () => string; readonly meter: StorageMeter },
): HistoryWriter => ({
  append: async (entries) => {
    const authors = authorsOf(entries);
    if (authors.length === 0) {
      return;
    }
    await tx
      .insert(historyAuthor)
      .values(authors.map((author) => ({ id: newId(), ...author })))
      .onConflictDoNothing({ target: [historyAuthor.spaceId, historyAuthor.userId] });
    const stored = await tx
      .select({
        id: historyAuthor.id,
        spaceId: historyAuthor.spaceId,
        userId: historyAuthor.userId,
      })
      .from(historyAuthor)
      .where(
        or(
          ...authors.map(({ spaceId, userId }) =>
            and(eq(historyAuthor.spaceId, spaceId), eq(historyAuthor.userId, userId)),
          ),
        ),
      );
    const authorIdOf = ({ spaceId, userId }: Author) =>
      StoredAuthor.parse(
        stored.find((author) => author.spaceId === spaceId && author.userId === userId),
      ).id;
    const written = await tx
      .insert(historyEntry)
      .values(
        entries.map(({ userId, ...entry }) => ({
          ...entry,
          id: newId(),
          authorId: authorIdOf({ spaceId: entry.spaceId, userId }),
        })),
      )
      .returning();
    await [...new Set(written.map(({ projectId }) => projectId))].reduce<Promise<void>>(
      (previous, projectId) =>
        previous.then(() =>
          meter.add(
            projectId,
            written.filter((row) => row.projectId === projectId),
          ),
        ),
      Promise.resolve(),
    );
  },
});
