type Fetch = (request: Request) => Promise<Response>;

const PREVIEW_HOST = /^pr-([1-9]\d*)-(api-)?preview\.dezyn\.dev$/;

type Env = { readonly WORKERS_SUBDOMAIN?: unknown };

const workersSubdomainOf = ({ WORKERS_SUBDOMAIN: subdomain }: Env): string | undefined =>
  typeof subdomain === "string" && subdomain !== "" ? subdomain : undefined;

const upstreamOf = (url: URL, workersSubdomain: string): URL | undefined => {
  const preview = PREVIEW_HOST.exec(url.hostname);
  if (preview === null) {
    return undefined;
  }
  const worker = preview[2] === undefined ? "dezyn-web-preview" : "dezyn-api-preview";
  return new URL(
    `${url.pathname}${url.search}`,
    `https://pr-${preview[1]}-${worker}.${workersSubdomain}.workers.dev`,
  );
};

export const createPreviewRouter = ({ fetch }: { readonly fetch: Fetch }) => ({
  fetch: async (request: Request, env: Env): Promise<Response> => {
    const workersSubdomain = workersSubdomainOf(env);
    if (workersSubdomain === undefined) {
      return new Response("Preview router misconfigured", { status: 500 });
    }
    const upstream = upstreamOf(new URL(request.url), workersSubdomain);
    if (upstream === undefined) {
      return new Response("No preview on this host", { status: 404 });
    }
    const headers = new Headers([...request.headers].filter(([name]) => name !== "host"));
    return fetch(new Request(new Request(upstream, request), { headers, redirect: "manual" }));
  },
});
