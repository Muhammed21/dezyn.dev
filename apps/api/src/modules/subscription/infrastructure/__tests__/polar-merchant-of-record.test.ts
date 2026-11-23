import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import type { LogRecord } from "#platform/logging.ts";

import { polarMerchantOfRecord } from "../polar.ts";

type ReceivedRequest = {
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly headers: IncomingMessage["headers"];
  readonly body: unknown;
};

const SPACE_ID = "6d1f0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const PAYER_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const TEAM_PRODUCT_ID = "5c4b3a29-1807-4f6e-9d5c-4b3a29180706";
const SUCCESS_URL = `https://dezyn.dev/espaces/${SPACE_ID}/plan?checkout={CHECKOUT_ID}`;

const bodyOf = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

const withFakePolar = async (
  { status, answer }: { readonly status: number; readonly answer: unknown },
  run: (polar: { readonly baseUrl: string; readonly received: ReceivedRequest[] }) => Promise<void>,
) => {
  const received: ReceivedRequest[] = [];
  const answerRequest = async (request: IncomingMessage, response: ServerResponse) => {
    received.push({
      method: request.method,
      path: request.url,
      headers: request.headers,
      body: JSON.parse(await bodyOf(request)),
    });
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  };
  const server = createServer((request, response) => {
    void answerRequest(request, response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, received });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
};

const merchantAt = (baseUrl: string, log: (record: LogRecord) => void = () => undefined) =>
  polarMerchantOfRecord({
    accessToken: "polar_oat_jeton-de-test",
    server: "sandbox",
    teamProductId: TEAM_PRODUCT_ID,
    log,
    baseUrl,
  });

describe("le checkout Polar du produit Team (ADR 0050 §3, §7)", () => {
  it("crée un checkout du produit Team qui porte l'espace, le payeur et le retour vers la page « Plan »", () =>
    withFakePolar(
      { status: 201, answer: { url: "https://sandbox.polar.sh/checkout/polar_c_1" } },
      async ({ baseUrl, received }) => {
        await merchantAt(baseUrl).createCheckout({
          spaceId: SPACE_ID,
          payerId: PAYER_ID,
          successUrl: SUCCESS_URL,
        });

        expect(received).toEqual([
          expect.objectContaining({
            method: "POST",
            path: "/v1/checkouts/",
            body: {
              products: [TEAM_PRODUCT_ID],
              external_customer_id: PAYER_ID,
              metadata: { referenceId: SPACE_ID },
              success_url: SUCCESS_URL,
            },
          }),
        ]);
        expect(received[0]?.headers).toMatchObject({
          authorization: "Bearer polar_oat_jeton-de-test",
          "polar-version": "2027-01",
        });
      },
    ));

  it("rend l'URL du checkout renvoyée par Polar", () =>
    withFakePolar(
      { status: 201, answer: { url: "https://sandbox.polar.sh/checkout/polar_c_1" } },
      async ({ baseUrl }) => {
        const checkout = await merchantAt(baseUrl).createCheckout({
          spaceId: SPACE_ID,
          payerId: PAYER_ID,
          successUrl: SUCCESS_URL,
        });

        expect(checkout).toEqual({
          ok: true,
          value: { url: "https://sandbox.polar.sh/checkout/polar_c_1" },
        });
      },
    ));

  it.each([500, 422])(
    "une réponse %i de Polar rend le paiement indisponible, et se journalise",
    (status) =>
      withFakePolar({ status, answer: { detail: [] } }, async ({ baseUrl }) => {
        const records: LogRecord[] = [];

        const checkout = await merchantAt(baseUrl, (record) => records.push(record)).createCheckout(
          {
            spaceId: SPACE_ID,
            payerId: PAYER_ID,
            successUrl: SUCCESS_URL,
          },
        );

        expect(checkout).toEqual({ ok: false, error: "unavailable" });
        expect(records).toEqual([
          expect.objectContaining({
            level: "error",
            msg: "polar checkout failed",
            spaceId: SPACE_ID,
          }),
        ]);
      }),
  );
});

const PORTAL_URL = "https://sandbox.polar.sh/dezyn/portal?customer_session_token=polar_cst_1";
const RETURN_URL = `https://dezyn.dev/espaces/${SPACE_ID}/plan`;

describe("le portail client Polar du payeur (ADR 0050 §3, §7)", () => {
  it("ouvre une session client du payeur, avec un retour vers la page « Plan »", () =>
    withFakePolar(
      { status: 201, answer: { customer_portal_url: PORTAL_URL } },
      async ({ baseUrl, received }) => {
        await merchantAt(baseUrl).createPortal({
          spaceId: SPACE_ID,
          payerId: PAYER_ID,
          returnUrl: RETURN_URL,
        });

        expect(received).toEqual([
          expect.objectContaining({
            method: "POST",
            path: "/v1/customer-sessions/",
            body: { external_customer_id: PAYER_ID, return_url: RETURN_URL },
          }),
        ]);
        expect(received[0]?.headers).toMatchObject({
          authorization: "Bearer polar_oat_jeton-de-test",
          "polar-version": "2027-01",
        });
      },
    ));

  it("rend l'URL du portail renvoyée par Polar", () =>
    withFakePolar(
      { status: 201, answer: { customer_portal_url: PORTAL_URL } },
      async ({ baseUrl }) => {
        const portal = await merchantAt(baseUrl).createPortal({
          spaceId: SPACE_ID,
          payerId: PAYER_ID,
          returnUrl: RETURN_URL,
        });

        expect(portal).toEqual({ ok: true, value: { url: PORTAL_URL } });
      },
    ));

  it.each([500, 404])(
    "une réponse %i de Polar rend le portail indisponible, et se journalise",
    (status) =>
      withFakePolar({ status, answer: { detail: [] } }, async ({ baseUrl }) => {
        const records: LogRecord[] = [];

        const portal = await merchantAt(baseUrl, (record) => records.push(record)).createPortal({
          spaceId: SPACE_ID,
          payerId: PAYER_ID,
          returnUrl: RETURN_URL,
        });

        expect(portal).toEqual({ ok: false, error: "unavailable" });
        expect(records).toEqual([
          expect.objectContaining({
            level: "error",
            msg: "polar customer portal failed",
            spaceId: SPACE_ID,
          }),
        ]);
      }),
  );
});

const SUBSCRIPTION_ID = "0d3f6a2b-7c1e-4b8a-9f2d-5e6a7b8c9d0e";

describe("la résiliation Polar en fin de période (ADR 0050 §3, §7)", () => {
  it("demande à Polar de résilier l'abonnement à la fin de la période", () =>
    withFakePolar(
      { status: 200, answer: { id: SUBSCRIPTION_ID, cancel_at_period_end: true } },
      async ({ baseUrl, received }) => {
        const canceled = await merchantAt(baseUrl).cancelAtPeriodEnd({
          spaceId: SPACE_ID,
          subscriptionId: SUBSCRIPTION_ID,
        });

        expect(canceled).toEqual({ ok: true, value: undefined });
        expect(received).toEqual([
          expect.objectContaining({
            method: "PATCH",
            path: `/v1/subscriptions/${SUBSCRIPTION_ID}`,
            body: { cancel_at_period_end: true },
          }),
        ]);
        expect(received[0]?.headers).toMatchObject({
          authorization: "Bearer polar_oat_jeton-de-test",
          "polar-version": "2027-01",
        });
      },
    ));

  it.each([500, 404])(
    "une réponse %i de Polar rend la résiliation indisponible, et se journalise",
    (status) =>
      withFakePolar({ status, answer: { detail: [] } }, async ({ baseUrl }) => {
        const records: LogRecord[] = [];

        const canceled = await merchantAt(baseUrl, (record) =>
          records.push(record),
        ).cancelAtPeriodEnd({ spaceId: SPACE_ID, subscriptionId: SUBSCRIPTION_ID });

        expect(canceled).toEqual({ ok: false, error: "unavailable" });
        expect(records).toEqual([
          expect.objectContaining({
            level: "error",
            msg: "polar cancel at period end failed",
            spaceId: SPACE_ID,
            subscriptionId: SUBSCRIPTION_ID,
          }),
        ]);
      }),
  );
});
