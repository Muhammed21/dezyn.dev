import { createHash, randomBytes, randomUUID } from "node:crypto";

import { oauthProvider, oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { betterAuth, type BetterAuthOptions, type GenericEndpointContext } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins/jwt";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { PostgresDatabase } from "#db";
import type { AuthSecret } from "#platform/api-config.ts";
import type { Clock } from "#platform/clock.ts";
import { errorDetails, type LogSink } from "#platform/logging.ts";
import { createAccessTokenVerifier } from "@repo/auth-verifier";
import { schema } from "@repo/db";
import { err, ok, type Result } from "@repo/result";

import type { Auth, PasswordRefusal } from "../application/auth.ts";
import { defaultToNativeForLoopback } from "../domain/client-registration.ts";
import { sessionEndCutsChains } from "../domain/refresh-chain.ts";
import { refreshGrantOutcome } from "../domain/refresh-grant.ts";
import { postgresActiveGrants } from "./postgres-active-grants.ts";
import { postgresRefreshChains, type RefreshChains } from "./postgres-refresh-chains.ts";

const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;

export const REGISTRATION_RATE_LIMIT = { window: HOUR_SECONDS, max: 10 } as const;

export const PASSWORD_CHECK_RATE_LIMIT = { window: 15 * 60, max: 5 } as const;

const VERIFY_PASSWORD_PATH = "/verify-password";

export const IDENTITY_SCHEMA = {
  user: schema.identityUser,
  session: schema.identitySession,
  account: schema.identityAccount,
  verification: schema.identityVerification,
  rateLimit: schema.identityRateLimit,
  jwks: schema.identityJwks,
  oauthClient: schema.identityOAuthClient,
  oauthResource: schema.identityOAuthResource,
  oauthClientResource: schema.identityOAuthClientResource,
  oauthRefreshToken: schema.identityOAuthRefreshToken,
  oauthAccessToken: schema.identityOAuthAccessToken,
  oauthConsent: schema.identityOAuthConsent,
  oauthClientAssertion: schema.identityOAuthClientAssertion,
};

export const generateIdentityId = (): string => randomUUID();

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("base64url");

export const generateRefreshToken = (): string => randomBytes(32).toString("base64url");

export const apiResourceOf = (baseURL: string): string => new URL("/v1", baseURL).href;

const RefreshGrant = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string(),
});

const StoredRefreshToken = z.object({
  userId: z.string(),
  clientId: z.string(),
  sessionId: z.string().nullable(),
  revoked: z.date().nullable(),
  rotationReplayExpiresAt: z.date().nullable(),
  authTime: z.date().nullable(),
});

const guardRefreshGrant = async ({
  ctx,
  chains,
}: {
  readonly ctx: GenericEndpointContext;
  readonly chains: RefreshChains;
}): Promise<void> => {
  const grant = RefreshGrant.safeParse(ctx.body);
  if (!grant.success) {
    return;
  }
  const stored = StoredRefreshToken.safeParse(
    await ctx.context.adapter.findOne({
      model: "oauthRefreshToken",
      where: [{ field: "token", value: hashToken(grant.data.refresh_token) }],
    }),
  );
  if (!stored.success) {
    return;
  }
  const consent = await ctx.context.adapter.findOne({
    model: "oauthConsent",
    where: [
      { field: "userId", value: stored.data.userId },
      { field: "clientId", value: stored.data.clientId },
    ],
  });
  const { userId, clientId, sessionId } = stored.data;
  const outcome = refreshGrantOutcome({
    token: stored.data,
    consented: consent !== null,
    cut: sessionId !== null && (await chains.isCut({ userId, clientId, sessionId })),
    now: new Date(),
  });
  if (outcome === "reuse") {
    await ctx.context.internalAdapter.deleteUserSessions(stored.data.userId);
    await chains.cutChainsOfUser(stored.data.userId);
  }
  if (outcome !== "allowed") {
    throw new APIError("BAD_REQUEST", { error: "invalid_grant" });
  }
};

export const identityAuthOptions = ({
  baseURL,
  trustedIpHeader,
  webOrigin,
  chains,
}: {
  readonly baseURL: string;
  readonly trustedIpHeader: string;
  readonly webOrigin: string;
  readonly chains: RefreshChains;
}) =>
  ({
    basePath: "/auth",
    baseURL,
    disabledPaths: ["/token"],
    trustedOrigins: [webOrigin],
    advanced: {
      database: { generateId: generateIdentityId },
      ipAddress: { ipAddressHeaders: [trustedIpHeader] },
      disableOriginCheck: false,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/oauth2/register": REGISTRATION_RATE_LIMIT,
        [VERIFY_PASSWORD_PATH]: PASSWORD_CHECK_RATE_LIMIT,
      },
    },
    emailAndPassword: { enabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/oauth2/token") {
          await guardRefreshGrant({ ctx, chains });
          return undefined;
        }
        return ctx.path === "/oauth2/register"
          ? { context: { body: defaultToNativeForLoopback(ctx.body) } }
          : undefined;
      }),
    },
    plugins: [
      jwt({
        jwks: { rotationInterval: 90 * DAY_SECONDS, gracePeriod: DAY_SECONDS },
        disableSettingJwtHeader: true,
      }),
      oauthProvider({
        loginPage: "/login",
        consentPage: "/consent",
        resources: [apiResourceOf(baseURL)],
        enforcePerClientResources: false,
        scopes: ["offline_access"],
        accessTokenExpiresIn: 15 * 60,
        refreshTokenExpiresIn: 60 * DAY_SECONDS,
        refreshTokenReuseInterval: 30,
        generateRefreshToken,
        storeTokens: { hash: hashToken },
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
    ],
  }) satisfies BetterAuthOptions;

