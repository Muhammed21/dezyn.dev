import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { PostgresDatabase } from "#db";
import { schema } from "@repo/db";

import { makeStoredEntry } from "./history-fixtures.ts";

const SEEDED_AT = new Date("2026-10-01T08:00:00.000Z");

const seedUser = async (db: PostgresDatabase) => {
  const userId = randomUUID();
  await db.orm
    .insert(schema.identityUser)
    .values({ id: userId, name: "Grace Hopper", email: `${userId}@dezyn.test` });
  return userId;
};

const seedTokens = async (db: PostgresDatabase, projectId: string) => {
  const modifierId = randomUUID();
  const modeId = randomUUID();
  const baseId = randomUUID();
  const aliasId = randomUUID();
  const shadowId = randomUUID();
  const shadowValueId = randomUUID();
  await db.orm.insert(schema.modifier).values({ id: modifierId, projectId, name: "apparence" });
  await db.orm.insert(schema.mode).values({ id: modeId, modifierId, name: "clair", position: 0 });
  await db.orm.insert(schema.token).values(
    [
      { id: baseId, name: "couleur.fond", type: "color" },
      { id: aliasId, name: "couleur.surface", type: "color" },
      { id: shadowId, name: "ombre.carte", type: "shadow" },
    ].map((token) => ({ ...token, projectId, status: "validated", createdAt: SEEDED_AT })),
  );
  await db.orm.insert(schema.tokenValue).values([
    { id: randomUUID(), tokenId: baseId, modeId, value: { hex: "#ffffff" } },
    { id: randomUUID(), tokenId: aliasId, modeId, referencedTokenId: baseId },
    { id: shadowValueId, tokenId: shadowId, modeId, value: { offsetX: "0px" } },
  ]);
  await db.orm.insert(schema.tokenValueReference).values({
    id: randomUUID(),
    tokenValueId: shadowValueId,
    field: "color",
    referencedTokenId: baseId,
  });
  return { baseId };
};

const seedProposals = async (
  db: PostgresDatabase,
  { projectId, tokenId }: { readonly projectId: string; readonly tokenId: string },
) => {
  const batchId = randomUUID();
  const proposalId = randomUUID();
  await db.orm.insert(schema.proposalBatch).values({
    id: batchId,
    projectId,
    userId: null,
    clientId: "client-ia",
    intent: "Import du Figma",
    state: "open",
    openedAt: SEEDED_AT,
    lastWrittenAt: SEEDED_AT,
  });
  await db.orm.insert(schema.proposal).values({
    id: proposalId,
    projectId,
    batchId,
    tokenName: "couleur.bord",
    kind: "create",
    payload: { name: "couleur.bord" },
    status: "proposed",
    createdAt: SEEDED_AT,
  });
  await db.orm.insert(schema.tokenFigmaState).values({
    tokenId,
    state: "synced",
    declaredAt: SEEDED_AT,
    userId: null,
    clientId: "client-ia",
    proposalId,
  });
};

export const seedHistory = async (
  db: PostgresDatabase,
  {
    spaceId,
    projectId,
    authorId,
    entries,
  }: {
    readonly spaceId: string;
    readonly projectId: string;
    readonly authorId: string;
    readonly entries: number;
  },
) => {
  await db.orm.insert(schema.historyEntry).values(
    Array.from({ length: entries }, (_, index) =>
      makeStoredEntry({
        id: randomUUID(),
        spaceId,
        projectId,
        action: "token.created",
        authorId,
        clientId: null,
        before: null,
        after: { name: `couleur.${index}` },
        correlationId: "semis",
        occurredAt: new Date(SEEDED_AT.getTime() + index),
      }),
    ),
  );
};

export const seedSpaceProject = async (
  db: PostgresDatabase,
  {
    spaceId,
    authorId,
    entries = 2,
  }: { readonly spaceId: string; readonly authorId: string; readonly entries?: number },
) => {
  const projectId = randomUUID();
  await db.orm
    .insert(schema.project)
    .values({ id: projectId, spaceId, name: "Site vitrine", createdAt: SEEDED_AT });
  const { baseId } = await seedTokens(db, projectId);
  await seedProposals(db, { projectId, tokenId: baseId });
  await seedHistory(db, { spaceId, projectId, authorId, entries });
  return projectId;
};

export type SeededSubscription = {
  readonly status: "active" | "canceling" | "past_due" | "ended";
  readonly currentPeriodEnd: Date | null;
  readonly cancelRequestedAt?: Date | null;
};

