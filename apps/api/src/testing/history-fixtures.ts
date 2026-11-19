import type { PostgresDatabase } from "#db";
import { storedSize } from "#modules/project/contracts/storage-meter.ts";
import { schema } from "@repo/db";

type StoredEntry = typeof schema.historyEntry.$inferSelect;

export type EntryPayload = Pick<StoredEntry, "clientId" | "before" | "after" | "correlationId">;

export const PAYLOADS_OF_EVERY_SHAPE: readonly EntryPayload[] = [
  {
    clientId: "client-é",
    before: {
      "é🎨": 'ligne\nsuivante\t"guillemets" \\ \u0001 \u001f \u007f  ',
      nested: { values: [1, -2.5, 0, 0.000001, 123456789012345680000], empty: {} },
      "10": 1,
      "2": [[], {}, [null, true, false]],
    },
    after: ["x", { small: 1.5e-7, tiny: -3.25e-9, huge: 1e21, huger: -1.5e300 }],
    correlationId: 'corrélation "citée"',
  },
  { clientId: null, before: null, after: "texte seul", correlationId: "c" },
  { clientId: null, before: 0, after: [], correlationId: "c" },
];

export const makeStoredEntry = <Row extends Omit<StoredEntry, "storedSize">>(
  row: Row,
): Row & { readonly storedSize: number } => ({ ...row, storedSize: storedSize(row) });

export const jsonSizeOfEntry = (row: StoredEntry): number =>
  storedSize(Object.fromEntries(Object.entries(row).filter(([key]) => key !== "storedSize")));

const authorIdOf = async (db: PostgresDatabase) => {
  const [author] = await db.orm.select({ id: schema.historyAuthor.id }).from(schema.historyAuthor);
  return author?.id ?? "";
};

export const seedHistoryEntries = async (
  db: PostgresDatabase,
  {
    spaceId,
    projectId,
    entries,
  }: {
    readonly spaceId: string;
    readonly projectId: string;
    readonly entries: readonly { readonly id: string; readonly occurredAt: Date }[];
  },
) => {
  const authorId = await authorIdOf(db);
  await db.orm.insert(schema.historyEntry).values(
    entries.map(({ id, occurredAt }) =>
      makeStoredEntry({
        id,
        spaceId,
        projectId,
        action: "project.created",
        authorId,
        clientId: null,
        before: null,
        after: null,
        correlationId: "semis",
        occurredAt,
      }),
    ),
  );
};
