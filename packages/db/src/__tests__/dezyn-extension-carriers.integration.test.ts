import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { describe, expect, it } from "vitest";

import { dezynExtensionCarriers } from "../dezyn-extension-carriers.ts";
import { migrate } from "../migrate.ts";
import { onClient } from "../testing/clients.ts";
import { withThrowawayDatabase } from "../testing/throwaway-database.ts";

const CREATED_AT = new Date("2026-11-01T12:00:00Z");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";

const BATCH_ID = "00000000-0000-4000-8000-0000000000bb";

type SeededToken = { readonly id: string; readonly extensions: unknown };

type SeededProposal = { readonly id: string; readonly payload: object };

const WITH_DEZYN = { "dev.dezyn": { contrastOn: ["{couleur.fond}"] } };

const WITH_OTHER_TOOL = { "com.figma": { "dev.dezyn": true } };

const makeToken = (overrides: Partial<SeededToken> = {}): SeededToken => ({
  id: randomUUID(),
  extensions: null,
  ...overrides,
});

const makeProposal = (extensions?: object): SeededProposal => ({
  id: randomUUID(),
  payload: {
    name: `couleur.${randomUUID()}`,
    $type: "color",
    $value: { colorSpace: "srgb", components: [0, 0, 0] },
    ...(extensions === undefined ? {} : { $extensions: extensions }),
  },
});

const seedProject = async (client: Client) => {
  const spaceId = randomUUID();
  await client.query(
    'INSERT INTO "space" ("id", "name", "plan", "created_at") VALUES ($1, $2, $3, $4)',
    [spaceId, "Atelier", "free", CREATED_AT],
  );
  await client.query(
    'INSERT INTO "project" ("id", "space_id", "name", "created_at") VALUES ($1, $2, $3, $4)',
    [PROJECT_ID, spaceId, "Marque", CREATED_AT],
  );
  await client.query(
    'INSERT INTO "proposal_batch" ("id", "project_id", "client_id", "state", "opened_at", "last_written_at") VALUES ($1, $2, $3, $4, $5, $5)',
    [BATCH_ID, PROJECT_ID, "client-ia", "closed", CREATED_AT],
  );
};

const seedToken = (client: Client, { id, extensions }: SeededToken) =>
  client.query(
    'INSERT INTO "token" ("id", "project_id", "name", "type", "extensions", "status", "created_at") VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, PROJECT_ID, `couleur.${id}`, "color", JSON.stringify(extensions), "validated", CREATED_AT],
  );

const seedProposal = (client: Client, { id, payload }: SeededProposal) =>
  client.query(
    'INSERT INTO "proposal" ("id", "project_id", "batch_id", "token_name", "kind", "payload", "status", "created_at") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [id, PROJECT_ID, BATCH_ID, randomUUID(), "create", payload, "proposed", CREATED_AT],
  );

const carriersAmong = ({
  tokens = [],
  proposals = [],
}: {
  readonly tokens?: readonly SeededToken[];
  readonly proposals?: readonly SeededProposal[];
}) =>
  withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
    await migrate({ connectionString: migratorUrl });
    await onClient(migratorUrl, async (client) => {
      await seedProject(client);
      await Promise.all(tokens.map((token) => seedToken(client, token)));
      await Promise.all(proposals.map((proposal) => seedProposal(client, proposal)));
    });
    return dezynExtensionCarriers({ connectionString: appUrl });
  });

describe("dezynExtensionCarriers (ADR 0061 §2)", () => {
  it("nomme chaque token stocké qui porte dev.dezyn, rangés par identifiant", async () => {
    const first = makeToken({ id: "00000000-0000-4000-8000-000000000001", extensions: WITH_DEZYN });
    const second = makeToken({
      id: "00000000-0000-4000-8000-000000000002",
      extensions: { "dev.dezyn": {}, "com.figma": {} },
    });

    expect(await carriersAmong({ tokens: [second, first, makeToken()] })).toEqual([
      `token ${first.id}`,
      `token ${second.id}`,
    ]);
  });

  it("nomme chaque proposition dont le token porte dev.dezyn", async () => {
    const carrying = makeProposal(WITH_DEZYN);

    expect(await carriersAmong({ proposals: [carrying, makeProposal()] })).toEqual([
      `proposal ${carrying.id}`,
    ]);
  });

  it("ignore les extensions d'un autre outil, même quand elles contiennent dev.dezyn", async () => {
    expect(
      await carriersAmong({
        tokens: [makeToken({ extensions: WITH_OTHER_TOOL })],
        proposals: [makeProposal(WITH_OTHER_TOOL)],
      }),
    ).toEqual([]);
  });

  it("ne rend rien sur une base sans token ni proposition", async () => {
    expect(await carriersAmong({})).toEqual([]);
  });
});