export const seedSpaceWithData = async (
  db: PostgresDatabase,
  {
    openMember = false,
    orphanedAt = SEEDED_AT,
    subscription,
    entries,
  }: {
    readonly openMember?: boolean;
    readonly orphanedAt?: Date;
    readonly subscription?: SeededSubscription;
    readonly entries?: number;
  } = {},
) => {
  const spaceId = randomUUID();
  const userId = await seedUser(db);
  const authorId = randomUUID();
  await db.orm.insert(schema.space).values({
    id: spaceId,
    name: "Studio Grace",
    plan: "free",
    createdAt: SEEDED_AT,
    orphanedAt: openMember ? null : orphanedAt,
  });
  await db.orm.insert(schema.spaceMember).values({
    id: randomUUID(),
    spaceId,
    userId,
    role: "owner",
    joinedAt: SEEDED_AT,
    ...(openMember ? {} : { closedAt: SEEDED_AT, closedReason: "left" }),
  });
  await db.orm.insert(schema.spaceInvitation).values({
    id: randomUUID(),
    spaceId,
    email: "linus@dezyn.test",
    tokenHash: randomUUID(),
    invitedBy: null,
    createdAt: SEEDED_AT,
    expiresAt: new Date(SEEDED_AT.getTime() + 7 * 24 * 60 * 60_000),
  });
  await db.orm
    .insert(schema.historyAuthor)
    .values({ id: authorId, spaceId, userId: null, deletedMemberNumber: 1 });
  const projectId = await seedSpaceProject(db, { spaceId, authorId, entries });
  if (subscription !== undefined) {
    await db.orm.insert(schema.spaceSubscription).values({
      spaceId,
      polarSubscriptionId: randomUUID(),
      payerId: null,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      polarModifiedAt: SEEDED_AT,
      cancelRequestedAt: subscription.cancelRequestedAt ?? null,
    });
    await db.orm.insert(schema.spacePlanChange).values({
      id: randomUUID(),
      spaceId,
      polarSubscriptionId: randomUUID(),
      polarEvent: "subscription.active",
      planBefore: "free",
      planAfter: "team",
      changedAt: SEEDED_AT,
    });
  }
  return { spaceId, projectId, authorId };
};

const Remains = z.record(z.string(), z.coerce.number());

export const remainsOfSpace = async (db: PostgresDatabase, spaceId: string) => {
  const { rows } = await db.orm.execute(sql`
    WITH projects AS (SELECT id FROM project WHERE space_id = ${spaceId}),
      tokens AS (SELECT id FROM token WHERE project_id IN (SELECT id FROM projects)),
      modifiers AS (SELECT id FROM modifier WHERE project_id IN (SELECT id FROM projects))
    SELECT
      (SELECT count(*) FROM space WHERE id = ${spaceId}) AS space,
      (SELECT count(*) FROM space_member WHERE space_id = ${spaceId}) AS space_member,
      (SELECT count(*) FROM space_invitation WHERE space_id = ${spaceId}) AS space_invitation,
      (SELECT count(*) FROM space_subscription WHERE space_id = ${spaceId}) AS space_subscription,
      (SELECT count(*) FROM space_plan_change WHERE space_id = ${spaceId}) AS space_plan_change,
      (SELECT count(*) FROM history_author WHERE space_id = ${spaceId}) AS history_author,
      (SELECT count(*) FROM history_entry WHERE space_id = ${spaceId}) AS history_entry,
      (SELECT count(*) FROM projects) AS project,
      (SELECT count(*) FROM tokens) AS token,
      (SELECT count(*) FROM token_value WHERE token_id IN (SELECT id FROM tokens)) AS token_value,
      (SELECT count(*) FROM token_value_reference WHERE referenced_token_id IN (SELECT id FROM tokens)) AS token_value_reference,
      (SELECT count(*) FROM token_figma_state WHERE token_id IN (SELECT id FROM tokens)) AS token_figma_state,
      (SELECT count(*) FROM modifiers) AS modifier,
      (SELECT count(*) FROM mode WHERE modifier_id IN (SELECT id FROM modifiers)) AS mode,
      (SELECT count(*) FROM proposal WHERE project_id IN (SELECT id FROM projects)) AS proposal,
      (SELECT count(*) FROM proposal_batch WHERE project_id IN (SELECT id FROM projects)) AS proposal_batch
  `);
  return Remains.parse(rows[0]);
};

export const NOTHING_LEFT = {
  space: 0,
  space_member: 0,
  space_invitation: 0,
  space_subscription: 0,
  space_plan_change: 0,
  history_author: 0,
  history_entry: 0,
  project: 0,
  token: 0,
  token_value: 0,
  token_value_reference: 0,
  token_figma_state: 0,
  modifier: 0,
  mode: 0,
  proposal: 0,
  proposal_batch: 0,
};
