import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../path-reminders.ts", import.meta.url));
const PROJECT_DIR = "/home/dev/dezyn";

const makeHookInput = ({ filePath }: { filePath: string }) => ({
  cwd: PROJECT_DIR,
  hook_event_name: "PostToolUse",
  tool_name: "Edit",
  tool_input: { file_path: filePath, old_string: "avant", new_string: "après" },
});

const runHook = (stdin: string) =>
  spawnSync(process.execPath, [SCRIPT, PROJECT_DIR], { input: stdin, encoding: "utf8" });

describe("le hook PostToolUse lancé par Claude Code", () => {
  it("lit l'entrée JSON sur stdin et écrit le rappel sur stdout", () => {
    const result = runHook(
      JSON.stringify(
        makeHookInput({ filePath: `${PROJECT_DIR}/apps/api/src/modules/space/contracts/index.ts` }),
      ),
    );

    expect({ status: result.status, output: JSON.parse(result.stdout) }).toEqual({
      status: 0,
      output: {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: "Types, schémas Zod et fonctions pures seulement (ADR 0020).",
        },
      },
    });
  });

  it("sort sans rien écrire pour un chemin sans règle", () => {
    const result = runHook(
      JSON.stringify(makeHookInput({ filePath: `${PROJECT_DIR}/turbo.json` })),
    );

    expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "" });
  });

  it("sort sans rien écrire quand stdin n'est pas du JSON", () => {
    const result = runHook("pas du json");

    expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "" });
  });
});
