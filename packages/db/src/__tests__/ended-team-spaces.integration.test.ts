import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { describe, expect, it } from "vitest";

import { endedTeamSpaces } from "../ended-team-spaces.ts";
import { migrate } from "../migrate.ts";
import { onClient } from "../testing/clients.ts";
import { withThrowawayDatabase } from "../testing/throwaway-database.ts";

const CREATED_AT = new Date("2026-11-01T12:00:00Z");

type SeededSpace = {
  readonly id: string;
  readonly plan: "free" | "team";
  readonly subscriptionStatus?: string;
};

const TEAM_PLAN = { plan: "team" } as const;
const FREE_PLAN = { plan: "free" } as const;

const makeSpace = (overrides: Partial<SeededSpace> = {}): SeededSpace => ({
  id: randomUUID(),
  ...TEAM_PLAN,
  ...overrides,
});

const seedSpace = async (client: Client, { id, plan, subscriptionStatus }: SeededSpace) => {
  await client.query(
    'INSERT INTO "space" ("id", "name", "plan", "created_at") VALUES ($1, $2, $3, $4)',
    [id, "Atelier", plan, CREATED_AT],
  );
  if (subscriptionStatus !== undefined) {
    await client.query(
      'INSERT INTO "space_subscription" ("space_id", "polar_subscription_id", "status", "polar_modified_at") VALUES ($1, $2, $3, $4)',
      [id, `sub_${id}`, subscriptionStatus, CREATED_AT],
    );
  }
};

const seedSpaces = (connectionString: string, spaces: readonly SeededSpace[]) =>
  onClient(connectionString, (client) =>
    spaces.reduce<Promise<void>>(async (previous, space) => {
      await previous;
      await seedSpace(client, space);
    }, Promise.resolve()),
  );

const endedTeamSpacesAmong = (spaces: readonly SeededSpace[]) =>
  withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
    await migrate({ connectionString: migratorUrl });
    await seedSpaces(migratorUrl, spaces);
    return endedTeamSpaces({ connectionString: appUrl });
  });

describe("endedTeamSpaces", () => {
  it("nomme chaque espace en Team dont l'abonnement est terminé, rangés par identifiant", async () => {
    const first = makeSpace({
      ...TEAM_PLAN,
      id: "00000000-0000-4000-8000-000000000001",
      subscriptionStatus: "ended",
    });
    const second = makeSpace({
      ...TEAM_PLAN,
      id: "00000000-0000-4000-8000-000000000002",
      subscriptionStatus: "ended",
    });

    expect(await endedTeamSpacesAmong([second, first])).toEqual([first.id, second.id]);
  });

  it("ignore un espace en Team dont l'abonnement court encore", async () => {
    expect(
      await endedTeamSpacesAmong([
        makeSpace({ ...TEAM_PLAN, subscriptionStatus: "active" }),
        makeSpace({ ...TEAM_PLAN, subscriptionStatus: "past_due" }),
      ]),
    ).toEqual([]);
  });

  it("ignore un espace Free dont l'abonnement est terminé", async () => {
    expect(
      await endedTeamSpacesAmong([makeSpace({ ...FREE_PLAN, subscriptionStatus: "ended" })]),
    ).toEqual([]);
  });

  it("ignore un espace en Team sans abonnement", async () => {
    expect(await endedTeamSpacesAmong([makeSpace(TEAM_PLAN)])).toEqual([]);
  });
});
