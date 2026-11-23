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

type PolarAnswer = { readonly status: number; readonly answer: unknown };

const withRoutedPolar = async (
  answerOf: (request: { readonly method: string; readonly path: string }) => PolarAnswer,
  run: (polar: { readonly baseUrl: string; readonly received: ReceivedRequest[] }) => Promise<void>,
) => {
  const received: ReceivedRequest[] = [];
  const answerRequest = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await bodyOf(request);
    received.push({
      method: request.method,
      path: request.url,
      headers: request.headers,
      body: body === "" ? undefined : JSON.parse(body),
    });
    const { status, answer } = answerOf({ method: request.method ?? "", path: request.url ?? "" });
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

const withFakePolar = (
  answer: PolarAnswer,
  run: (polar: { readonly baseUrl: string; readonly received: ReceivedRequest[] }) => Promise<void>,
) => withRoutedPolar(() => answer, run);

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

const REFUSAL = { spaceId: SPACE_ID, subscriptionId: SUBSCRIPTION_ID };

const ORDER_ID = "3b2a1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";

const SECOND_ORDER_ID = "8c7d6e5f-4a3b-4c2d-9e1f-0a9b8c7d6e5f";

const REFUND_METADATA = { dezyn_refused_subscription_id: SUBSCRIPTION_ID };

const REFUND_COMMENT = "Abonnement payé par un utilisateur qui n'est pas propriétaire de l'espace";

const makePolarSubscription = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: SUBSCRIPTION_ID,
  created_at: "2026-11-22T09:59:00.000Z",
  modified_at: "2026-11-22T10:05:00.000Z",
  amount: 3499,
  currency: "eur",
  recurring_interval: "month",
  status: "canceled",
  cancel_at_period_end: false,
  canceled_at: "2026-11-22T10:05:00.000Z",
  ended_at: "2026-11-22T10:05:00.000Z",
  metadata: { referenceId: SPACE_ID },
  ...overrides,
});

const makePolarOrder = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: ORDER_ID,
  created_at: "2026-11-22T10:00:00.000Z",
  modified_at: "2026-11-22T10:00:05.000Z",
  status: "paid",
  paid: true,
  subtotal_amount: 3499,
  discount_amount: 0,
  net_amount: 3499,
  tax_amount: 700,
  total_amount: 4199,
  applied_balance_amount: 0,
  due_amount: 0,
  refunded_amount: 0,
  refunded_tax_amount: 0,
  currency: "eur",
  billing_reason: "subscription_create",
  subscription_id: SUBSCRIPTION_ID,
  refundable_amount: 3499,
  refundable_tax_amount: 700,
  metadata: {},
  ...overrides,
});

const makePolarRefund = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d",
  created_at: "2026-11-22T10:06:00.000Z",
  modified_at: null,
  metadata: REFUND_METADATA,
  status: "pending",
  reason: "other",
  amount: 3499,
  tax_amount: 700,
  currency: "eur",
  organization_id: "8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e",
  order_id: ORDER_ID,
  subscription_id: SUBSCRIPTION_ID,
  customer_id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  revoke_benefits: false,
  dispute: null,
  ...overrides,
});

const listOf = (items: readonly unknown[]) => ({
  items,
  pagination: { total_count: items.length, max_page: 1 },
});

