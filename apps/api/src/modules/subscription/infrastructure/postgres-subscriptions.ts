import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { PostgresDatabase } from "#db";
import { PLANS } from "#modules/space/contracts/plan.ts";
import { schema } from "@repo/db";

import type { SubscriptionUnitOfWork } from "../application/receive-notification.ts";
import type { SpacePlans } from "../application/start-checkout.ts";
import { SUBSCRIPTION_STATUSES } from "../domain/subscription.ts";

const { identityUser, space, spacePlanChange, spaceSubscription } = schema;

const StoredPlan = z.enum(PLANS);

const StoredSubscription = z
  .object({
    id: z.string(),
    payerId: z.string(),
    status: z.enum(SUBSCRIPTION_STATUSES),
    currentPeriodEnd: z.date().nullable(),
    modifiedAt: z.date(),
  })
  .transform(({ currentPeriodEnd, ...subscription }) => ({
    ...subscription,
    currentPeriodEnd: currentPeriodEnd ?? undefined,
  }));

export const postgresSpacePlans = (db: PostgresDatabase): SpacePlans => ({
  planOf: async (spaceId) => {
    const [row] = await db.orm
      .select({ plan: space.plan })
      .from(space)
      .where(eq(space.id, spaceId));
    return StoredPlan.parse(row?.plan);
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
        subscriptionOf: async (spaceId) => {
          const [row] = await tx
            .select({
              id: spaceSubscription.polarSubscriptionId,
              payerId: spaceSubscription.payerId,
              status: spaceSubscription.status,
              currentPeriodEnd: spaceSubscription.currentPeriodEnd,
              modifiedAt: spaceSubscription.polarModifiedAt,
            })
            .from(spaceSubscription)
            .where(eq(spaceSubscription.spaceId, spaceId));
          return row === undefined ? undefined : StoredSubscription.parse(row);
        },
        save: async ({ spaceId, subscription }) => {
          const stored = {
            polarSubscriptionId: subscription.id,
            payerId: subscription.payerId,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd ?? null,
            polarModifiedAt: subscription.modifiedAt,
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
