import { z } from "zod";

import { err, ok, type Result } from "@repo/result";

const InitMessage = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  model: z.string(),
  apiKeySource: z.string(),
  permissionMode: z.string(),
  tools: z.array(z.string()),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string() })),
});

const ContentBlock = z.union([
  z.object({ type: z.literal("tool_use"), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_result"),
    is_error: z.boolean().optional(),
    content: z.unknown(),
  }),
  z.object({ type: z.string() }),
]);

const ConversationMessage = z.object({
  type: z.enum(["assistant", "user"]),
  error: z.string().optional(),
  message: z.object({ content: z.union([z.string(), z.array(ContentBlock)]) }),
});

const ResultMessage = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  num_turns: z.number(),
  total_cost_usd: z.number(),
  result: z.string().optional(),
  errors: z.array(z.string()).optional(),
  api_error_status: z.number().nullish(),
  api_error_type: z.string().nullish(),
});

type InitMessage = z.infer<typeof InitMessage>;
type ConversationMessage = z.infer<typeof ConversationMessage>;
type ResultMessage = z.infer<typeof ResultMessage>;

export type RecipeAgentRun = {
  readonly result: string;
  readonly costUsd: number;
  readonly turns: number;
  readonly toolCalls: readonly string[];
};

export type RecipeAgentFailure = {
  readonly reason: string;
  readonly costUsd: number;
};

export type Session = {
  readonly messages: readonly unknown[];
  readonly thrown: string | undefined;
};

const blocksOf = (message: ConversationMessage) =>
  typeof message.message.content === "string" ? [] : message.message.content;

const TextParts = z.array(z.object({ text: z.string().optional() })).catch([]);

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : TextParts.parse(content)
        .map(({ text }) => text ?? "")
        .join(" ");

const linesOfBlock = (block: z.infer<typeof ContentBlock>): readonly string[] => {
  if ("name" in block) {
    return [`outil : ${block.name} ${JSON.stringify(block.input) ?? ""}`.trimEnd()];
  }
  if ("text" in block) {
    return [`texte : ${block.text}`];
  }
  if ("content" in block && block.is_error === true) {
    return [`erreur d'outil : ${textOf(block.content)}`];
  }
  return [];
};

const initLines = (init: InitMessage): readonly string[] => [
  `init : modèle ${init.model}, clé ${init.apiKeySource}, permissions ${init.permissionMode}`,
  `init : serveurs MCP ${init.mcp_servers.map(({ name, status }) => `${name} (${status})`).join(", ")}`,
  `init : outils ${init.tools.join(", ")}`,
];

const resultLine = (result: ResultMessage): string =>
  `résultat : ${result.subtype}${result.is_error ? " en erreur" : ""}, ${result.num_turns} tours, ${result.total_cost_usd.toFixed(2)} $ : ${result.result ?? (result.errors ?? []).join(" ; ")}`;

export const linesOfMessage = (message: unknown): readonly string[] => {
  const init = InitMessage.safeParse(message);
  if (init.success) {
    return initLines(init.data);
  }
  const conversation = ConversationMessage.safeParse(message);
  if (conversation.success) {
    return blocksOf(conversation.data).flatMap(linesOfBlock);
  }
  const result = ResultMessage.safeParse(message);
  return result.success ? [resultLine(result.data)] : [];
};

const parsedAll = <T>(schema: z.ZodType<T>, messages: readonly unknown[]): readonly T[] =>
  messages.flatMap((message) => {
    const parsed = schema.safeParse(message);
    return parsed.success ? [parsed.data] : [];
  });

const apiErrorOf = (result: ResultMessage): string =>
  [result.api_error_status, result.api_error_type]
    .filter((part) => part !== undefined && part !== null)
    .join(" ");

const resultFailures = (
  result: ResultMessage,
  assistantErrors: readonly string[],
): readonly string[] => {
  if (result.is_error || result.subtype !== "success") {
    const details = [result.subtype, apiErrorOf(result), ...assistantErrors]
      .filter((part) => part !== "")
      .join(", ");
    return [
      `la session de l'agent a échoué (${details}) : ${[result.result, ...(result.errors ?? [])].filter((part) => part !== undefined && part !== "").join(" ; ")}`,
    ];
  }
  return [
    ...(result.num_turns === 0 ? ["aucun tour joué"] : []),
    ...(result.total_cost_usd === 0 ? ["coût nul : l'IA n'a jamais répondu"] : []),
  ];
};

const unreachableServers = (messages: readonly unknown[]): readonly string[] =>
  parsedAll(InitMessage, messages)
    .flatMap(({ mcp_servers }) => mcp_servers)
    .filter(({ status }) => status !== "connected")
    .map(({ name, status }) => `${name} (${status})`);

export const verdictOf = ({
  session,
  requireToolCall,
}: {
  readonly session: Session;
  readonly requireToolCall: boolean;
}): Result<RecipeAgentRun, RecipeAgentFailure> => {
  const results = parsedAll(ResultMessage, session.messages);
  const result = results.at(-1);
  const conversation = parsedAll(ConversationMessage, session.messages);
  const toolCalls = conversation
    .filter(({ type }) => type === "assistant")
    .flatMap(blocksOf)
    .flatMap((block) => ("name" in block && block.name.startsWith("mcp__") ? [block.name] : []));
  const assistantErrors = conversation.flatMap(({ error }) => (error === undefined ? [] : [error]));
  const unreachable = unreachableServers(session.messages);
  const sessionFailures =
    result === undefined
      ? [`la session de l'agent s'est arrêtée sans résultat`]
      : resultFailures(result, assistantErrors);
  const failures = [
    ...sessionFailures,
    ...(session.thrown !== undefined && (result === undefined || sessionFailures.length === 0)
      ? [`erreur du SDK : ${session.thrown}`]
      : []),
    ...(requireToolCall && toolCalls.length === 0 ? ["aucun appel d'outil MCP"] : []),
    ...(unreachable.length > 0 ? [`serveurs MCP non connectés : ${unreachable.join(", ")}`] : []),
  ];
  const costUsd = result?.total_cost_usd ?? 0;
  if (failures.length > 0 || result === undefined) {
    return err({ reason: failures.join(" ; "), costUsd });
  }
  return ok({
    result: result.result ?? "",
    costUsd,
    turns: result.num_turns,
    toolCalls,
  });
};
