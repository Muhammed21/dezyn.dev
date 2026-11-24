import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import { PLANS } from "#modules/space/contracts/plan.ts";
import { schema } from "@repo/db";

import type { SpacePayers } from "../application/open-portal.ts";
import type { PayerDepartures } from "../application/payer-leaves.ts";
import type { SubscriptionUnitOfWork } from "../application/receive-notification.ts";
import type { CancelRequests } from "../application/replay-cancellations.ts";
import type { RefundRevocations } from "../application/revoke-refunded.ts";
import type { Refusals } from "../application/settle-refusals.ts";
import type { SpacePlans } from "../application/start-checkout.ts";
import {
  CANCELABLE_STATUSES,
  type DepartedSubscription,
  isCancelable,
} from "../domain/payer-departure.ts";
import { SUBSCRIPTION_STATUSES } from "../domain/subscription.ts";

const {
  identityUser,
  project,
  space,
  spaceMember,
  spacePlanChange,
  spaceRefundRevocation,
  spaceRefusedSubscription,
  spaceSubscription,
} = schema;

const StoredPlan = z.enum(PLANS);

const StoredSubscription = z
  .object({
    id: z.string(),
    payerId: z.string().nullable(),
    status: z.enum(SUBSCRIPTION_STATUSES),
    currentPeriodEnd: z.date().nullable(),
    modifiedAt: z.date(),
    storedBytesAtEnd: z.number().nullable(),
  })
  .transform(({ payerId, currentPeriodEnd, storedBytesAtEnd, ...subscription }) => ({
    ...subscription,
    payerId: payerId ?? undefined,
    currentPeriodEnd: currentPeriodEnd ?? undefined,
    storedBytesAtEnd: storedBytesAtEnd ?? undefined,
  }));

const StoredBytes = z.object({ storedBytes: z.coerce.number() });

export const postgresSpacePlans = (db: PostgresDatabase): SpacePlans => ({
  planOf: async (spaceId) => {
    const [row] = await db.orm
      .select({ plan: space.plan })
      .from(space)
      .where(eq(space.id, spaceId));
    return StoredPlan.parse(row?.plan);
  },
});

const ReadSubscription = z
  .object({
    status: z.enum(SUBSCRIPTION_STATUSES),
    currentPeriodEnd: z.date().nullable(),
    payerId: z.string().nullable(),
    payerName: z.string().nullable(),
    payerEmail: z.string().nullable(),
    payerLeft: z.boolean(),
  })
  .transform(
    ({ currentPeriodEnd, payerId, payerName, payerEmail, payerLeft, ...subscription }) => ({
      ...subscription,
      currentPeriodEnd: currentPeriodEnd ?? undefined,
      payer:
        payerId === null || payerName === null || payerEmail === null
          ? undefined
          : { id: payerId, name: payerName, email: payerEmail, left: payerLeft },
    }),
  );

export const postgresSpaceSubscriptions = (db: PostgresDatabase) => ({
  subscriptionOf: async (spaceId: string) => {
    const [row] = await db.orm
      .select({
        status: spaceSubscription.status,
        currentPeriodEnd: spaceSubscription.currentPeriodEnd,
        payerId: identityUser.id,
        payerName: identityUser.name,
        payerEmail: identityUser.email,
        payerLeft: sql<boolean>`not exists (select 1 from ${spaceMember} where ${spaceMember.spaceId} = ${spaceSubscription.spaceId} and ${spaceMember.userId} = ${spaceSubscription.payerId} and ${spaceMember.closedAt} is null)`,
      })
      .from(spaceSubscription)
      .leftJoin(identityUser, eq(identityUser.id, spaceSubscription.payerId))
      .where(eq(spaceSubscription.spaceId, spaceId));
    return row === undefined ? undefined : ReadSubscription.parse(row);
  },
});

