import { describe, expect, it } from "vitest";

import { pathReminders } from "../path-reminders.ts";

const PROJECT_DIR = "/home/dev/dezyn";

const makeHookInput = ({ filePath }: { filePath: string }) => ({
  session_id: "abc123",
  cwd: PROJECT_DIR,
  hook_event_name: "PostToolUse",
  tool_name: "Write",
  tool_input: { file_path: filePath, content: "contenu" },
  tool_response: { filePath, type: "create" },
});

const reminderAfterWriting = (relativePath: string) =>
  pathReminders({
    projectDir: PROJECT_DIR,
    input: makeHookInput({ filePath: `${PROJECT_DIR}/${relativePath}` }),
  });

const contextOf = (output: string): unknown => JSON.parse(output);

describe("rappel selon le chemin du fichier écrit", () => {
  it("rappelle l'ADR 0020 pour un fichier sous contracts/", () => {
    expect(
      contextOf(reminderAfterWriting("apps/api/src/modules/token/contracts/index.ts")),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "Types, schémas Zod et fonctions pures seulement (ADR 0020).",
      },
    });
  });

  it.each([
    ["apps/web/src/platform/http-client.ts", "Sans React ni TanStack Query (ADR 0044)."],
    [
      "apps/web/src/modules/token/application/read-tokens.ts",
      "React seulement dans presentation/ (ADR 0044).",
    ],
    [
      "apps/web/src/modules/token/token-module.ts",
      "React seulement dans presentation/ (ADR 0044).",
    ],
    [
      "packages/db/src/schema/token.ts",
      "Une migration générée par PR ; additive sauf accord (ADR 0034 §5, ADR 0009).",
    ],
    [
      "apps/api/src/modules/token/presentation/tokens-routes.ts",
      "Mettre à jour le contrat dans packages/contracts.",
    ],
    ["README.md", "Relire contre .claude/rules/documentation.md."],
    ["docs/spikes/2026-01-01-sujet.md", "Relire contre .claude/rules/documentation.md."],
    [
      "packages/result/src/__tests__/result.test.ts",
      "Factories make<Chose> et seed<Chose> (.claude/rules/test-fixtures.md).",
    ],
  ])("pour %s, rappelle « %s »", (relativePath, reminder) => {
    expect(contextOf(reminderAfterWriting(relativePath))).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: reminder },
    });
  });

  it("met un rappel par ligne quand plusieurs règles s'appliquent", () => {
    expect(
      contextOf(reminderAfterWriting("apps/web/src/modules/token/__tests__/token-module.test.ts")),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: [
          "React seulement dans presentation/ (ADR 0044).",
          "Factories make<Chose> et seed<Chose> (.claude/rules/test-fixtures.md).",
        ].join("\n"),
      },
    });
  });

  it.each([
    [
      "un composant de presentation/ de l'app web",
      "apps/web/src/modules/token/presentation/tokens-page.tsx",
    ],
    [
      "un fichier de presentation/ de l'API qui n'est pas des routes",
      "apps/api/src/modules/token/presentation/read-tokens-tool.ts",
    ],
    ["un ADR", "docs/adr/0020-modules-et-couches.md"],
    ["une consigne sous .claude/", ".claude/rules/documentation.md"],
    ["un fichier hors du projet", "../ailleurs/apps/api/src/modules/token/contracts/index.ts"],
    ["un Markdown hors du projet", "../ailleurs/README.md"],
    ["une consigne .claude/ hors du projet", "../../.claude/plans/x.md"],
    ["un test hors du projet", "../x/__tests__/a.test.ts"],
  ])("ne sort rien pour %s", (_cas, relativePath) => {
    expect(reminderAfterWriting(relativePath)).toBe("");
  });

  it("lit un chemin relatif au projet", () => {
    expect(
      contextOf(
        pathReminders({
          projectDir: PROJECT_DIR,
          input: makeHookInput({ filePath: "packages/db/src/schema/token.ts" }),
        }),
      ),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          "Une migration générée par PR ; additive sauf accord (ADR 0034 §5, ADR 0009).",
      },
    });
  });

  it("lit le chemin d'un fichier écrit dans un worktree du projet depuis la racine du worktree", () => {
    expect(
      contextOf(
        reminderAfterWriting(".claude/worktrees/agent-1/apps/web/src/platform/http-client.ts"),
      ),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "Sans React ni TanStack Query (ADR 0044).",
      },
    });
  });

  it.each([
    "vendor/apps/api/src/modules/token/contracts/index.ts",
    "vendor/apps/web/src/platform/http-client.ts",
    "vendor/apps/web/src/modules/token/application/read-tokens.ts",
    "vendor/packages/db/src/schema/token.ts",
    "vendor/apps/api/src/modules/token/presentation/tokens-routes.ts",
  ])("ne lit une règle que depuis la racine du projet : rien pour %s", (relativePath) => {
    expect(reminderAfterWriting(relativePath)).toBe("");
  });

  it("ne sort rien pour une entrée sans chemin de fichier", () => {
    expect(
      pathReminders({ projectDir: PROJECT_DIR, input: { tool_name: "Write", tool_input: {} } }),
    ).toBe("");
  });

  it("ne sort rien pour un chemin sans règle", () => {
    expect(reminderAfterWriting("apps/api/src/modules/token/domain/token.ts")).toBe("");
  });
});
