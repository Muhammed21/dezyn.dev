import { z } from "zod";

import type { ProjectRooms } from "#modules/project/project-module.ts";
import { err, ok, type Result } from "@repo/result";

const MISSING = "manquante";
const PORT = "port entre 1 et 65535 attendu";
const HTTP_URL = "URL http(s) attendue";

const text = () => z.string({ error: MISSING }).min(1, { error: "vide" });

const httpUrl = () =>
  z.string({ error: MISSING }).pipe(z.url({ protocol: /^https?$/, error: HTTP_URL }));

const port = () =>
  z
    .string({ error: MISSING })
    .pipe(z.coerce.number<string>({ error: PORT }).int().min(1).max(65_535));

const authSecret = () => z.string({ error: MISSING }).min(32, { error: "32 caractères au moins" });

const trustedIpHeader = () => text().default("cf-connecting-ip");

const serverTiming = () =>
  z
    .enum(["true", "false"], { error: "true ou false attendu" })
    .transform((value) => value === "true")
    .default(false);

const postgresUrl = () =>
  z
    .string({ error: MISSING })
    .pipe(z.url({ protocol: /^postgres(ql)?$/, error: "URL postgresql:// attendue" }));

const ApiEnv = z.object({
  DATABASE_URL: postgresUrl(),
  BETTER_AUTH_SECRET: authSecret(),
  BETTER_AUTH_URL: httpUrl(),
  SMTP_HOST: text(),
  SMTP_PORT: port(),
  MAIL_FROM: text(),
  WEB_URL: httpUrl(),
  TRUSTED_IP_HEADER: trustedIpHeader(),
  PORT: port().default(3000),
  SERVER_TIMING: serverTiming(),
});

const WorkerEnv = z
  .object({
    HYPERDRIVE: z
      .object({ connectionString: text() }, { error: "binding Hyperdrive attendu" })
      .optional(),
    DATABASE_URL: postgresUrl().optional(),
    BETTER_AUTH_SECRET: authSecret(),
    BETTER_AUTH_URL: httpUrl(),
    WEB_URL: httpUrl(),
    TRUSTED_IP_HEADER: trustedIpHeader(),
    SERVER_TIMING: serverTiming(),
    RESEND_API_KEY: text().optional(),
    MAIL_FROM: z.email({ error: "adresse email attendue" }).optional(),
    EMAIL_DELIVERY: z.literal("log", { error: "seule la valeur log est admise" }).optional(),
    PROJECT_ROOMS: z
      .custom<ProjectRooms>(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "getByName" in value &&
          typeof value.getByName === "function",
        { error: "binding Durable Object attendu" },
      )
      .optional(),
  })
  .refine((env) => env.HYPERDRIVE !== undefined || env.DATABASE_URL !== undefined, {
    path: ["HYPERDRIVE"],
    error: "manquante, comme DATABASE_URL",
    when: () => true,
  })
  .refine((env) => env.HYPERDRIVE === undefined || env.DATABASE_URL === undefined, {
    path: ["DATABASE_URL"],
    error: "en double avec HYPERDRIVE",
  })
  .refine((env) => env.RESEND_API_KEY === undefined || env.MAIL_FROM !== undefined, {
    path: ["MAIL_FROM"],
    error: MISSING,
  });

const POLAR_VARIABLES = [
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "POLAR_TEAM_PRODUCT_ID",
  "POLAR_SERVER",
] as const;

const blankAsMissing = (value: unknown) => (value === "" ? undefined : value);

const PolarPresence = z.object(
  Object.fromEntries(
    POLAR_VARIABLES.map((name) => [name, z.preprocess(blankAsMissing, z.unknown())]),
  ),
);

const PolarEnv = z.object({
  POLAR_ACCESS_TOKEN: text(),
  POLAR_WEBHOOK_SECRET: text(),
  POLAR_TEAM_PRODUCT_ID: z.string({ error: MISSING }).pipe(z.uuid({ error: "UUID attendu" })),
  POLAR_SERVER: z.enum(["sandbox", "production"], {
    error: (issue) => (issue.input === undefined ? MISSING : "sandbox ou production attendu"),
  }),
});

