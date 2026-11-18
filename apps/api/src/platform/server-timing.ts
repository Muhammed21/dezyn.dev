import { createMiddleware } from "hono/factory";

import type { Database } from "./database.ts";
import type { AppEnv } from "./http.ts";

const milliseconds = (duration: number) => Math.round(duration * 10) / 10;

export const serverTiming = (db: Database) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const startedAt = performance.now();
    const { queries, durationMs } = await db.timeQueries(next);
    const total = performance.now() - startedAt;
    c.header(
      "server-timing",
      `db;dur=${milliseconds(durationMs)};desc="${queries} requetes", total;dur=${milliseconds(total)}`,
    );
  });
