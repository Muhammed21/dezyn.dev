import { describe, expect, it } from "vitest";

import { err, ok } from "@repo/result";

import {
  readApiConfig,
  readPurgeConfig,
  readPurgeWorkerConfig,
  readWorkerConfig,
} from "../api-config.ts";

const makeEnv = (overrides: Readonly<Record<string, string | undefined>> = {}) => ({
  DATABASE_URL: "postgresql://app@127.0.0.1:5432/dezyn",
  BETTER_AUTH_SECRET: "secret-de-test-de-32-caracteres-au-moins",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  MAIL_FROM: "dezyn <no-reply@dezyn.test>",
  WEB_URL: "http://127.0.0.1:5173",
  ...overrides,
});

describe("l'API lit sa configuration dans l'environnement", () => {
  it("un environnement complet donne la configuration, avec l'en-tête d'IP et le port par défaut", () => {
    expect(readApiConfig(makeEnv())).toEqual(
      ok({
        databaseUrl: "postgresql://app@127.0.0.1:5432/dezyn",
        authSecret: "secret-de-test-de-32-caracteres-au-moins",
        authSecrets: [],
        baseURL: "http://127.0.0.1:3000",
        trustedIpHeader: "cf-connecting-ip",
        smtp: { host: "127.0.0.1", port: 1025, from: "dezyn <no-reply@dezyn.test>" },
        webUrl: "http://127.0.0.1:5173",
        port: 3000,
        serverTiming: false,
      }),
    );
  });

  it("TRUSTED_IP_HEADER et PORT remplacent les valeurs par défaut", () => {
    const config = readApiConfig(makeEnv({ TRUSTED_IP_HEADER: "x-forwarded-for", PORT: "8080" }));

    expect(config).toMatchObject(ok({ trustedIpHeader: "x-forwarded-for", port: 8080 }));
  });

  it("chaque variable manquante est nommée, toutes en une fois", () => {
    expect(readApiConfig({})).toEqual(
      err([
        "DATABASE_URL : manquante",
        "BETTER_AUTH_SECRET : manquante",
        "BETTER_AUTH_URL : manquante",
        "SMTP_HOST : manquante",
        "SMTP_PORT : manquante",
        "MAIL_FROM : manquante",
        "WEB_URL : manquante",
      ]),
    );
  });

  it.each([
    ["DATABASE_URL", "http://127.0.0.1:5432/dezyn", "URL postgresql:// attendue"],
    ["BETTER_AUTH_SECRET", "x".repeat(31), "32 caractères au moins"],
    ["DATABASE_URL", "xpostgres://127.0.0.1/dezyn", "URL postgresql:// attendue"],
    ["DATABASE_URL", "postgresqlx://127.0.0.1/dezyn", "URL postgresql:// attendue"],
    ["BETTER_AUTH_URL", "127.0.0.1:3000", "URL http(s) attendue"],
    ["BETTER_AUTH_URL", "xhttp://127.0.0.1:3000", "URL http(s) attendue"],
    ["BETTER_AUTH_URL", "httpsx://127.0.0.1:3000", "URL http(s) attendue"],
    ["WEB_URL", "ftp://127.0.0.1", "URL http(s) attendue"],
    ["SMTP_HOST", "", "vide"],
    ["MAIL_FROM", "", "vide"],
    ["SMTP_PORT", "abc", "port entre 1 et 65535 attendu"],
    ["SMTP_PORT", "0", "port entre 1 et 65535 attendu"],
    ["PORT", "65536", "port entre 1 et 65535 attendu"],
    ["PORT", "80.5", "port entre 1 et 65535 attendu"],
    ["TRUSTED_IP_HEADER", "", "vide"],
  ])("%s=%j est refusée : %s", (variable, value, message) => {
    expect(readApiConfig(makeEnv({ [variable]: value }))).toEqual(
      err([`${variable} : ${message}`]),
    );
  });

  it.each([
    ["DATABASE_URL", "postgres://app@127.0.0.1/dezyn"],
    ["BETTER_AUTH_SECRET", "x".repeat(32)],
    ["BETTER_AUTH_URL", "https://api.dezyn.dev"],
    ["SMTP_PORT", "1"],
    ["PORT", "65535"],
  ])("%s=%j est acceptée", (variable, value) => {
    expect(readApiConfig(makeEnv({ [variable]: value })).ok).toBe(true);
  });
});

