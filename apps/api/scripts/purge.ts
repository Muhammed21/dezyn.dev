import { createPostgresDatabase } from "#db";
import { createJsonLineSink } from "#platform/json-line-sink.ts";

import { runManualPurge } from "../src/manual-purge.ts";

await runManualPurge({
  env: process.env,
  log: createJsonLineSink({
    write: (line) => process.stderr.write(line),
    now: () => new Date(),
  }),
  openDatabase: createPostgresDatabase,
  print: (output) => console.log(output),
});
