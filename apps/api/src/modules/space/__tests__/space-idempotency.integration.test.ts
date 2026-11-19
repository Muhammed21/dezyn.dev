import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  type App,
  BASE_URL,
  GRACE,
  obtainAccessToken,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import {
  closeMembership,
  demoteToEditor,
  makeOutbox,
  membershipsOf,
  personalSpaceOf,
  switchToTeam,
  tokenOf,
} from "#testing/space-fixtures.ts";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@repo/contracts";

const keyHeader = (idempotencyKey: string | undefined): Readonly<Record<string, string>> =>
  idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey };

const inviteWithKey = (
  app: App,
  {
    accessToken,
    spaceId,
    idempotencyKey,
  }: { readonly accessToken: string; readonly spaceId: string; readonly idempotencyKey?: string },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/invitations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...keyHeader(idempotencyKey),
    },
    body: JSON.stringify({ email: GRACE.email }),
  });

const acceptWithKey = (
  app: App,
  {
    accessToken,
    token,
    idempotencyKey,
  }: { readonly accessToken: string; readonly token: string; readonly idempotencyKey?: string },
) =>
  app.request(`${BASE_URL}/v1/invitations/${token}/accept`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, ...keyHeader(idempotencyKey) },
  });

const seedTeamOwner = async (app: App, db: PostgresDatabase) => {
  const owner = await obtainAccessToken(app);
  const spaceId = await personalSpaceOf(db, owner.userId);
  await switchToTeam(db, spaceId);
  return { ...owner, spaceId };
};

const seedInvitation = async (
  app: App,
  db: PostgresDatabase,
  outbox: ReturnType<typeof makeOutbox>,
) => {
  const ada = await seedTeamOwner(app, db);
  await inviteWithKey(app, { accessToken: ada.accessToken, spaceId: ada.spaceId });
  const grace = await obtainAccessToken(app, { user: GRACE });
  return { spaceId: ada.spaceId, grace, token: tokenOf(outbox.sent.at(-1)) };
};

const withoutCorrelation = async (response: Response) => {
  const { correlationId: _correlationId, ...body } = await response.json();
  return { status: response.status, body };
};

describe("une invitation renvoyée avec la même Idempotency-Key n'envoie qu'un e-mail", () => {
  it("rejoue le 201 et le corps de la première invitation, signalés par Idempotency-Replayed", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, spaceId } = await seedTeamOwner(app, db);
        const request = { accessToken, spaceId, idempotencyKey: randomUUID() };
        const first = await inviteWithKey(app, request);
        const firstBody = await first.json();

        const retried = await inviteWithKey(app, request);

        expect(first.status).toBe(201);
        expect(retried.status).toBe(201);
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
        expect(await retried.json()).toEqual(firstBody);
        expect(outbox.sent).toHaveLength(1);
      },
      { mailer: outbox.mailer },
    );
  });

  it("ne rejoue pas l'invitation à un membre qui ne peut plus inviter : il reçoit la réponse d'un envoi sans clé", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { accessToken, spaceId, userId } = await seedTeamOwner(app, db);
        const request = { accessToken, spaceId, idempotencyKey: randomUUID() };
        await inviteWithKey(app, request);
        await demoteToEditor(db, { spaceId, userId });
        const withoutKey = await inviteWithKey(app, { accessToken, spaceId });

        const retried = await inviteWithKey(app, request);

        expect(retried.status).toBe(403);
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
        expect(await withoutCorrelation(retried)).toEqual(await withoutCorrelation(withoutKey));
        expect(outbox.sent).toHaveLength(1);
      },
      { mailer: outbox.mailer },
    );
  });
});

describe("une acceptation d'invitation renvoyée avec la même Idempotency-Key rend la même réponse", () => {
  it("rejoue le 200 et l'espace rejoint, au lieu d'un refus pour une invitation déjà utilisée", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { spaceId, grace, token } = await seedInvitation(app, db, outbox);
        const request = { accessToken: grace.accessToken, token, idempotencyKey: randomUUID() };
        const first = await acceptWithKey(app, request);
        const firstBody = await first.json();

        const retried = await acceptWithKey(app, request);

        expect(first.status).toBe(200);
        expect(retried.status).toBe(200);
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
        expect(await retried.json()).toEqual(firstBody);
        expect(await membershipsOf(db, { spaceId, userId: grace.userId })).toHaveLength(1);
      },
      { mailer: outbox.mailer },
    );
  });

  it("ne rejoue pas l'acceptation à un invité qui a quitté l'espace : il reçoit la réponse d'un envoi sans clé", () => {
    const outbox = makeOutbox();
    return withIdentityApp(
      async (app, db) => {
        const { spaceId, grace, token } = await seedInvitation(app, db, outbox);
        const request = { accessToken: grace.accessToken, token, idempotencyKey: randomUUID() };
        await acceptWithKey(app, request);
        await closeMembership(db, { spaceId, userId: grace.userId });
        const withoutKey = await acceptWithKey(app, { accessToken: grace.accessToken, token });

        const retried = await acceptWithKey(app, request);

        expect(retried.status).toBe(410);
        expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
        expect(await withoutCorrelation(retried)).toEqual(await withoutCorrelation(withoutKey));
      },
      { mailer: outbox.mailer },
    );
  });
});