const makeBindings = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  HYPERDRIVE: { connectionString: "postgresql://app@hyperdrive.local:5432/dezyn" },
  BETTER_AUTH_SECRET: "secret-de-test-de-32-caracteres-au-moins",
  BETTER_AUTH_URL: "https://api.dezyn.dev",
  WEB_URL: "https://dezyn.dev",
  ...overrides,
});

describe("le Worker lit sa configuration dans ses bindings", () => {
  it("des bindings complets donnent la configuration, base comprise par Hyperdrive", () => {
    expect(readWorkerConfig(makeBindings())).toEqual(
      ok({
        databaseUrl: "postgresql://app@hyperdrive.local:5432/dezyn",
        authSecret: "secret-de-test-de-32-caracteres-au-moins",
        authSecrets: [],
        baseURL: "https://api.dezyn.dev",
        trustedIpHeader: "cf-connecting-ip",
        webUrl: "https://dezyn.dev",
        serverTiming: false,
      }),
    );
  });

  it("sans Hyperdrive, DATABASE_URL donne la base jointe en direct", () => {
    const { HYPERDRIVE: _, ...withoutHyperdrive } = makeBindings();

    expect(
      readWorkerConfig({
        ...withoutHyperdrive,
        DATABASE_URL: "postgresql://app@ep-preview.neon.tech/dezyn",
      }),
    ).toMatchObject(ok({ databaseUrl: "postgresql://app@ep-preview.neon.tech/dezyn" }));
  });

  it("HYPERDRIVE et DATABASE_URL ensemble sont refusés", () => {
    expect(
      readWorkerConfig(
        makeBindings({ DATABASE_URL: "postgresql://app@ep-preview.neon.tech/dezyn" }),
      ),
    ).toEqual(err(["DATABASE_URL : en double avec HYPERDRIVE"]));
  });

  it("EMAIL_DELIVERY=log journalise les emails au lieu de les envoyer", () => {
    expect(readWorkerConfig(makeBindings({ EMAIL_DELIVERY: "log" }))).toMatchObject(
      ok({ emailDelivery: "log" }),
    );
  });

  it("sans EMAIL_DELIVERY, les emails ne sont pas journalisés à la place d'un envoi", () => {
    const config = readWorkerConfig(makeBindings());

    expect(config.ok && config.value.emailDelivery).toBeUndefined();
  });

  it("sans RESEND_API_KEY, le Worker n'a pas d'envoi d'email", () => {
    const config = readWorkerConfig(makeBindings({ MAIL_FROM: "no-reply@dezyn.dev" }));

    expect(config.ok && config.value.email).toBeUndefined();
  });

  it("RESEND_API_KEY et MAIL_FROM donnent l'envoi d'email et son expéditeur", () => {
    expect(
      readWorkerConfig(
        makeBindings({ RESEND_API_KEY: "re_cle_de_test", MAIL_FROM: "no-reply@dezyn.dev" }),
      ),
    ).toMatchObject(ok({ email: { apiKey: "re_cle_de_test", from: "no-reply@dezyn.dev" } }));
  });

  it.each([
    [{ RESEND_API_KEY: "re_cle_de_test" }, "MAIL_FROM : manquante"],
    [
      { RESEND_API_KEY: "re_cle_de_test", MAIL_FROM: "dezyn" },
      "MAIL_FROM : adresse email attendue",
    ],
    [{ RESEND_API_KEY: "", MAIL_FROM: "no-reply@dezyn.dev" }, "RESEND_API_KEY : vide"],
  ])("%j est refusé : %s", (bindings, message) => {
    expect(readWorkerConfig(makeBindings(bindings))).toEqual(err([message]));
  });

  it("le binding PROJECT_ROOMS donne les salles des projets au Worker", () => {
    const projectRooms = {
      getByName: () => ({ fetch: async () => new Response(), changed: async () => undefined }),
    };

    expect(readWorkerConfig(makeBindings({ PROJECT_ROOMS: projectRooms }))).toMatchObject(
      ok({ projectRooms }),
    );
  });

  it("TRUSTED_IP_HEADER remplace l'en-tête par défaut", () => {
    expect(readWorkerConfig(makeBindings({ TRUSTED_IP_HEADER: "x-forwarded-for" }))).toMatchObject(
      ok({ trustedIpHeader: "x-forwarded-for" }),
    );
  });

  it("chaque binding manquant est nommé, tous en une fois", () => {
    expect(readWorkerConfig({})).toEqual(
      err([
        "BETTER_AUTH_SECRET : manquante",
        "BETTER_AUTH_URL : manquante",
        "WEB_URL : manquante",
        "HYPERDRIVE : manquante, comme DATABASE_URL",
      ]),
    );
  });

  it.each([
    ["HYPERDRIVE", {}, "manquante"],
    ["HYPERDRIVE", "postgresql://app@hyperdrive.local:5432/dezyn", "binding Hyperdrive attendu"],
    ["BETTER_AUTH_SECRET", "x".repeat(31), "32 caractères au moins"],
    ["BETTER_AUTH_URL", "127.0.0.1:3000", "URL http(s) attendue"],
    ["WEB_URL", "ftp://dezyn.dev", "URL http(s) attendue"],
    ["TRUSTED_IP_HEADER", "", "vide"],
    ["EMAIL_DELIVERY", "smtp", "seule la valeur log est admise"],
    ["PROJECT_ROOMS", "dezyn-realtime", "binding Durable Object attendu"],
    ["PROJECT_ROOMS", null, "binding Durable Object attendu"],
    ["PROJECT_ROOMS", {}, "binding Durable Object attendu"],
    ["PROJECT_ROOMS", { getByName: "dezyn-realtime" }, "binding Durable Object attendu"],
  ])("%s=%j est refusé : %s", (binding, value, message) => {
    expect(readWorkerConfig(makeBindings({ [binding]: value }))).toEqual(
      err([`${binding} : ${message}`]),
    );
  });
});

