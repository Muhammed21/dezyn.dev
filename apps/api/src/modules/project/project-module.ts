import { randomUUID } from "node:crypto";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import type { MembershipReader, ProjectAccess } from "#modules/space/contracts/membership.ts";
import type { Clock } from "#platform/clock.ts";

export { bestEffortSignals } from "./application/best-effort-signals.ts";
export { readProject } from "./application/read-project.ts";
export { subscribeToProject } from "./application/subscribe-to-project.ts";
export { durableObjectRooms, type ProjectRooms } from "./infrastructure/durable-object-rooms.ts";

import { createProject } from "./application/create-project.ts";
import { listProjects } from "./application/list-projects.ts";
import { setFigmaFile } from "./application/set-figma-file.ts";
import type { ProjectSignals } from "./domain/project-signals.ts";
import { postgresProjectLock } from "./infrastructure/postgres-project-lock.ts";
import {
  postgresFigmaFileUnitOfWork,
  postgresProjectFinder,
  postgresProjectLister,
  postgresProjectReader,
  postgresProjectUnitOfWork,
} from "./infrastructure/postgres-projects.ts";
import { postgresStorageMeter } from "./infrastructure/postgres-storage-meter.ts";

export const storageMeterOn = postgresStorageMeter;

export const projectLockOn = postgresProjectLock;

const now = () => new Date();

export const projectModule = ({
  db,
  memberships,
  historyWriterOn,
}: {
  readonly db: PostgresDatabase;
  readonly memberships: MembershipReader;
  readonly historyWriterOn: (tx: PostgresTransaction) => HistoryWriter;
}) => ({
  createProject: createProject({
    memberships,
    unitOfWork: postgresProjectUnitOfWork({ db, historyWriterOn }),
    newId: randomUUID,
    now,
  }),
  listProjects: listProjects({ memberships, projects: postgresProjectLister(db) }),
  finder: postgresProjectFinder(db),
  reader: postgresProjectReader(db),
});

export const figmaFileModule = ({
  db,
  access,
  historyWriterOn,
  signals,
  clock,
}: {
  readonly db: PostgresDatabase;
  readonly access: ProjectAccess;
  readonly historyWriterOn: (tx: PostgresTransaction) => HistoryWriter;
  readonly signals: ProjectSignals;
  readonly clock: Clock;
}) =>
  setFigmaFile({
    access,
    unitOfWork: postgresFigmaFileUnitOfWork({ db, historyWriterOn }),
    signals,
    now: clock,
  });
