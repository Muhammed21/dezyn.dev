const TOKEN_TYPES = [
  "color",
  "dimension",
  "typography",
  "shadow",
  "gradient",
  "fontFamily",
  "fontWeight",
  "number",
] as const;

export type TokenType = (typeof TOKEN_TYPES)[number] | "unknown";

export type TokenValue =
  | { readonly kind: "single"; readonly value: unknown }
  | { readonly kind: "by_mode"; readonly values: Readonly<Record<string, unknown>> };

const FIGMA_STATES = ["synced", "diverged", "missing_in_figma", "duplicate_in_figma"] as const;

export type FigmaState = (typeof FIGMA_STATES)[number] | "unknown";

export type FigmaProposal = {
  readonly id: string;
  readonly batchId: string;
  readonly value: TokenValue;
};

export type TokenFigmaState = {
  readonly state: FigmaState;
  readonly declaredAt: Date;
  readonly proposal?: FigmaProposal;
  readonly rejectedValue?: TokenValue;
};

export type Token = {
  readonly id: string;
  readonly name: string;
  readonly type: TokenType;
  readonly value: TokenValue;
  readonly description: string | undefined;
  readonly figma: TokenFigmaState | undefined;
};

export type ProjectTokens = {
  readonly modes: readonly string[];
  readonly tokens: readonly Token[];
};

export type TokensFailure = "unauthenticated" | "not_found" | "unavailable" | "invalid_response";

export const tokenTypeOf = (value: string): TokenType =>
  TOKEN_TYPES.find((type) => type === value) ?? "unknown";

export const figmaStateOf = (value: string): FigmaState =>
  FIGMA_STATES.find((state) => state === value) ?? "unknown";
