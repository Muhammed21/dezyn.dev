import { readFileSync } from "node:fs";

import { pathReminders } from "../src/path-reminders.ts";

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const projectDir = process.argv[2] ?? process.cwd();
const input = parseJson(readFileSync(0, "utf8"));

process.stdout.write(pathReminders({ projectDir, input }));