const SECOND_SECRET = "deuxieme-secret-de-32-caracteres-au-moins";
const TENTH_SECRET = "dixieme-secret-de-32-caracteres-au-moins";

describe.each([
  ["l'API", (secrets: Readonly<Record<string, string>>) => readApiConfig(makeEnv(secrets))],
  [
    "le Worker",
    (secrets: Readonly<Record<string, string>>) => readWorkerConfig(makeBindings(secrets)),
  ],
])("%s lit les versions du secret d'authentification", (_, readConfig) => {
  it("les versions sont rangées de la plus récente à la plus ancienne, en ordre numérique", () => {
    expect(
      readConfig({ BETTER_AUTH_SECRET_2: SECOND_SECRET, BETTER_AUTH_SECRET_10: TENTH_SECRET }),
    ).toMatchObject(
      ok({
        authSecrets: [
          { version: 10, value: TENTH_SECRET },
          { version: 2, value: SECOND_SECRET },
        ],
      }),
    );
  });

  it("une version de 32 caractères est acceptée", () => {
    expect(readConfig({ BETTER_AUTH_SECRET_1: "x".repeat(32) })).toMatchObject(
      ok({ authSecrets: [{ version: 1, value: "x".repeat(32) }] }),
    );
  });

  it.each([
    ["BETTER_AUTH_SECRET_2", "x".repeat(31), "32 caractères au moins"],
    ["BETTER_AUTH_SECRET_X", SECOND_SECRET, "numéro de version entier et positif attendu"],
    ["BETTER_AUTH_SECRET_0", SECOND_SECRET, "numéro de version entier et positif attendu"],
    ["BETTER_AUTH_SECRET_02", SECOND_SECRET, "numéro de version entier et positif attendu"],
    ["BETTER_AUTH_SECRET_2a", SECOND_SECRET, "numéro de version entier et positif attendu"],
    ["BETTER_AUTH_SECRET_", SECOND_SECRET, "numéro de version entier et positif attendu"],
  ])("%s=%j est refusée : %s", (variable, value, message) => {
    expect(readConfig({ [variable]: value })).toEqual(err([`${variable} : ${message}`]));
  });

  it("une erreur de version s'ajoute aux autres erreurs de configuration", () => {
    expect(
      readConfig({ BETTER_AUTH_URL: "127.0.0.1:3000", BETTER_AUTH_SECRET_2: "court" }),
    ).toEqual(
      err([
        "BETTER_AUTH_URL : URL http(s) attendue",
        "BETTER_AUTH_SECRET_2 : 32 caractères au moins",
      ]),
    );
  });
});

