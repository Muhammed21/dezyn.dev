import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { PLAYWRIGHT_SERVER_PORT } from "./src/testing/playwright-server.ts";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "visual",
    include: ["src/**/*.visual.test.tsx"],
    globalSetup: ["./src/testing/playwright-server.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        connectOptions: {
          wsEndpoint: `ws://127.0.0.1:${PLAYWRIGHT_SERVER_PORT}/`,
          exposeNetwork: "<loopback>",
        },
        contextOptions: { reducedMotion: "reduce", deviceScaleFactor: 1 },
      }),
      instances: [{ browser: "chromium" }],
      viewport: { width: 800, height: 600 },
      screenshotFailures: false,
      expect: {
        toMatchScreenshot: {
          screenshotOptions: { animations: "disabled", caret: "hide" },
          resolveScreenshotPath: ({ arg, ext, root, testFileDirectory, testFileName }) =>
            resolve(root, testFileDirectory, "__references__", testFileName, `${arg}${ext}`),
          resolveDiffPath: ({ arg, ext, root, attachmentsDir, testFileDirectory, testFileName }) =>
            resolve(root, attachmentsDir, testFileDirectory, testFileName, `${arg}${ext}`),
        },
      },
    },
  },
});