const StoredDeparture = z
  .object({
    id: z.string(),
    payerId: z.string(),
    payerName: z.string(),
    status: z.enum(SUBSCRIPTION_STATUSES),
    currentPeriodEnd: z.date().nullable(),
    spaceId: z.string(),
    spaceName: z.string(),
  })
  .transform(({ currentPeriodEnd, ...departure }) => ({
    ...departure,
    currentPeriodEnd: currentPeriodEnd ?? undefined,
  }));

export const postgresPayerDepartures = (db: PostgresDatabase): PayerDepartures => ({
  subscriptionOf: async (spaceId) => {
    const [row] = await db.orm
      .select({
        id: spaceSubscription.polarSubscriptionId,
        payerId: spaceSubscription.payerId,
        payerName: identityUser.name,
        status: spaceSubscription.status,
        currentPeriodEnd: spaceSubscription.currentPeriodEnd,
        spaceId: space.id,
        spaceName: space.name,
      })
      .from(spaceSubscription)
      .innerJoin(identityUser, eq(identityUser.id, spaceSubscription.payerId))
      .innerJoin(space, eq(space.id, spaceSubscription.spaceId))
      .where(eq(spaceSubscription.spaceId, spaceId));
    return row === undefined ? undefined : StoredDeparture.parse(row);
  },
  openOwnerEmailsOf: async (spaceId) => {
    const rows = await db.orm
      .select({ email: identityUser.email })
      .from(spaceMember)
      .innerJoin(identityUser, eq(identityUser.id, spaceMember.userId))
      .where(
        and(
          eq(spaceMember.spaceId, spaceId),
          eq(spaceMember.role, "owner"),
          isNull(spaceMember.closedAt),
        ),
      );
    return rows.map(({ email }) => email);
  },
});

export const paidSubscriptionsOn =
  (tx: PostgresTransaction) =>
  async (userId: string): Promise<readonly DepartedSubscription[]> => {
    const rows = await tx
      .select({
        id: spaceSubscription.polarSubscriptionId,
        payerId: spaceSubscription.payerId,
        payerName: identityUser.name,
        status: spaceSubscription.status,
        currentPeriodEnd: spaceSubscription.currentPeriodEnd,
        spaceId: space.id,
        spaceName: space.name,
      })
      .from(spaceSubscription)
      .innerJoin(identityUser, eq(identityUser.id, spaceSubscription.payerId))
      .innerJoin(space, eq(space.id, spaceSubscription.spaceId))
      .where(and(eq(spaceSubscription.payerId, userId), ne(spaceSubscription.status, "ended")))
      .orderBy(space.name, space.id);
    return rows.map((row) => StoredDeparture.parse(row));
  };

export const cancelRequestOn =
  (tx: PostgresTransaction) =>
  async ({
    spaceId,
    userId,
    at,
  }: {
    readonly spaceId: string;
    readonly userId: string;
    readonly at: Date;
  }): Promise<void> => {
    await tx
      .update(spaceSubscription)
      .set({ cancelRequestedAt: at })
      .where(
        and(
          eq(spaceSubscription.spaceId, spaceId),
          eq(spaceSubscription.payerId, userId),
          inArray(spaceSubscription.status, CANCELABLE_STATUSES),
          isNull(spaceSubscription.cancelRequestedAt),
        ),
      );
  };

export const postgresCancelRequests = (db: PostgresDatabase): CancelRequests => ({
  pending: () =>
    db.orm
      .select({
        spaceId: spaceSubscription.spaceId,
        subscriptionId: spaceSubscription.polarSubscriptionId,
      })
      .from(spaceSubscription)
      .where(isNotNull(spaceSubscription.cancelRequestedAt)),
  sent: async (spaceId) => {
    await db.orm
      .update(spaceSubscription)
      .set({ cancelRequestedAt: null })
      .where(eq(spaceSubscription.spaceId, spaceId));
  },
});

export const postgresSpacePayers = (db: PostgresDatabase): SpacePayers => ({
  payerOf: async (spaceId) => {
    const [row] = await db.orm
      .select({ payerId: spaceSubscription.payerId })
      .from(spaceSubscription)
      .where(eq(spaceSubscription.spaceId, spaceId));
    return row?.payerId ?? undefined;
  },
});

