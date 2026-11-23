import { describe, expect, it } from "vitest";

import { makeAccount, makeApp, makeAuth } from "#testing/make-app.ts";
import { err, ok, type Result } from "@repo/result";

import type { PasswordCheck, PasswordRefusal } from "../application/auth.ts";

const WEB_URL = "https://dezyn.dev";
const USER_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";
const COOKIE = "dezyn.session_token=jeton-de-session";
const PASSWORD = "un-mot-de-passe-solide";

const makePasswordApp = (outcome: Result<void, PasswordRefusal>) => {
  const checks: { readonly cookie: string | null; readonly password: string }[] = [];
  const { app } = makeApp({
    webUrl: WEB_URL,
    auth: makeAuth({
      sessionOf: () => Promise.resolve(ok({ userId: USER_ID })),
      verifyPassword: async ({ headers, password }: PasswordCheck) => {
        checks.push({ cookie: headers.get("cookie"), password });
        return outcome;
      },
    }),
    account: {
      ...makeAccount(),
      deleteAccount: async ({ userId, checkPassword }) => {
        const checked = await checkPassword();
        if (userId !== USER_ID) {
          return err({ kind: "unavailable" });
        }
        return checked.ok ? ok(undefined) : err({ kind: checked.error });
      },
    },
  });
  return { app, checks };
};

const deleteAccount = (app: ReturnType<typeof makePasswordApp>["app"]) =>
  app.request("http://127.0.0.1:3000/v1/account", {
    method: "DELETE",
    headers: { cookie: COOKIE, origin: WEB_URL, "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });

describe("la route de suppression du compte vérifie le mot de passe de la requête", () => {
  it("vérifie le mot de passe donné avec la session de la requête, puis supprime", async () => {
    const { app, checks } = makePasswordApp(ok(undefined));

    const response = await deleteAccount(app);

    expect(response.status).toBe(204);
    expect(checks).toEqual([{ cookie: COOKIE, password: PASSWORD }]);
  });
});

describe("la route de suppression du compte traduit le refus du mot de passe", () => {
  it.each([
    ["wrong_password", 403, "Mot de passe incorrect", "https://dezyn.dev/problems/wrong-password"],
    ["too_many_attempts", 429, "Trop d'essais", "about:blank"],
    ["unavailable", 503, "Service indisponible", "about:blank"],
  ] as const)("%s répond %i", async (refusal, status, title, type) => {
    const { app } = makePasswordApp(err(refusal));

    const response = await deleteAccount(app);

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ type, title, status });
  });
});