const initialized = async <A extends { readonly $context: Promise<unknown> }>({
  build,
  log,
}: {
  readonly build: () => A;
  readonly log: LogSink;
}): Promise<A> => {
  const auth = build();
  try {
    await auth.$context;
    return auth;
  } catch (error) {
    log({ level: "warn", msg: "better-auth init retried", ...errorDetails(error) });
    const retried = build();
    await retried.$context;
    return retried;
  }
};

const withoutTokens = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(withoutTokens);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "token")
        .map(([key, child]) => [key, withoutTokens(child)]),
    );
  }
  return value;
};

const parsedJson = (text: string): { readonly value: unknown } | undefined => {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
};

const withoutSessionTokens = async (response: Response) => {
  const json = parsedJson(await response.clone().text());
  if (json === undefined) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(withoutTokens(json.value)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const PASSWORD_CHECKS = new Map<number, Result<void, PasswordRefusal>>([
  [200, ok(undefined)],
  [400, err("wrong_password")],
  [429, err("too_many_attempts")],
]);

const forwardedHeaders = ({
  headers,
  trustedIpHeader,
}: {
  readonly headers: Headers;
  readonly trustedIpHeader: string;
}) =>
  new Headers([
    ["content-type", "application/json"],
    ...["cookie", "origin", trustedIpHeader].flatMap((name): [string, string][] => {
      const value = headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  ]);

export const createIdentityAuth = async ({
  db,
  secret,
  baseURL,
  trustedIpHeader,
  log,
  onUserCreated,
  clock = () => new Date(),
  secrets = [],
  webUrl,
}: {
  readonly db: PostgresDatabase;
  readonly secret: string;
  readonly secrets?: readonly AuthSecret[];
  readonly baseURL: string;
  readonly trustedIpHeader: string;
  readonly log: LogSink;
  readonly onUserCreated: (user: { readonly id: string; readonly name: string }) => Promise<void>;
  readonly clock?: Clock;
  readonly webUrl: string;
}): Promise<Auth> => {
  const chains = postgresRefreshChains(db, clock);
  const build = () =>
    betterAuth({
      ...identityAuthOptions({
        baseURL,
        trustedIpHeader,
        webOrigin: new URL(webUrl).origin,
        chains,
      }),
      databaseHooks: {
        session: {
          delete: {
            after: async (session) => {
              if (sessionEndCutsChains({ expiresAt: session.expiresAt, now: clock() })) {
                await chains.cutChainsOfSession(session.id);
              }
            },
          },
        },
        user: {
          create: {
            after: async (user) => {
              try {
                await onUserCreated(user);
              } catch (error) {
                await db.orm.delete(schema.identityUser).where(eq(schema.identityUser.id, user.id));
                throw error;
              }
            },
          },
        },
      },
      secret,
      ...(secrets.length > 0 ? { secrets: [...secrets] } : {}),
      database: drizzleAdapter(db.orm, { provider: "pg", schema: IDENTITY_SCHEMA }),
      logger: {
        log: (level, message) => {
          log({ level, msg: message, source: "better-auth" });
        },
      },
    });
  const auth = await initialized({ build, log });
  const issuer = (await auth.api.getOAuthServerConfig()).issuer;
  const verifier = createAccessTokenVerifier({
    jwksUrl: new URL("/auth/jwks", baseURL).href,
    issuer,
    audience: apiResourceOf(baseURL),
    activeGrants: postgresActiveGrants(db, clock),
    fetchJwks: (url) => auth.handler(new Request(url)),
  });
  const authorizationServerMetadata = oauthProviderAuthServerMetadata(auth);

  return {
    baseURL,
    handle: async (request) => withoutSessionTokens(await auth.handler(request)),
    verifyAccessToken: verifier.verify,
    sessionOf: async (headers) => {
      try {
        const session = await auth.api.getSession({ headers });
        return ok(session === null ? undefined : { userId: session.user.id });
      } catch (error) {
        log({ level: "error", msg: "session check failed", ...errorDetails(error) });
        return err("unavailable");
      }
    },
    checkSigningKey: async () => {
      try {
        await auth.api.signJWT({ body: { payload: {} } });
        return ok(undefined);
      } catch (error) {
        log({ level: "error", msg: "signing key check failed", ...errorDetails(error) });
        return err("unusable");
      }
    },
    verifyPassword: async ({ headers, password }) => {
      try {
        const response = await auth.handler(
          new Request(new URL(`/auth${VERIFY_PASSWORD_PATH}`, baseURL), {
            method: "POST",
            headers: forwardedHeaders({ headers, trustedIpHeader }),
            body: JSON.stringify({ password }),
          }),
        );
        return PASSWORD_CHECKS.get(response.status) ?? err("unavailable");
      } catch (error) {
        log({ level: "error", msg: "password check failed", ...errorDetails(error) });
        return err("unavailable");
      }
    },
    authorizationServerMetadata,
    protectedResourceMetadata: async () =>
      Response.json({
        resource: apiResourceOf(baseURL),
        authorization_servers: [issuer],
        bearer_methods_supported: ["header"],
      }),
  };
};
