import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  type App,
  BASE_URL,
  GRACE,
  obtainAccessToken,
  WEB_URL,
  withIdentityApp,
} from "#testing/authorization-flow.ts";
import { personalSpaceOf, seedTeamSpaceWith, switchToTeam } from "#testing/space-fixtures.ts";
import { makeMerchantOfRecord } from "#testing/subscription-fixtures.ts";
import { CheckoutOutput } from "@repo/contracts";
import { schema } from "@repo/db";

const startCheckout = (
  app: App,
  { accessToken, spaceId }: { readonly accessToken: string; readonly spaceId: string },
) =>
  app.request(`${BASE_URL}/v1/spaces/${spaceId}/checkout`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });

const billingWith = (merchantOfRecord: ReturnType<typeof makeMerchantOfRecord>) => ({
  billing: { merchant: merchantOfRecord.merchant, webhookSecret: "whsec_inutile-ici" },
});

describe("le checkout du plan Team est réservé aux propriétaires de l'espace (ADR 0050 §3, §7)", () => {
  it("un propriétaire obtient l'URL d'un checkout qui porte son espace et revient vers la page « Plan »", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);

      const response = await startCheckout(app, { accessToken, spaceId });

      expect(response.status).toBe(201);
      expect(CheckoutOutput.parse(await response.json())).toEqual({
        url: `https://sandbox.polar.sh/checkout/polar_c_test?space=${spaceId}`,
      });
      expect(merchantOfRecord.checkouts).toEqual([
        {
          spaceId,
          payerId: userId,
          successUrl: `${WEB_URL}/espaces/${spaceId}/plan?checkout={CHECKOUT_ID}`,
        },
      ]);
    }, billingWith(merchantOfRecord));
  });

  it("un éditeur reçoit 403, sans checkout", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(async (app, db) => {
      const editor = await obtainAccessToken(app, { user: GRACE });
      const spaceId = await seedTeamSpaceWith(db, { userId: editor.userId, role: "editor" });
      await db.orm.update(schema.space).set({ plan: "free" }).where(eq(schema.space.id, spaceId));

      const response = await startCheckout(app, { accessToken: editor.accessToken, spaceId });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ type: "about:blank", title: "Accès refusé" });
      expect(merchantOfRecord.checkouts).toEqual([]);
    }, billingWith(merchantOfRecord));
  });

  it("un non-membre reçoit 404, sans checkout", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(async (app, db) => {
      const owner = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, owner.userId);
      const stranger = await obtainAccessToken(app, { user: GRACE });

      const response = await startCheckout(app, { accessToken: stranger.accessToken, spaceId });

      expect(response.status).toBe(404);
      expect(merchantOfRecord.checkouts).toEqual([]);
    }, billingWith(merchantOfRecord));
  });

  it("un espace qui n'existe pas reçoit 404", () =>
    withIdentityApp(async (app) => {
      const { accessToken } = await obtainAccessToken(app);

      const response = await startCheckout(app, { accessToken, spaceId: randomUUID() });

      expect(response.status).toBe(404);
    }));

  it("un identifiant d'espace invalide reçoit 404", () =>
    withIdentityApp(async (app) => {
      const { accessToken } = await obtainAccessToken(app);

      const response = await startCheckout(app, { accessToken, spaceId: "pas-un-uuid" });

      expect(response.status).toBe(404);
    }));

  it("un espace déjà Team reçoit 409, pour ne pas payer deux fois", () => {
    const merchantOfRecord = makeMerchantOfRecord();
    return withIdentityApp(async (app, db) => {
      const { accessToken, userId } = await obtainAccessToken(app);
      const spaceId = await personalSpaceOf(db, userId);
      await switchToTeam(db, spaceId);

      const response = await startCheckout(app, { accessToken, spaceId });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        type: "https://dezyn.dev/problems/already-team",
        title: "Espace déjà au plan Team",
        status: 409,
      });
      expect(merchantOfRecord.checkouts).toEqual([]);
    }, billingWith(merchantOfRecord));
  });

  it("Polar indisponible donne 503", () =>
    withIdentityApp(
      async (app, db) => {
        const { accessToken, userId } = await obtainAccessToken(app);
        const spaceId = await personalSpaceOf(db, userId);

        const response = await startCheckout(app, { accessToken, spaceId });

        expect(response.status).toBe(503);
      },
      billingWith(makeMerchantOfRecord({ available: false })),
    ));

  it("sans Polar configuré, le checkout donne 503", () =>
    withIdentityApp(
      async (app, db) => {
        const { accessToken, userId } = await obtainAccessToken(app);
        const spaceId = await personalSpaceOf(db, userId);

        const response = await startCheckout(app, { accessToken, spaceId });

        expect(response.status).toBe(503);
      },
      { billing: null },
    ));
});
