import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";

import { z } from "zod";

export const PLAYWRIGHT_SERVER_PORT = 53_300;

const CONTAINER_NAME = "dezyn-visual-playwright";
const CORE_MOUNT = "/opt/playwright-core";
const STARTUP_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;

const run = promisify(execFile);

const Manifest = z.object({ version: z.string() });

const playwrightCore = () => {
  const manifest = createRequire(import.meta.url).resolve("playwright-core/package.json");
  return {
    dir: dirname(manifest),
    version: Manifest.parse(JSON.parse(readFileSync(manifest, "utf8"))).version,
  };
};

const docker = async (args: readonly string[]) => (await run("docker", [...args])).stdout.trim();

const stderrOf = (error: unknown) =>
  error instanceof Error && "stderr" in error && typeof error.stderr === "string"
    ? error.stderr.trim()
    : String(error);

const removeLeftoverContainer = async () => {
  try {
    await docker(["rm", "--force", CONTAINER_NAME]);
  } catch (error) {
    if (!/no such container/i.test(stderrOf(error))) {
      throw new Error(`Docker ne répond pas : ${stderrOf(error)}`, { cause: error });
    }
  }
};

const startContainer = async () => {
  const core = playwrightCore();
  await removeLeftoverContainer();
  try {
    return await docker([
      "run",
      "--detach",
      "--rm",
      `--name=${CONTAINER_NAME}`,
      "--init",
      "--ipc=host",
      "--platform=linux/amd64",
      "--user=pwuser",
      `--publish=127.0.0.1:${PLAYWRIGHT_SERVER_PORT}:${PLAYWRIGHT_SERVER_PORT}`,
      `--volume=${core.dir}:${CORE_MOUNT}:ro`,
      `mcr.microsoft.com/playwright:v${core.version}-noble`,
      "node",
      `${CORE_MOUNT}/cli.js`,
      "run-server",
      `--port=${PLAYWRIGHT_SERVER_PORT}`,
      "--host=0.0.0.0",
    ]);
  } catch (error) {
    throw new Error(`Le conteneur Playwright ne démarre pas : ${stderrOf(error)}`, {
      cause: error,
    });
  }
};

const waitUntilListening = async (container: string, deadline: number): Promise<void> => {
  const { stdout } = await run("docker", ["logs", container]);
  if (stdout.includes("Listening on")) {
    return;
  }
  if (Date.now() > deadline) {
    throw new Error(`Le serveur Playwright du conteneur ${container} n'écoute pas.`);
  }
  await wait(POLL_INTERVAL_MS);
  return waitUntilListening(container, deadline);
};

const stopContainer = (container: string) => docker(["stop", "--timeout=2", container]);

const startServer = async () => {
  const container = await startContainer();
  try {
    await waitUntilListening(container, Date.now() + STARTUP_TIMEOUT_MS);
  } catch (error) {
    await stopContainer(container).catch(() => undefined);
    throw error;
  }
  return container;
};

const servers = new Map<string, Promise<string>>();

const serverOnce = () => {
  const started = servers.get("server") ?? startServer();
  servers.set("server", started);
  return started;
};

export default async function setup() {
  const container = await serverOnce();
  return async () => {
    if (servers.delete("server")) {
      await stopContainer(container);
    }
  };
}
