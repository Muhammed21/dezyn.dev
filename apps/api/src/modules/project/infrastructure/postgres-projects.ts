import { asc, count, eq, max, sql } from "drizzle-orm";
import { z } from "zod";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import { PLANS } from "#modules/space/contracts/plan.ts";
import { schema } from "@repo/db";

import type { ProjectUnitOfWork } from "../application/create-project.ts";
import type { ProjectLister } from "../application/list-projects.ts";
import type { ProjectReader } from "../application/read-project.ts";
import type { FigmaFileUnitOfWork } from "../application/set-figma-file.ts";
import type { ProjectFinder } from "../domain/project.ts";

const { project, space, token, tokenFigmaState } = schema;

const StoredPlan = z.enum(PLANS);

type StoredFigmaFileColumns = {
  readonly figmaFileUrl: string | null;
  readonly figmaFileKey: string | null;
};

const figmaFileOfRow = ({ figmaFileUrl, figmaFileKey }: StoredFigmaFileColumns) =>
  figmaFileUrl === null || figmaFileKey === null ? null : { url: figmaFileUrl, key: figmaFileKey };

const withFigmaFile = <Row extends StoredFigmaFileColumns>({
  figmaFileUrl,
  figmaFileKey,
  ...row
}: Row) => ({ ...row, figmaFile: figmaFileOfRow({ figmaFileUrl, figmaFileKey }) });

const StoredFigmaFile = z.object({
  figmaFileUrl: z.string().nullable(),
  figmaFileKey: z.string().nullable(),
});

const StoredProject = StoredFigmaFile.extend({
  id: z.string(),
  spaceId: z.string(),
  name: z.string(),
  createdAt: z.date(),
  historyPurgedAt: z.date().nullable(),
  lastFigmaSurveyAt: z.coerce.date().nullable(),
}).transform(withFigmaFile);

const figmaFileColumns = {
  figmaFileUrl: project.figmaFileUrl,
  figmaFileKey: project.figmaFileKey,
};

export const postgresProjectUnitOfWork = ({
  db,
  historyWriterOn,
}: {
  readonly db: PostgresDatabase;
  readonly historyWriterOn: (tx: PostgresTransaction) => HistoryWriter;
}): ProjectUnitOfWork => ({
  run: (work) =>
    db.orm.transaction((tx) =>
      work({
        projects: {
          lockSpace: async (spaceId) => {
            const [locked] = await tx
              .select({ plan: space.plan })
              .from(space)
              .where(eq(space.id, spaceId))
              .for("update");
            const [counted] = await tx
              .select({ projects: count() })
              .from(project)
              .where(eq(project.spaceId, spaceId));
            return { plan: StoredPlan.parse(locked?.plan), projects: counted?.projects ?? 0 };
          },
          create: async (created) => {
            await tx.insert(project).values(created);
          },
        },
        history: historyWriterOn(tx),
      }),
    ),
});

export const postgresProjectFinder = (db: PostgresDatabase): ProjectFinder => ({
  find: async (projectId) => {
    const [row] = await db.orm
      .select({ id: project.id, spaceId: project.spaceId })
      .from(project)
      .where(eq(project.id, projectId));
    return row;
  },
});

export const postgresProjectLister = (db: PostgresDatabase): ProjectLister => ({
  projectsOf: async (spaceId) => {
    const rows = await db.orm
      .select({
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        historyPurgedAt: project.historyPurgedAt,
        ...figmaFileColumns,
      })
      .from(project)
      .where(eq(project.spaceId, spaceId))
      .orderBy(asc(project.name));
    return rows.map(withFigmaFile);
  },
});

export const postgresProjectReader = (db: PostgresDatabase): ProjectReader => ({
  projectOf: async (projectId) => {
    const lastFigmaSurvey = db.orm
      .select({ at: max(tokenFigmaState.declaredAt) })
      .from(tokenFigmaState)
      .innerJoin(token, eq(token.id, tokenFigmaState.tokenId))
      .where(eq(token.projectId, projectId));
    const [row] = await db.orm
      .select({
        id: project.id,
        spaceId: project.spaceId,
        name: project.name,
        createdAt: project.createdAt,
        historyPurgedAt: project.historyPurgedAt,
        lastFigmaSurveyAt: sql<unknown>`(${lastFigmaSurvey})`,
        ...figmaFileColumns,
      })
      .from(project)
      .where(eq(project.id, projectId));
    return StoredProject.parse(row);
  },
});

export const postgresFigmaFileUnitOfWork = ({
  db,
  historyWriterOn,
}: {
  readonly db: PostgresDatabase;
  readonly historyWriterOn: (tx: PostgresTransaction) => HistoryWriter;
}): FigmaFileUnitOfWork => ({
  run: (work) =>
    db.orm.transaction((tx) =>
      work({
        figmaFiles: {
          lockedFigmaFileOf: async (projectId) => {
            const [row] = await tx
              .select(figmaFileColumns)
              .from(project)
              .where(eq(project.id, projectId))
              .for("no key update");
            return figmaFileOfRow(StoredFigmaFile.parse(row));
          },
          replace: async ({ projectId, figmaFile }) => {
            await tx
              .update(project)
              .set({ figmaFileUrl: figmaFile?.url ?? null, figmaFileKey: figmaFile?.key ?? null })
              .where(eq(project.id, projectId));
          },
        },
        history: historyWriterOn(tx),
      }),
    ),
});