describe("la révocation immédiate chez Polar d'un abonnement refusé (ADR 0055)", () => {
  it("révoque l'abonnement tout de suite", () =>
    withFakePolar(
      { status: 200, answer: makePolarSubscription() },
      async ({ baseUrl, received }) => {
        const revoked = await merchantAt(baseUrl).revokeNow(REFUSAL);

        expect(revoked).toEqual({ ok: true, value: undefined });
        expect(received).toEqual([
          expect.objectContaining({
            method: "DELETE",
            path: `/v1/subscriptions/${SUBSCRIPTION_ID}`,
          }),
        ]);
        expect(received[0]?.headers).toMatchObject({
          authorization: "Bearer polar_oat_jeton-de-test",
          "polar-version": "2027-01",
        });
      },
    ));

  it("un abonnement déjà révoqué (403 AlreadyCanceledSubscription) compte comme révoqué", () =>
    withFakePolar(
      {
        status: 403,
        answer: {
          error: "AlreadyCanceledSubscription",
          detail: "This subscription is already revoked.",
        },
      },
      async ({ baseUrl }) => {
        const records: LogRecord[] = [];

        const revoked = await merchantAt(baseUrl, (record) => records.push(record)).revokeNow(
          REFUSAL,
        );

        expect(revoked).toEqual({ ok: true, value: undefined });
        expect(records).toEqual([]);
      },
    ));

  it.each([500, 404, 409])(
    "une réponse %i de Polar rend la révocation indisponible, et se journalise",
    (status) =>
      withFakePolar({ status, answer: { detail: [] } }, async ({ baseUrl }) => {
        const records: LogRecord[] = [];

        const revoked = await merchantAt(baseUrl, (record) => records.push(record)).revokeNow(
          REFUSAL,
        );

        expect(revoked).toEqual({ ok: false, error: "unavailable" });
        expect(records).toEqual([
          expect.objectContaining({
            level: "warn",
            msg: "polar revoke failed",
            spaceId: SPACE_ID,
            subscriptionId: SUBSCRIPTION_ID,
          }),
        ]);
      }),
  );
});

const routesWith =
  ({
    orders,
    refunds = [],
    created = { status: 201, answer: makePolarRefund() },
  }: {
    readonly orders: readonly unknown[];
    readonly refunds?: readonly unknown[];
    readonly created?: PolarAnswer;
  }) =>
  ({ method, path }: { readonly method: string; readonly path: string }): PolarAnswer => {
    if (method === "GET" && path.startsWith("/v1/orders/")) {
      return { status: 200, answer: listOf(orders) };
    }
    if (method === "GET" && path.startsWith("/v1/refunds/")) {
      return { status: 200, answer: listOf(refunds) };
    }
    return created;
  };

const refundsCreated = (received: readonly ReceivedRequest[]) =>
  received.filter(({ method, path }) => method === "POST" && path === "/v1/refunds/");

