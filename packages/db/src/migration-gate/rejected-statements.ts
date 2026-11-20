const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

type Scan = {
  readonly quote: string | undefined;
  readonly comment: boolean;
  readonly skip: number;
  readonly current: string;
  readonly done: readonly string[];
};

const QUOTES = ["$$", "'", '"'];

const append = (scan: Scan, text: string, quote: string | undefined): Scan => ({
  ...scan,
  quote,
  skip: text.length - 1,
  current: scan.current + text,
});

const scanCharacter = (scan: Scan, chunk: string, index: number): Scan => {
  if (scan.skip > 0) return { ...scan, skip: scan.skip - 1 };
  const character = chunk.charAt(index);
  if (scan.comment) return character === "\n" ? { ...scan, comment: false } : scan;
  if (scan.quote !== undefined) {
    return chunk.startsWith(scan.quote, index)
      ? append(scan, scan.quote, undefined)
      : append(scan, character, scan.quote);
  }
  if (chunk.startsWith("--", index)) return { ...scan, comment: true };
  if (character === ";") return { ...scan, current: "", done: [...scan.done, scan.current] };
  const quote = QUOTES.find((opening) => chunk.startsWith(opening, index));
  return append(scan, quote ?? character, quote);
};

const splitChunk = (chunk: string): readonly string[] => {
  const scan = chunk
    .split("")
    .reduce<Scan>((state, _character, index) => scanCharacter(state, chunk, index), {
      quote: undefined,
      comment: false,
      skip: 0,
      current: "",
      done: [],
    });
  return [...scan.done, scan.current];
};

const statements = (sql: string): readonly string[] =>
  sql
    .split(STATEMENT_BREAKPOINT)
    .flatMap(splitChunk)
    .map((statement) => statement.replaceAll(/\s+/g, " ").trim())
    .filter((statement) => statement !== "");

const ADDITIVE = [
  /^CREATE TABLE\b/i,
  /^CREATE (UNIQUE )?INDEX\b/i,
  /^CREATE TYPE\b/i,
  /^CREATE SCHEMA\b/i,
  /^GRANT\b/i,
];

const CREATE_TABLE = /^CREATE TABLE (?<table>[^ (]+)/i;
const ALTER_TABLE = /^ALTER TABLE (?<table>[^ ]+)/i;
const ADD_COLUMN = /^ALTER TABLE [^ ]+ ADD COLUMN (?<definition>.+)/i;

const tableName = (qualified: string): string =>
  qualified.replace(/^"?public"?\./i, "").replaceAll('"', "");

const tableOf = (statement: string, pattern: RegExp): string | undefined => {
  const table = pattern.exec(statement)?.groups?.table;
  return table === undefined ? undefined : tableName(table);
};

const hasTopLevelComma = (text: string): boolean =>
  text.split("").reduce<{ readonly depth: number; readonly found: boolean }>(
    (state, character) => ({
      depth: state.depth + (character === "(" ? 1 : character === ")" ? -1 : 0),
      found: state.found || (character === "," && state.depth === 0),
    }),
    { depth: 0, found: false },
  ).found;

const withoutQuotedText = (text: string): string => text.replaceAll(/'[^']*'|"[^"]*"/g, "''");

const isSafeColumnAddition = (statement: string): boolean => {
  const quoted = ADD_COLUMN.exec(statement)?.groups?.definition;
  if (quoted === undefined) return false;
  const definition = withoutQuotedText(quoted);
  if (hasTopLevelComma(definition)) return false;
  return !/\bNOT NULL\b/i.test(definition) || /\bDEFAULT\b/i.test(definition);
};

const altersCreatedTable = (statement: string, createdTables: ReadonlySet<string>): boolean => {
  const table = tableOf(statement, ALTER_TABLE);
  return table !== undefined && createdTables.has(table);
};

const isAdditive = (statement: string, createdTables: ReadonlySet<string>): boolean =>
  ADDITIVE.some((pattern) => pattern.test(statement)) ||
  isSafeColumnAddition(statement) ||
  altersCreatedTable(statement, createdTables);

export const rejectedStatements = (sql: string): readonly string[] => {
  const all = statements(sql);
  const createdTables = new Set(all.flatMap((statement) => tableOf(statement, CREATE_TABLE) ?? []));
  return all.filter((statement) => !isAdditive(statement, createdTables));
};
