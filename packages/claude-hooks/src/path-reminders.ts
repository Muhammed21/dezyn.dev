import { isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

const HookInputSchema = z.object({
  tool_input: z.object({ file_path: z.string() }),
});

const WORKTREE_PREFIX = /^\.claude\/worktrees\/[^/]+\//;

const RULES = [
  {
    pattern: /^apps\/[^/]+\/src\/modules\/[^/]+\/contracts\//,
    reminder: "Types, schémas Zod et fonctions pures seulement (ADR 0020).",
  },
  {
    pattern: /^apps\/web\/src\/platform\//,
    reminder: "Sans React ni TanStack Query (ADR 0044).",
  },
  {
    pattern: /^apps\/web\/src\/modules\/[^/]+\/(?!presentation\/)/,
    reminder: "React seulement dans presentation/ (ADR 0044).",
  },
  {
    pattern: /^packages\/db\/src\/schema\//,
    reminder: "Une migration générée par PR ; additive sauf accord (ADR 0034 §5, ADR 0009).",
  },
  {
    pattern: /^apps\/api\/src\/modules\/[^/]+\/presentation\/[^/]+-routes\.ts$/,
    reminder: "Mettre à jour le contrat dans packages/contracts.",
  },
  {
    pattern: /^(?!docs\/adr\/|\.claude\/).*\.md$/,
    reminder: "Relire contre .claude/rules/documentation.md.",
  },
  {
    pattern: /\/__tests__\//,
    reminder: "Factories make<Chose> et seed<Chose> (.claude/rules/test-fixtures.md).",
  },
];

export const pathReminders = ({
  projectDir,
  input,
}: {
  projectDir: string;
  input: unknown;
}): string => {
  const parsed = HookInputSchema.safeParse(input);
  if (!parsed.success) {
    return "";
  }
  const path = relative(projectDir, resolve(projectDir, parsed.data.tool_input.file_path)).replace(
    WORKTREE_PREFIX,
    "",
  );
  if (path.startsWith("../") || isAbsolute(path)) {
    return "";
  }
  const reminders = RULES.filter(({ pattern }) => pattern.test(path)).map(
    ({ reminder }) => reminder,
  );
  if (reminders.length === 0) {
    return "";
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: reminders.join("\n"),
    },
  });
};