describe.each([
  ["l'API", (timing: Readonly<Record<string, string>>) => readApiConfig(makeEnv(timing))],
  [
    "le Worker",
    (timing: Readonly<Record<string, string>>) => readWorkerConfig(makeBindings(timing)),
  ],
])("%s n'envoie Server-Timing que sur réglage explicite", (_, readConfig) => {
  it("sans SERVER_TIMING, les réponses ne portent pas Server-Timing", () => {
    expect(readConfig({})).toMatchObject(ok({ serverTiming: false }));
  });

  it("SERVER_TIMING=true fait porter Server-Timing aux réponses", () => {
    expect(readConfig({ SERVER_TIMING: "true" })).toMatchObject(ok({ serverTiming: true }));
  });

  it("SERVER_TIMING=false ne fait pas porter Server-Timing aux réponses", () => {
    expect(readConfig({ SERVER_TIMING: "false" })).toMatchObject(ok({ serverTiming: false }));
  });

  it.each(["", "1", "oui", "TRUE", "on"])("SERVER_TIMING=%j est refusée", (value) => {
    expect(readConfig({ SERVER_TIMING: value })).toEqual(
      err(["SERVER_TIMING : true ou false attendu"]),
    );
  });
});

const POLAR = {
  POLAR_ACCESS_TOKEN: "jeton-polar-de-test",
  POLAR_WEBHOOK_SECRET: "secret-de-webhook-de-test",
  POLAR_TEAM_PRODUCT_ID: "5c4b3a29-1807-4f6e-9d5c-4b3a29180706",
  POLAR_SERVER: "sandbox",
};

describe.each([
  ["l'API", (polar: Readonly<Record<string, string>>) => readApiConfig(makeEnv(polar))],
  ["le Worker", (polar: Readonly<Record<string, string>>) => readWorkerConfig(makeBindings(polar))],
])("%s lit la configuration de Polar (ADR 0050 §1)", (_, readConfig) => {
  it("les quatre variables donnent la configuration de Polar", () => {
    expect(readConfig(POLAR)).toMatchObject(
      ok({
        polar: {
          accessToken: "jeton-polar-de-test",
          webhookSecret: "secret-de-webhook-de-test",
          teamProductId: "5c4b3a29-1807-4f6e-9d5c-4b3a29180706",
          server: "sandbox",
        },
      }),
    );
  });

  it("POLAR_SERVER=production vise la production de Polar", () => {
    expect(readConfig({ ...POLAR, POLAR_SERVER: "production" })).toMatchObject(
      ok({ polar: { server: "production" } }),
    );
  });

  it("sans aucune variable, ou avec des variables vides, l'API tourne sans Polar", () => {
    const withoutPolar = readConfig({});
    const empty = readConfig({
      POLAR_ACCESS_TOKEN: "",
      POLAR_WEBHOOK_SECRET: "",
      POLAR_TEAM_PRODUCT_ID: "",
      POLAR_SERVER: "",
    });

    expect(withoutPolar.ok && "polar" in withoutPolar.value).toBe(false);
    expect(withoutPolar.ok).toBe(true);
    expect(empty).toEqual(withoutPolar);
  });

  it("une configuration incomplète nomme chaque variable manquante", () => {
    expect(readConfig({ POLAR_ACCESS_TOKEN: "jeton-polar-de-test", POLAR_SERVER: "" })).toEqual(
      err([
        "POLAR_WEBHOOK_SECRET : manquante",
        "POLAR_TEAM_PRODUCT_ID : manquante",
        "POLAR_SERVER : manquante",
      ]),
    );
  });

  it.each([
    ["POLAR_SERVER", "staging", "sandbox ou production attendu"],
    ["POLAR_TEAM_PRODUCT_ID", "produit-team", "UUID attendu"],
  ])("%s=%j est refusée : %s", (variable, value, message) => {
    expect(readConfig({ ...POLAR, [variable]: value })).toEqual(err([`${variable} : ${message}`]));
  });

  it("une erreur de Polar s'ajoute aux autres erreurs de configuration", () => {
    expect(
      readConfig({ ...POLAR, BETTER_AUTH_URL: "127.0.0.1:3000", POLAR_SERVER: "staging" }),
    ).toEqual(
      err([
        "BETTER_AUTH_URL : URL http(s) attendue",
        "POLAR_SERVER : sandbox ou production attendu",
      ]),
    );
  });
});

