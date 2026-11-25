import { serve, type ServerType } from "@hono/node-server";

import { type App, BASE_URL, callMcp } from "#testing/authorization-flow.ts";

const closeServer = (server: ServerType) =>
  new Promise<void>((done, fail) => {
    server.close((error) => (error ? fail(error) : done()));
  });

export const exposeOverHttp = async (
  app: App,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = await new Promise<ServerType>((listening) => {
    const started: ServerType = serve(
      {
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const { pathname, search } = new URL(request.url);
          return app.request(`${BASE_URL}${pathname}${search}`, {
            method: request.method,
            headers: request.headers,
            ...(request.method === "GET" || request.method === "HEAD"
              ? {}
              : { body: await request.arrayBuffer() }),
          });
        },
      },
      () => listening(started),
    );
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => closeServer(server) };
};

export const recipePromptOf = async (
  app: App,
  { accessToken, recipe, projectId }: { accessToken: string; recipe: string; projectId: string },
): Promise<string> => {
  const response = await callMcp(app, {
    token: accessToken,
    method: "prompts/get",
    params: { name: recipe, arguments: { projectId } },
  });
  const reply = await response.json();
  const texts: readonly string[] = (reply.result?.messages ?? []).map(
    (message: { content: { text: string } }) => message.content.text,
  );
  if (texts.length === 0) {
    throw new Error(`prompts/get ${recipe} : ${JSON.stringify(reply)}`);
  }
  return texts.join("\n\n");
};