export type PolarConfig = {
  readonly accessToken: string;
  readonly webhookSecret: string;
  readonly teamProductId: string;
  readonly server: "sandbox" | "production";
};

const polarConfigOf = (env: unknown): Result<PolarConfig | undefined, readonly string[]> => {
  const present = PolarPresence.catch({}).parse(env);
  if (Object.values(present).every((value) => value === undefined)) {
    return ok(undefined);
  }
  const parsed = PolarEnv.safeParse(present);
  if (!parsed.success) {
    return err(issuesOf(parsed.error));
  }
  return ok({
    accessToken: parsed.data.POLAR_ACCESS_TOKEN,
    webhookSecret: parsed.data.POLAR_WEBHOOK_SECRET,
    teamProductId: parsed.data.POLAR_TEAM_PRODUCT_ID,
    server: parsed.data.POLAR_SERVER,
  });
};

const issuesOf = (error: z.ZodError): readonly string[] =>
  error.issues.map(({ path, message }) => `${String(path[0])} : ${message}`);

const VERSIONED_SECRET = /^BETTER_AUTH_SECRET_(.*)$/;
const VERSION = /^[1-9]\d*$/;

const versionedSecretOf = (
  name: string,
  version: string,
  value: unknown,
): Result<AuthSecret, readonly string[]> => {
  const secret = authSecret().safeParse(value);
  if (VERSION.test(version) && secret.success) {
    return ok({ version: Number(version), value: secret.data });
  }
  return err([
    ...(VERSION.test(version) ? [] : [`${name} : numéro de version entier et positif attendu`]),
    ...(secret.success ? [] : secret.error.issues.map(({ message }) => `${name} : ${message}`)),
  ]);
};

const versionedSecretsOf = (env: unknown): Result<readonly AuthSecret[], readonly string[]> => {
  const secrets = Object.entries(z.record(z.string(), z.unknown()).catch({}).parse(env)).flatMap(
    ([name, value]) => {
      const version = VERSIONED_SECRET.exec(name)?.[1];
      return version === undefined ? [] : [versionedSecretOf(name, version, value)];
    },
  );
  const issues = secrets.flatMap((secret) => (secret.ok ? [] : secret.error));
  if (issues.length > 0) {
    return err(issues);
  }
  return ok(
    secrets
      .flatMap((secret) => (secret.ok ? [secret.value] : []))
      .toSorted((left, right) => right.version - left.version),
  );
};

export type AuthSecret = { readonly version: number; readonly value: string };

const issuesOfAll = (
  parsed: { readonly success: true } | { readonly success: false; readonly error: z.ZodError },
  ...others: readonly Result<unknown, readonly string[]>[]
): readonly string[] => [
  ...(parsed.success ? [] : issuesOf(parsed.error)),
  ...others.flatMap((other) => (other.ok ? [] : other.error)),
];

export type ApiConfig = {
  readonly databaseUrl: string;
  readonly authSecret: string;
  readonly authSecrets: readonly AuthSecret[];
  readonly baseURL: string;
  readonly trustedIpHeader: string;
  readonly smtp: { readonly host: string; readonly port: number; readonly from: string };
  readonly webUrl: string;
  readonly port: number;
  readonly serverTiming: boolean;
  readonly polar?: PolarConfig;
};

export const readApiConfig = (
  env: Readonly<Record<string, string | undefined>>,
): Result<ApiConfig, readonly string[]> => {
  const parsed = ApiEnv.safeParse(env);
  const secrets = versionedSecretsOf(env);
  const polar = polarConfigOf(env);
  if (!parsed.success || !secrets.ok || !polar.ok) {
    return err(issuesOfAll(parsed, secrets, polar));
  }
  const { data } = parsed;
  return ok({
    databaseUrl: data.DATABASE_URL,
    authSecret: data.BETTER_AUTH_SECRET,
    authSecrets: secrets.value,
    baseURL: data.BETTER_AUTH_URL,
    trustedIpHeader: data.TRUSTED_IP_HEADER,
    smtp: { host: data.SMTP_HOST, port: data.SMTP_PORT, from: data.MAIL_FROM },
    webUrl: data.WEB_URL,
    port: data.PORT,
    serverTiming: data.SERVER_TIMING,
    ...(polar.value === undefined ? {} : { polar: polar.value }),
  });
};

