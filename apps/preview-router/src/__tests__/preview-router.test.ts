import { describe, expect, it } from "vitest";

import { createPreviewRouter } from "../preview-router.ts";

const WORKERS_SUBDOMAIN = "dezyn-team";

const recordingUpstream = (response: () => Response = () => new Response("upstream")) => {
  const relayed: Request[] = [];
  return {
    relayed,
    fetch: async (request: Request): Promise<Response> => {
      relayed.push(request);
      return response();
    },
  };
};

const route = async ({
  request,
  upstream = recordingUpstream(),
  env = { WORKERS_SUBDOMAIN },
}: {
  readonly request: Request;
  readonly upstream?: ReturnType<typeof recordingUpstream>;
  readonly env?: Parameters<ReturnType<typeof createPreviewRouter>["fetch"]>[1];
}) => {
  const response = await createPreviewRouter({ fetch: upstream.fetch }).fetch(request, env);
  return { response, relayed: upstream.relayed };
};

describe("le routeur des previews", () => {
  it("relaie l'API de preview d'une PR vers l'alias de sa version", async () => {
    const { relayed } = await route({
      request: new Request("https://pr-12-api-preview.dezyn.dev/v1/spaces?limit=5"),
    });

    expect(relayed.map((request) => request.url)).toEqual([
      "https://pr-12-dezyn-api-preview.dezyn-team.workers.dev/v1/spaces?limit=5",
    ]);
  });

  it("relaie l'app web de preview d'une PR vers l'alias de sa version", async () => {
    const { relayed } = await route({
      request: new Request("https://pr-7-preview.dezyn.dev/espaces/abc"),
    });

    expect(relayed.map((request) => request.url)).toEqual([
      "https://pr-7-dezyn-web-preview.dezyn-team.workers.dev/espaces/abc",
    ]);
  });

  it("relaie la méthode, les en-têtes et le corps de la requête", async () => {
    const { relayed } = await route({
      request: new Request("https://pr-12-api-preview.dezyn.dev/auth/sign-in/email", {
        method: "POST",
        headers: {
          cookie: "session=abc",
          origin: "https://pr-12-preview.dezyn.dev",
          "content-type": "application/json",
        },
        body: '{"email":"ada@example.com"}',
      }),
    });

    const [request] = relayed;
    expect({
      method: request?.method,
      cookie: request?.headers.get("cookie"),
      origin: request?.headers.get("origin"),
      contentType: request?.headers.get("content-type"),
      body: await request?.text(),
    }).toEqual({
      method: "POST",
      cookie: "session=abc",
      origin: "https://pr-12-preview.dezyn.dev",
      contentType: "application/json",
      body: '{"email":"ada@example.com"}',
    });
  });

  it("ne transmet pas l'hôte de preview à l'alias", async () => {
    const { relayed } = await route({
      request: new Request("https://pr-12-api-preview.dezyn.dev/health", {
        headers: { host: "pr-12-api-preview.dezyn.dev" },
      }),
    });

    expect(relayed[0]?.headers.has("host")).toBe(false);
  });

  it("rend la réponse de l'alias telle quelle, cookies compris", async () => {
    const upstream = recordingUpstream(
      () =>
        new Response('{"ok":true}', {
          status: 201,
          headers: { "set-cookie": "session=xyz; HttpOnly", "content-type": "application/json" },
        }),
    );

    const { response } = await route({
      request: new Request("https://pr-12-api-preview.dezyn.dev/auth/sign-up/email", {
        method: "POST",
      }),
      upstream,
    });

    expect({
      status: response.status,
      cookie: response.headers.get("set-cookie"),
      body: await response.text(),
    }).toEqual({ status: 201, cookie: "session=xyz; HttpOnly", body: '{"ok":true}' });
  });

  it("laisse le navigateur suivre les redirections", async () => {
    const upstream = recordingUpstream(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://pr-12-preview.dezyn.dev/espaces" },
        }),
    );

    const { response, relayed } = await route({
      request: new Request("https://pr-12-api-preview.dezyn.dev/auth/callback"),
      upstream,
    });

    expect({
      redirect: relayed[0]?.redirect,
      status: response.status,
      location: response.headers.get("location"),
    }).toEqual({
      redirect: "manual",
      status: 302,
      location: "https://pr-12-preview.dezyn.dev/espaces",
    });
  });

  it.each([
    "api.dezyn.dev",
    "app.dezyn.dev",
    "dezyn.dev",
    "pr-12-other-preview.dezyn.dev",
    "pr-abc-preview.dezyn.dev",
    "pr-0-preview.dezyn.dev",
    "pr-012-preview.dezyn.dev",
    "pr--preview.dezyn.dev",
    "xpr-12-preview.dezyn.dev",
    "pr-12-preview.dezyn.dev.example.com",
    "pr-12-preview.example.com",
    "pr-12-api-previewxdezyn.dev",
  ])("répond 404 à l'hôte %s, qui n'est la preview d'aucune PR", async (host) => {
    const { response, relayed } = await route({ request: new Request(`https://${host}/health`) });

    expect({
      status: response.status,
      body: await response.text(),
      relayed: relayed.length,
    }).toEqual({ status: 404, body: "No preview on this host", relayed: 0 });
  });

  it.each([
    ["absent", {}],
    ["vide", { WORKERS_SUBDOMAIN: "" }],
    ["qui n'est pas un texte", { WORKERS_SUBDOMAIN: 12 }],
  ])("répond 500 sans relayer quand le sous-domaine workers.dev est %s", async (_, env) => {
    const { response, relayed } = await route({
      request: new Request("https://pr-12-api-preview.dezyn.dev/health"),
      env,
    });

    expect({
      status: response.status,
      body: await response.text(),
      relayed: relayed.length,
    }).toEqual({ status: 500, body: "Preview router misconfigured", relayed: 0 });
  });
});