export const postgresSubscriptionUnitOfWork = (db: PostgresDatabase): SubscriptionUnitOfWork => ({
  run: (work) =>
    db.orm.transaction((tx) =>
      work({
        lockSpace: async (spaceId) => {
          const [locked] = await tx
            .select({ plan: space.plan })
            .from(space)
            .where(eq(space.id, spaceId))
            .for("update");
          return locked === undefined ? undefined : StoredPlan.parse(locked.plan);
        },
        isUser: async (userId) => {
          const [user] = await tx
            .select({ id: identityUser.id })
            .from(identityUser)
            .where(eq(identityUser.id, userId));
          return user !== undefined;
        },
        isOpenOwner: async ({ spaceId, userId }) => {
          const [owner] = await tx
            .select({ id: spaceMember.id })
            .from(spaceMember)
            .where(
              and(
                eq(spaceMember.spaceId, spaceId),
                eq(spaceMember.userId, userId),
                eq(spaceMember.role, "owner"),
                isNull(spaceMember.closedAt),
              ),
            );
          return owner !== undefined;
        },
        isRefused: async (subscriptionId) => {
          const [refused] = await tx
            .select({ id: spaceRefusedSubscription.polarSubscriptionId })
            .from(spaceRefusedSubscription)
            .where(eq(spaceRefusedSubscription.polarSubscriptionId, subscriptionId));
          return refused !== undefined;
        },
        refuse: async ({ subscriptionId, spaceId, payerId, at }) => {
          await tx
            .insert(spaceRefusedSubscription)
            .values({
              polarSubscriptionId: subscriptionId,
              spaceId,
              payerId: payerId ?? null,
              receivedAt: at,
            })
            .onConflictDoNothing();
        },
        storedBytesOf: async (spaceId) => {
          const [stored] = await tx
            .select({ storedBytes: sql`coalesce(sum(${project.storedBytes}), 0)` })
            .from(project)
            .where(eq(project.spaceId, spaceId));
          return StoredBytes.parse(stored).storedBytes;
        },
        subscriptionOf: async (spaceId) => {
          const [row] = await tx
            .select({
              id: spaceSubscription.polarSubscriptionId,
              payerId: spaceSubscription.payerId,
              status: spaceSubscription.status,
              currentPeriodEnd: spaceSubscription.currentPeriodEnd,
              modifiedAt: spaceSubscription.polarModifiedAt,
              storedBytesAtEnd: spaceSubscription.storedBytesAtEnd,
            })
            .from(spaceSubscription)
            .where(eq(spaceSubscription.spaceId, spaceId));
          return row === undefined ? undefined : StoredSubscription.parse(row);
        },
        save: async ({ spaceId, subscription }) => {
          const stored = {
            polarSubscriptionId: subscription.id,
            payerId: subscription.payerId ?? null,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd ?? null,
            polarModifiedAt: subscription.modifiedAt,
            storedBytesAtEnd: subscription.storedBytesAtEnd ?? null,
            ...(isCancelable(subscription.status) ? {} : { cancelRequestedAt: null }),
          };
          await tx
            .insert(spaceSubscription)
            .values({ spaceId, ...stored })
            .onConflictDoUpdate({ target: spaceSubscription.spaceId, set: stored });
        },
        changePlan: async ({ spaceId, subscriptionId, event, planChange, at }) => {
          await tx.update(space).set({ plan: planChange.after }).where(eq(space.id, spaceId));
          await tx.insert(spacePlanChange).values({
            id: randomUUID(),
            spaceId,
            polarSubscriptionId: subscriptionId,
            polarEvent: event,
            planBefore: planChange.before,
            planAfter: planChange.after,
            changedAt: at,
          });
        },
      }),
    ),
});

