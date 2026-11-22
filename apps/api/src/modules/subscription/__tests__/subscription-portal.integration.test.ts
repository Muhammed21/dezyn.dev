import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PostgresDatabase } from "#db";
import {
  type App,
  BASE_URL,
  GRACE,
  obtainAccessToken,
  WEB_URL,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { personalSpaceOf } from "#testing/space-fixtures.ts";
import { makeMerchantOfRecord, seedSubscription } from "#testing/subscription-fixtures.ts";
import { PortalOutput } from "@repo/contracts";
import { schema } from "@repo/db";

const openPortal = (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/portal`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });

const billingWith = (merchantOfRecord: ReturnType<typeof makeMerchantOfRecord>) => ({
  billing: { merchant: merchantOfRecord.merchant, webhookSecret: "whsec_inutile-ici" },
});

const seedMember = (
  db: PostgresDatabase,
  {
    spaceId,
    userId,
    role,
  }: { readonly spaceId: string; readonly userId: string; readonly role: "owner" | "editor" },
) =>
  db.orm
    .insert(schema.spaceMember)
    .values({ id: randomUUID(), spaceId, userId, role, joinedAt: new Date() });

const seedPaidSpace = async (app: App, db: PostgresDatabase) => {
  const payer = await obtainAccessToken(app);
  const spaceId = await personalSpaceOf(db, payer.userId);
  await seedSubscription(db, { spaceId, payerId: payer.userId });
  return { payer, spaceId };
};

describe("le portail client de Polar est réservé au payeur de l'espace (ADR 0050 §3, §7)", () => {
  it("le payeur obtient l'URL de son portail, avec un retour vers la page « Plan »", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(async (app, db) => {
      const { payer, spaceId } = await seedPaidSpace(app, db);

      const response = await openPortal(app, { accessToken: payer.accessToken, spaceId });

      expect(response.status).toBe(201);
      expect(PortalOutput.parse(await response.json())).toEqual({
        url: `https://sandbox.polar.sh/dezyn/portal?customer=${payer.userId}`,
      });
      expect(merchantOfRecord.portals).toEqual([
        { spaceId, payerId: payer.userId, returnUrl: `${WEB_URL}/espaces/${spaceId}/plan` },
      ]);
    }, billingWith(merchantOfRecord));
  });

  it.each(["owner", "editor"] as const)(
    "un membre %s qui ne paie pas reçoit 403, sans portail",
    (role) => {
      const merchantOfRecord = makeMerchantOfRecord();
      return withIdentityApp(async (app, db) => {
        const { spaceId } = await seedPaidSpace(app, db);
        const member = await obtainAccessToken(app, { user: GRACE });
        await seedMember(db, { spaceId, userId: member.userId, role });

        const response = await openPortal(app, { accessToken: member.accessToken, spaceId });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ type: "about:blank", title: "Accès refusé" });
        expect(merchantOfRecord.portals).toEqual([]);
      }, billingWith(merchantOfRecord));
    },
  );

  it("un payeur redevenu éditeur reçoit 403, sans portail", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(async (app, db) => {
      const owner = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, owner.userId);
      const editor = await obtainAccessToken(app, { user: GRACE });
      await seedMember(db, { spaceId, userId: editor.userId, role: "editor" });
      await seedSubscription(db, { spaceId, payerId: editor.userId });

      const response = await openPortal(app, { accessToken: editor.accessToken, spaceId });

      expect(response.status).toBe(403);
      expect(merchantOfRecord.portals).toEqual([]);
    }, billingWith(merchantOfRecord));
  });

  it("le propriétaire d'un espace sans abonnement reçoit 403, sans portail", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);

      const response = await openPortal(app, { accessToken, spaceId });

      expect(response.status).toBe(403);
      expect(merchantOfRecord.portals).toEqual([]);
    }, billingWith(merchantOfRecord));
  });

  it("un non-membre reçoit 404, sans portail", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(async (app, db) => {
      const { spaceId } = await seedPaidSpace(app, db);
      const stranger = await obtainAccessToken(app, { user: GRACE });

      const response = await openPortal(app, { accessToken: stranger.accessToken, spaceId });

      expect(response.status).toBe(404);
      expect(merchantOfRecord.portals).toEqual([]);
    }, billingWith(merchantOfRecord));
  });

  it.each([
    ["qui n'existe pas", randomUUID()],
    ["dont l'identifiant est invalide", "pas-un-uuid"],
  ])("un espace %s reçoit 404", (_case, spaceId) =>
    withIdentityApp(async (app) => {
      const { accessToken } = await obtainAccessToken(app);

      const response = await openPortal(app, { accessToken, spaceId });

      expect(response.status).toBe(404);
    }),
  );

  it("Polar indisponible donne 503", () =>
    withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpace(app, db);

        const response = await openPortal(app, { accessToken: payer.accessToken, spaceId });

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ title: "Paiement indisponible" });
      },
      billingWith(makeMerchantOfRecord({ available: false })),
    ));

  it("sans Polar configuré, le portail donne 503", () =>
    withIdentityApp(
      async (app, db) => {
        const { payer, spaceId } = await seedPaidSpace(app, db);

        const response = await openPortal(app, { accessToken: payer.accessToken, spaceId });

        expect(response.status).toBe(503);
      },
      { billing: null },
    ));
});
