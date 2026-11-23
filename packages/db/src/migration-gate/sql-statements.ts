const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export type Token = {
  readonly kind: "word" | "quoted" | "text" | "comment" | "space" | "symbol";
  readonly text: string;
  readonly closed: boolean;
};

export type Statement = {
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly closed: boolean;
};

const SPACE = /[ \t\n\r\f]+/y;
const LINE_COMMENT = /--[^\n\r]*/y;
const WORD = /[\w$\u0080-\uFFFF]+/y;
const QUOTED = /"(?:[^"]|"")*"/y;
const DOLLAR_QUOTE = /\$(?:[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF]*)?\$/y;
const STANDARD_STRING = /'(?:[^']|'')*'/y;
const ESCAPE_STRING = /'(?:[^'\\]|''|\\[\s\S])*'/y;
const STRING_CONTINUATION = /[ \t\f]*(?:--[^\n\r]*)?[\n\r](?:[ \t\n\r\f]|--[^\n\r]*[\n\r])*(?=')/y;
const VERTICAL_TAB = "\v";
const ESCAPE_PREFIX = /^\d*[Ee]$/;
const COMMENT_MARK = /\/\*|\*\//g;

const matchAt = (pattern: RegExp, chunk: string, index: number): string | undefined => {
  pattern.lastIndex = index;
  return pattern.exec(chunk)?.[0];
};

const token = (kind: Token["kind"], text: string, closed = true): Token => ({ kind, text, closed });

const unterminated = (kind: Token["kind"], chunk: string, index: number): Token =>
  token(kind, chunk.slice(index), false);

const blockCommentEnd = (chunk: string, index: number, depth: number): number => {
  if (depth === 0) return index;
  COMMENT_MARK.lastIndex = index;
  const mark = COMMENT_MARK.exec(chunk);
  if (mark === null) return -1;
  return blockCommentEnd(chunk, mark.index + 2, depth + (mark[0] === "/*" ? 1 : -1));
};

const stringEnd = (chunk: string, index: number, body: RegExp): number => {
  const segment = matchAt(body, chunk, index);
  if (segment === undefined) return -1;
  const end = index + segment.length;
  const continuation = matchAt(STRING_CONTINUATION, chunk, end);
  return continuation === undefined ? end : stringEnd(chunk, end + continuation.length, body);
};

const stringToken = (chunk: string, index: number, quoteAt: number, body: RegExp): Token => {
  const end = stringEnd(chunk, quoteAt, body);
  return end === -1 ? unterminated("text", chunk, index) : token("text", chunk.slice(index, end));
};

const dollarToken = (chunk: string, index: number, tag: string): Token => {
  const close = chunk.indexOf(tag, index + tag.length);
  return close === -1
    ? unterminated("text", chunk, index)
    : token("text", chunk.slice(index, close + tag.length));
};

const wordToken = (chunk: string, index: number, word: string): Token => {
  const quoteAt = index + word.length;
  return ESCAPE_PREFIX.test(word) && chunk.charAt(quoteAt) === "'"
    ? stringToken(chunk, index, quoteAt, ESCAPE_STRING)
    : token("word", word);
};

const tokenAt = (chunk: string, index: number): Token => {
  if (chunk.charAt(index) === VERTICAL_TAB) return token("symbol", VERTICAL_TAB, false);
  const space = matchAt(SPACE, chunk, index);
  if (space !== undefined) return token("space", space);
  const lineComment = matchAt(LINE_COMMENT, chunk, index);
  if (lineComment !== undefined) return token("comment", lineComment);
  if (chunk.startsWith("/*", index)) {
    const end = blockCommentEnd(chunk, index + 2, 1);
    return end === -1
      ? unterminated("comment", chunk, index)
      : token("comment", chunk.slice(index, end));
  }
  if (chunk.charAt(index) === "'") return stringToken(chunk, index, index, STANDARD_STRING);
  if (chunk.charAt(index) === '"') {
    const quoted = matchAt(QUOTED, chunk, index);
    return quoted === undefined ? unterminated("quoted", chunk, index) : token("quoted", quoted);
  }
  const tag = matchAt(DOLLAR_QUOTE, chunk, index);
  if (tag !== undefined) return dollarToken(chunk, index, tag);
  const word = matchAt(WORD, chunk, index);
  return word === undefined ? token("symbol", chunk.charAt(index)) : wordToken(chunk, index, word);
};

function* tokensOf(chunk: string): Generator<Token> {
  let index = 0;
  while (index < chunk.length) {
    const next = tokenAt(chunk, index);
    yield next;
    index += next.text.length;
  }
}

const isSignificant = ({ kind, closed }: Token): boolean =>
  kind !== "space" && (kind !== "comment" || !closed);

const statementOf = (tokens: readonly Token[]): Statement => ({
  text: tokens
    .map(({ kind, text, closed }) => (kind === "comment" && closed ? " " : text))
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim(),
  tokens: tokens.filter(isSignificant),
  closed: tokens.every(({ closed }) => closed),
});

const isSeparator = ({ text }: Token): boolean => text === ";";

const splitChunk = (chunk: string): readonly Statement[] => {
  const tokens = [...tokensOf(chunk)];
  const separators = tokens.flatMap((next, index) => (isSeparator(next) ? [index] : []));
  const bounds = [-1, ...separators, tokens.length];
  return bounds
    .slice(0, -1)
    .map((start, index) => statementOf(tokens.slice(start + 1, bounds[index + 1])));
};

export const sqlStatements = (sql: string): readonly Statement[] =>
  sql
    .split(STATEMENT_BREAKPOINT)
    .flatMap(splitChunk)
    .filter(({ text }) => text !== "");