const unsettled = or(
  isNull(spaceRefusedSubscription.revokedAt),
  isNull(spaceRefusedSubscription.refundedAt),
);

export const postgresRefusals = (db: PostgresDatabase): Refusals => ({
  pending: () =>
    db.orm
      .select({
        spaceId: spaceRefusedSubscription.spaceId,
        subscriptionId: spaceRefusedSubscription.polarSubscriptionId,
      })
      .from(spaceRefusedSubscription)
      .where(unsettled),
  claim: async ({ subscriptionId, at, staleBefore }) => {
    const [claimed] = await db.orm
      .update(spaceRefusedSubscription)
      .set({ settlingSince: at })
      .where(
        and(
          eq(spaceRefusedSubscription.polarSubscriptionId, subscriptionId),
          unsettled,
          or(
            isNull(spaceRefusedSubscription.settlingSince),
            lt(spaceRefusedSubscription.settlingSince, staleBefore),
          ),
        ),
      )
      .returning({
        revokedAt: spaceRefusedSubscription.revokedAt,
        refundedAt: spaceRefusedSubscription.refundedAt,
      });
    return claimed === undefined
      ? undefined
      : { revoked: claimed.revokedAt !== null, refunded: claimed.refundedAt !== null };
  },
  release: async ({ subscriptionId, revokedAt, refundedAt }) => {
    await db.orm
      .update(spaceRefusedSubscription)
      .set({ settlingSince: null, revokedAt, refundedAt })
      .where(eq(spaceRefusedSubscription.polarSubscriptionId, subscriptionId));
  },
});

export const postgresRefundRevocations = (db: PostgresDatabase): RefundRevocations => ({
  record: async ({ subscriptionId, orderId, at }) => {
    const [recorded] = await db.orm
      .insert(spaceRefundRevocation)
      .select(
        db.orm
          .select({
            polarSubscriptionId: spaceSubscription.polarSubscriptionId,
            spaceId: spaceSubscription.spaceId,
            polarOrderId: sql<string>`${orderId}`.as("polar_order_id"),
            receivedAt: sql<Date>`${at}`.as("received_at"),
            revokedAt: sql<null>`null`.as("revoked_at"),
            settlingSince: sql<Date>`${at}`.as("settling_since"),
          })
          .from(spaceSubscription)
          .where(
            and(
              eq(spaceSubscription.polarSubscriptionId, subscriptionId),
              ne(spaceSubscription.status, "ended"),
            ),
          ),
      )
      .onConflictDoNothing()
      .returning({
        spaceId: spaceRefundRevocation.spaceId,
        subscriptionId: spaceRefundRevocation.polarSubscriptionId,
        orderId: spaceRefundRevocation.polarOrderId,
      });
    return recorded;
  },
  pending: () =>
    db.orm
      .select({
        spaceId: spaceRefundRevocation.spaceId,
        subscriptionId: spaceRefundRevocation.polarSubscriptionId,
        orderId: spaceRefundRevocation.polarOrderId,
      })
      .from(spaceRefundRevocation)
      .where(isNull(spaceRefundRevocation.revokedAt)),
  claim: async ({ subscriptionId, at, staleBefore }) => {
    const claimed = await db.orm
      .update(spaceRefundRevocation)
      .set({ settlingSince: at })
      .where(
        and(
          eq(spaceRefundRevocation.polarSubscriptionId, subscriptionId),
          isNull(spaceRefundRevocation.revokedAt),
          or(
            isNull(spaceRefundRevocation.settlingSince),
            lt(spaceRefundRevocation.settlingSince, staleBefore),
          ),
        ),
      )
      .returning({ subscriptionId: spaceRefundRevocation.polarSubscriptionId });
    return claimed.length > 0;
  },
  release: async ({ subscriptionId, revokedAt }) => {
    await db.orm
      .update(spaceRefundRevocation)
      .set({ settlingSince: null, revokedAt })
      .where(eq(spaceRefundRevocation.polarSubscriptionId, subscriptionId));
  },
});