describe("le remboursement intégral chez Polar d'un abonnement refusé (ADR 0055)", () => {
  it("rembourse tout le montant remboursable de chaque commande payée de l'abonnement", () =>
    withRoutedPolar(
      routesWith({
        orders: [
          makePolarOrder(),
          makePolarOrder({
            id: SECOND_ORDER_ID,
            status: "partially_refunded",
            refundable_amount: 1200,
            refunded_amount: 2299,
          }),
        ],
      }),
      async ({ baseUrl, received }) => {
        const refunded = await merchantAt(baseUrl).refundAll(REFUSAL);

        expect(refunded).toEqual({ ok: true, value: undefined });
        const bodies = refundsCreated(received).map(({ body }) => body);
        expect(bodies).toHaveLength(2);
        expect(bodies).toEqual(
          expect.arrayContaining([
            {
              order_id: ORDER_ID,
              amount: 3499,
              reason: "other",
              comment: REFUND_COMMENT,
              metadata: REFUND_METADATA,
            },
            {
              order_id: SECOND_ORDER_ID,
              amount: 1200,
              reason: "other",
              comment: REFUND_COMMENT,
              metadata: REFUND_METADATA,
            },
          ]),
        );
      },
    ));

  it("cherche les commandes et les remboursements de cet abonnement seulement", () =>
    withRoutedPolar(routesWith({ orders: [makePolarOrder()] }), async ({ baseUrl, received }) => {
      await merchantAt(baseUrl).refundAll(REFUSAL);

      const paths = received.filter(({ method }) => method === "GET").map(({ path }) => path);
      expect(paths).toEqual([
        expect.stringMatching(
          new RegExp(`^/v1/orders/\\?subscription_id=${SUBSCRIPTION_ID}&page=1&limit=100&`),
        ),
        expect.stringMatching(
          new RegExp(`^/v1/refunds/\\?subscription_id=${SUBSCRIPTION_ID}&page=1&limit=100&`),
        ),
      ]);
    }));

  it.each(["pending", "succeeded"])(
    "ne rembourse pas une commande qui a déjà un remboursement %s de dezyn pour cet abonnement",
    (status) =>
      withRoutedPolar(
        routesWith({ orders: [makePolarOrder()], refunds: [makePolarRefund({ status })] }),
        async ({ baseUrl, received }) => {
          const refunded = await merchantAt(baseUrl).refundAll(REFUSAL);

          expect(refunded).toEqual({ ok: true, value: undefined });
          expect(refundsCreated(received)).toEqual([]);
        },
      ),
  );

  it.each([
    ["échoué", { status: "failed" }],
    ["annulé", { status: "canceled" }],
    ["d'une autre origine", { metadata: {} }],
    ["d'un autre abonnement refusé", { metadata: { dezyn_refused_subscription_id: "autre" } }],
    ["d'une autre commande", { order_id: SECOND_ORDER_ID }],
  ])("un remboursement %s n'empêche pas de rembourser la commande", (_case, refund) =>
    withRoutedPolar(
      routesWith({ orders: [makePolarOrder()], refunds: [makePolarRefund(refund)] }),
      async ({ baseUrl, received }) => {
        await merchantAt(baseUrl).refundAll(REFUSAL);

        expect(refundsCreated(received)).toHaveLength(1);
      },
    ),
  );

  it.each([
    ["déjà remboursée en entier", { status: "refunded", refundable_amount: 0 }],
    ["sans montant remboursable", { refundable_amount: 0 }],
    ["pas encore payée", { status: "pending", paid: false }],
    ["annulée", { status: "void", paid: false }],
  ])("ne rembourse pas une commande %s", (_case, order) =>
    withRoutedPolar(
      routesWith({ orders: [makePolarOrder(), makePolarOrder({ id: SECOND_ORDER_ID, ...order })] }),
      async ({ baseUrl, received }) => {
        await merchantAt(baseUrl).refundAll(REFUSAL);

        expect(refundsCreated(received).map(({ body }) => body)).toEqual([
          expect.objectContaining({ order_id: ORDER_ID }),
        ]);
      },
    ),
  );

  it("une commande déjà remboursée en entier (403 RefundedAlready) compte comme remboursée", () =>
    withRoutedPolar(
      routesWith({
        orders: [makePolarOrder()],
        created: {
          status: 403,
          answer: { error: "RefundedAlready", detail: "Order is already fully refunded." },
        },
      }),
      async ({ baseUrl }) => {
        const records: LogRecord[] = [];

        const refunded = await merchantAt(baseUrl, (record) => records.push(record)).refundAll(
          REFUSAL,
        );

        expect(refunded).toEqual({ ok: true, value: undefined });
        expect(records).toEqual([]);
      },
    ));

  it("sans commande payée, le remboursement reste à faire, et se journalise", () =>
    withRoutedPolar(
      routesWith({ orders: [makePolarOrder({ status: "pending", paid: false })] }),
      async ({ baseUrl, received }) => {
        const records: LogRecord[] = [];

        const refunded = await merchantAt(baseUrl, (record) => records.push(record)).refundAll(
          REFUSAL,
        );

        expect(refunded).toEqual({ ok: false, error: "unavailable" });
        expect(refundsCreated(received)).toEqual([]);
        expect(records).toEqual([
          {
            level: "warn",
            msg: "polar refund failed: no paid order yet",
            spaceId: SPACE_ID,
            subscriptionId: SUBSCRIPTION_ID,
          },
        ]);
      },
    ));

  it.each([500, 422])(
    "une réponse %i de Polar rend le remboursement indisponible, et se journalise",
    (status) =>
      withRoutedPolar(
        routesWith({ orders: [makePolarOrder()], created: { status, answer: { detail: [] } } }),
        async ({ baseUrl }) => {
          const records: LogRecord[] = [];

          const refunded = await merchantAt(baseUrl, (record) => records.push(record)).refundAll(
            REFUSAL,
          );

          expect(refunded).toEqual({ ok: false, error: "unavailable" });
          expect(records).toEqual([
            expect.objectContaining({
              level: "warn",
              msg: "polar refund failed",
              spaceId: SPACE_ID,
              subscriptionId: SUBSCRIPTION_ID,
            }),
          ]);
        },
      ),
  );

  it("une liste de commandes en erreur rend le remboursement indisponible, sans rien rembourser", () =>
    withRoutedPolar(
      () => ({ status: 500, answer: { detail: "Internal Server Error" } }),
      async ({ baseUrl, received }) => {
        const refunded = await merchantAt(baseUrl).refundAll(REFUSAL);

        expect(refunded).toEqual({ ok: false, error: "unavailable" });
        expect(refundsCreated(received)).toEqual([]);
      },
    ));
});
