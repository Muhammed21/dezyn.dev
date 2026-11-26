import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { defineConfig } from "vitest/config";

const ROOT_ENV = new URL("../../.env", import.meta.url);

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    env: existsSync(ROOT_ENV) ? parseEnv(readFileSync(ROOT_ENV, "utf8")) : {},
    maxWorkers: 3,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