const makePurgeEnv = (overrides: Readonly<Record<string, string | undefined>> = {}) => ({
  DATABASE_URL_HISTORY_MAINTAINER: "postgresql://history_maintainer@127.0.0.1:5432/dezyn",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  MAIL_FROM: "dezyn <no-reply@dezyn.test>",
  ...overrides,
});

describe("la purge lit sa configuration dans l'environnement", () => {
  it("un environnement complet donne la base de history_maintainer et le SMTP", () => {
    expect(readPurgeConfig(makePurgeEnv())).toEqual(
      ok({
        databaseUrl: "postgresql://history_maintainer@127.0.0.1:5432/dezyn",
        smtp: { host: "127.0.0.1", port: 1025, from: "dezyn <no-reply@dezyn.test>" },
      }),
    );
  });

  it("chaque variable manquante est nommée, toutes en une fois", () => {
    expect(readPurgeConfig({})).toEqual(
      err([
        "DATABASE_URL_HISTORY_MAINTAINER : manquante",
        "SMTP_HOST : manquante",
        "SMTP_PORT : manquante",
        "MAIL_FROM : manquante",
      ]),
    );
  });

  it.each(["abc", "", "0", "65536"])("refuse le port SMTP %j", (port) => {
    expect(readPurgeConfig(makePurgeEnv({ SMTP_PORT: port }))).toEqual(
      err(["SMTP_PORT : port entre 1 et 65535 attendu"]),
    );
  });

  it("refuse une base qui n'est pas en postgresql://", () => {
    expect(
      readPurgeConfig(makePurgeEnv({ DATABASE_URL_HISTORY_MAINTAINER: "http://127.0.0.1/dezyn" })),
    ).toEqual(err(["DATABASE_URL_HISTORY_MAINTAINER : URL postgresql:// attendue"]));
  });
});

const PURGE_HYPERDRIVE = {
  HYPERDRIVE: { connectionString: "postgresql://history_maintainer@127.0.0.1:5432/dezyn" },
};

describe("le Worker de purge lit sa configuration dans ses bindings", () => {
  it("avec une clé Resend et un expéditeur, envoie les emails par Resend", () => {
    expect(
      readPurgeWorkerConfig({
        ...PURGE_HYPERDRIVE,
        RESEND_API_KEY: "re_cle",
        MAIL_FROM: "no-reply@dezyn.dev",
      }),
    ).toEqual(
      ok({
        databaseUrl: "postgresql://history_maintainer@127.0.0.1:5432/dezyn",
        email: { apiKey: "re_cle", from: "no-reply@dezyn.dev" },
      }),
    );
  });

  it("sans clé Resend, n'a pas de moyen d'envoi", () => {
    expect(readPurgeWorkerConfig({ ...PURGE_HYPERDRIVE, MAIL_FROM: "no-reply@dezyn.dev" })).toEqual(
      ok({ databaseUrl: "postgresql://history_maintainer@127.0.0.1:5432/dezyn" }),
    );
  });

  it("EMAIL_DELIVERY=log journalise les emails au lieu de les envoyer", () => {
    expect(readPurgeWorkerConfig({ ...PURGE_HYPERDRIVE, EMAIL_DELIVERY: "log" })).toEqual(
      ok({
        databaseUrl: "postgresql://history_maintainer@127.0.0.1:5432/dezyn",
        emailDelivery: "log",
      }),
    );
  });

  it("une clé Resend sans expéditeur nomme MAIL_FROM", () => {
    expect(readPurgeWorkerConfig({ ...PURGE_HYPERDRIVE, RESEND_API_KEY: "re_cle" })).toEqual(
      err(["MAIL_FROM : manquante"]),
    );
  });
});
