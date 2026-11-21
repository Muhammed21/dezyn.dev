import { randomUUID } from "node:crypto";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import type { MembershipReader } from "#modules/space/contracts/membership.ts";

export { bestEffortSignals } from "./application/best-effort-signals.ts";
export { readProject } from "./application/read-project.ts";
export { subscribeToProject } from "./application/subscribe-to-project.ts";
export { durableObjectRooms, type ProjectRooms } from "./infrastructure/durable-object-rooms.ts";

import { createProject } from "./application/create-project.ts";
import { listProjects } from "./application/list-projects.ts";
import { postgresProjectLock } from "./infrastructure/postgres-project-lock.ts";
import {
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
