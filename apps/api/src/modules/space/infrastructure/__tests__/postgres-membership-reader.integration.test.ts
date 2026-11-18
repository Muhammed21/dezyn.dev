import { randomUUID } from "node:crypto";

import { onTestFinished } from "vitest";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import { migrate, schema } from "@repo/db";
import { createThrowawayDatabase } from "@repo/db/testing";

import { describeMembershipReaderContract } from "../../application/__tests__/membership-reader.contract.ts";
import type { MembershipRecord } from "../../application/membership-reader.fake.ts";
import { postgresMembershipReader } from "../postgres-membership-reader.ts";

const { identityUser, space, spaceMember } = schema;

const openDatabase = async (): Promise<PostgresDatabase> => {
  const database = await createThrowawayDatabase();
  onTestFinished(() => database.drop());
  await migrate({ connectionString: database.migratorUrl });
  const db = createPostgresDatabase({ url: database.appUrl });
  onTestFinished(() => db.close());
  return db;
};

const distinct = (values: readonly string[]) => [...new Set(values)];

const seedUser = (db: PostgresDatabase, id: string) =>
  db.orm.insert(identityUser).values({ id, name: "Ada Lovelace", email: `${id}@dezyn.test` });

const seedSpace = (db: PostgresDatabase, id: string) =>
  db.orm.insert(space).values({ id, name: "Studio Ada", plan: "team", createdAt: new Date() });

const seedMembership = (
  db: PostgresDatabase,
  { spaceId, userId, role, closedAt = null }: MembershipRecord,
) =>
  db.orm
    .insert(spaceMember)
    .values({ id: randomUUID(), spaceId, userId, role, joinedAt: new Date(), closedAt });

describeMembershipReaderContract(async (memberships) => {
  const db = await openDatabase();
  await Promise.all(
    distinct(memberships.map(({ userId }) => userId)).map((id) => seedUser(db, id)),
  );
  await Promise.all(
    distinct(memberships.map(({ spaceId }) => spaceId)).map((id) => seedSpace(db, id)),
  );
  await Promise.all(memberships.map((membership) => seedMembership(db, membership)));
  return postgresMembershipReader(db);
});
