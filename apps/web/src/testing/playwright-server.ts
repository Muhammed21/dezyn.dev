import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";

import { z } from "zod";

export const PLAYWRIGHT_SERVER_PORT = 53_300;

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

const startContainer = async () => {
  const core = playwrightCore();
  try {
    return await docker([
      "run",
      "--detach",
      "--rm",
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
    throw new Error("Le conteneur Playwright ne démarre pas. Docker tourne-t-il ?", {
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

const startServer = async () => {
  const container = await startContainer();
  await waitUntilListening(container, Date.now() + STARTUP_TIMEOUT_MS);
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
      await docker(["stop", "--timeout=2", container]);
    }
  };
}
