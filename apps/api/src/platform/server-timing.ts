import { createMiddleware } from "hono/factory";

import type { Database } from "./database.ts";
import type { AppEnv } from "./http.ts";

const milliseconds = (duration: number) => Math.round(duration * 10) / 10;

export const serverTiming = ({
  db,
  untimedPaths,
}: {
  readonly db: Database;
  readonly untimedPaths: readonly string[];
}) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (untimedPaths.some((path) => c.req.path.startsWith(path))) {
      await next();
      return;
    }
    const startedAt = performance.now();
    const { queries, durationMs } = await db.timeQueries(next);
    const total = performance.now() - startedAt;
    c.header(
      "server-timing",
      `db;dur=${milliseconds(durationMs)};desc="${queries} requetes", total;dur=${milliseconds(total)}`,
    );
  });
