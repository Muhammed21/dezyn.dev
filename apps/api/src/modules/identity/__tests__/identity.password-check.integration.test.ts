import { describe, expect, it } from "vitest";

import { createPostgresDatabase, type PostgresDatabase } from "#db";
import type { LogRecord } from "#platform/logging.ts";
import { ADA, makeClientIp } from "#testing/authorization-flow.ts";
import { migrate } from "@repo/db";
import { withThrowawayDatabase } from "@repo/db/testing";
import { err, ok } from "@repo/result";

import type { Auth } from "../application/auth.ts";
import { createIdentityAuth } from "../infrastructure/better-auth.ts";

const BASE_URL = "http://127.0.0.1:3000";
const WEB_URL = "http://127.0.0.1:5173";

type PasswordCheckContext = {
  readonly auth: Auth;
  readonly db: PostgresDatabase;
  readonly records: readonly LogRecord[];
};

const withAuth = (run: (context: PasswordCheckContext) => Promise<void>) =>
  withThrowawayDatabase(async ({ migratorUrl, appUrl }) => {
    await migrate({ connectionString: migratorUrl });
    const opened = createPostgresDatabase({ url: appUrl });
    const closed = { done: false };
    const db: PostgresDatabase = {
      ...opened,
      close: async () => {
        closed.done = true;
        await opened.close();
      },
    };
    const records: LogRecord[] = [];
    try {
      const auth = await createIdentityAuth({
        webUrl: WEB_URL,
        db,
        secret: "secret-de-test-de-32-caracteres-au-moins",
        baseURL: BASE_URL,
        trustedIpHeader: "x-forwarded-for",
        log: (record) => {
          records.push(record);
        },
        onUserCreated: () => Promise.resolve(),
      });
      await run({ auth, db, records });
    } finally {
      if (!closed.done) {
        await opened.close();
      }
    }
  });

const signedUpCookie = async (auth: Auth) => {
  const response = await auth.handle(
    new Request(`${BASE_URL}/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: WEB_URL,
        "x-forwarded-for": makeClientIp(),
      },
      body: JSON.stringify(ADA),
    }),
  );
  const [pair = ""] = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  return pair;
};

const makeSessionHeaders = (cookie: string) =>
  new Headers({ cookie, origin: WEB_URL, "x-forwarded-for": makeClientIp() });

const PASSWORD_CHECK_FAILED = expect.objectContaining({
  level: "error",
  msg: "password check failed",
});

describe("better-auth vérifie le mot de passe de la session (constat J)", () => {
  it("accepte le mot de passe actuel", () =>
    withAuth(async ({ auth }) => {
      const headers = makeSessionHeaders(await signedUpCookie(auth));

      expect(await auth.verifyPassword({ headers, password: ADA.password })).toEqual(ok(undefined));
    }));

  it("refuse un autre mot de passe", () =>
    withAuth(async ({ auth }) => {
      const headers = makeSessionHeaders(await signedUpCookie(auth));

      expect(await auth.verifyPassword({ headers, password: "pas-le-bon" })).toEqual(
        err("wrong_password"),
      );
    }));

  it("sans session, la vérification est indisponible, sans panne journalisée", () =>
    withAuth(async ({ auth, records }) => {
      await signedUpCookie(auth);

      expect(
        await auth.verifyPassword({
          headers: new Headers({ origin: WEB_URL, "x-forwarded-for": makeClientIp() }),
          password: ADA.password,
        }),
      ).toEqual(err("unavailable"));
      expect(records).not.toContainEqual(PASSWORD_CHECK_FAILED);
    }));

  it("la vérification est indisponible quand la base ne répond plus, et la panne est journalisée", () =>
    withAuth(async ({ auth, db, records }) => {
      const headers = makeSessionHeaders(await signedUpCookie(auth));
      await db.close();

      expect(await auth.verifyPassword({ headers, password: ADA.password })).toEqual(
        err("unavailable"),
      );
      expect(records).toContainEqual(PASSWORD_CHECK_FAILED);
    }));
});