export type WorkerConfig = Omit<ApiConfig, "smtp" | "port"> & {
  readonly email?: { readonly apiKey: string; readonly from: string };
  readonly emailDelivery?: "log";
  readonly projectRooms?: ProjectRooms;
};

export const readWorkerConfig = (bindings: unknown): Result<WorkerConfig, readonly string[]> => {
  const parsed = WorkerEnv.safeParse(bindings);
  const secrets = versionedSecretsOf(bindings);
  const polar = polarConfigOf(bindings);
  if (!parsed.success || !secrets.ok || !polar.ok) {
    return err(issuesOfAll(parsed, secrets, polar));
  }
  const { data } = parsed;
  return ok({
    databaseUrl: data.HYPERDRIVE?.connectionString ?? data.DATABASE_URL ?? "",
    authSecret: data.BETTER_AUTH_SECRET,
    authSecrets: secrets.value,
    baseURL: data.BETTER_AUTH_URL,
    trustedIpHeader: data.TRUSTED_IP_HEADER,
    webUrl: data.WEB_URL,
    serverTiming: data.SERVER_TIMING,
    ...(data.RESEND_API_KEY && data.MAIL_FROM
      ? { email: { apiKey: data.RESEND_API_KEY, from: data.MAIL_FROM } }
      : {}),
    ...(data.EMAIL_DELIVERY ? { emailDelivery: data.EMAIL_DELIVERY } : {}),
    ...(data.PROJECT_ROOMS ? { projectRooms: data.PROJECT_ROOMS } : {}),
    ...(polar.value === undefined ? {} : { polar: polar.value }),
  });
};

const PurgeEnv = z.object({
  DATABASE_URL_HISTORY_MAINTAINER: postgresUrl(),
  SMTP_HOST: text(),
  SMTP_PORT: port(),
  MAIL_FROM: text(),
});

export type PurgeConfig = {
  readonly databaseUrl: string;
  readonly smtp: ApiConfig["smtp"];
};

export const readPurgeConfig = (
  env: Readonly<Record<string, string | undefined>>,
): Result<PurgeConfig, readonly string[]> => {
  const parsed = PurgeEnv.safeParse(env);
  if (!parsed.success) {
    return err(issuesOf(parsed.error));
  }
  const { data } = parsed;
  return ok({
    databaseUrl: data.DATABASE_URL_HISTORY_MAINTAINER,
    smtp: { host: data.SMTP_HOST, port: data.SMTP_PORT, from: data.MAIL_FROM },
  });
};

const PurgeWorkerEnv = z
  .object({
    HYPERDRIVE: z.object({ connectionString: text() }, { error: "binding Hyperdrive attendu" }),
    RESEND_API_KEY: text().optional(),
    MAIL_FROM: z.email({ error: "adresse email attendue" }).optional(),
    EMAIL_DELIVERY: z.literal("log", { error: "seule la valeur log est admise" }).optional(),
  })
  .refine((env) => env.RESEND_API_KEY === undefined || env.MAIL_FROM !== undefined, {
    path: ["MAIL_FROM"],
    error: MISSING,
  });

export type PurgeWorkerConfig = Pick<WorkerConfig, "databaseUrl" | "email" | "emailDelivery">;

export const readPurgeWorkerConfig = (
  bindings: unknown,
): Result<PurgeWorkerConfig, readonly string[]> => {
  const parsed = PurgeWorkerEnv.safeParse(bindings);
  if (!parsed.success) {
    return err(issuesOf(parsed.error));
  }
  const { data } = parsed;
  return ok({
    databaseUrl: data.HYPERDRIVE.connectionString,
    ...(data.RESEND_API_KEY && data.MAIL_FROM
      ? { email: { apiKey: data.RESEND_API_KEY, from: data.MAIL_FROM } }
      : {}),
    ...(data.EMAIL_DELIVERY ? { emailDelivery: data.EMAIL_DELIVERY } : {}),
  });
};
