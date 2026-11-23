import { type Statement, type Token, sqlStatements } from "./sql-statements.ts";

type Tokens = readonly Token[];
type QualifiedName = { readonly parts: readonly string[]; readonly next: number };

const ADDITIVE_PREFIXES = [
  ["create", "table"],
  ["create", "index"],
  ["create", "unique", "index"],
  ["create", "type"],
];

const ADDITIVE_PRIVILEGES = new Set(["select", "insert", "references", "usage"]);

const folded = (text: string): string =>
  text.replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());

const isKeyword = (token: Token | undefined, keyword: string): boolean =>
  token?.kind === "word" && folded(token.text) === keyword;

const isSymbol = (token: Token | undefined, symbol: string): boolean =>
  token?.kind === "symbol" && token.text === symbol;

const startsWith = (tokens: Tokens, keywords: readonly string[]): boolean =>
  keywords.every((keyword, index) => isKeyword(tokens[index], keyword));

const namePart = (token: Token | undefined): string | undefined => {
  if (token?.kind === "word") return folded(token.text);
  if (token?.kind === "quoted") return token.text.slice(1, -1).replaceAll('""', '"');
  return undefined;
};

const qualifiedName = (tokens: Tokens, start: number): QualifiedName | undefined => {
  const first = namePart(tokens[start]);
  if (first === undefined) return undefined;
  if (!isSymbol(tokens[start + 1], ".")) return { parts: [first], next: start + 1 };
  const rest = qualifiedName(tokens, start + 2);
  return rest === undefined ? undefined : { parts: [first, ...rest.parts], next: rest.next };
};

const tableKey = ({ parts }: QualifiedName): string =>
  JSON.stringify(parts.length === 2 && parts[0] === "public" ? parts.slice(1) : parts);

const depthChange = (token: Token): number => {
  if (isSymbol(token, "(")) return 1;
  return isSymbol(token, ")") ? -1 : 0;
};

const topLevelGroups = (tokens: Tokens): readonly Tokens[] =>
  tokens.reduce<{ readonly depth: number; readonly groups: readonly Tokens[] }>(
    ({ depth, groups }, token) => {
      if (depth === 0 && isSymbol(token, ",")) return { depth, groups: [...groups, []] };
      const last = groups.at(-1) ?? [];
      return {
        depth: depth + depthChange(token),
        groups: [...groups.slice(0, -1), [...last, token]],
      };
    },
    { depth: 0, groups: [[]] },
  ).groups;

const alteredTable = (tokens: Tokens): QualifiedName | undefined =>
  startsWith(tokens, ["alter", "table"]) ? qualifiedName(tokens, 2) : undefined;

const createdTable = (tokens: Tokens): string[] => {
  if (!startsWith(tokens, ["create", "table"])) return [];
  const name = qualifiedName(tokens, 2);
  return name !== undefined && isSymbol(tokens[name.next], "(") ? [tableKey(name)] : [];
};

const isSafeColumnAddition = (tokens: Tokens): boolean => {
  const table = alteredTable(tokens);
  if (table === undefined) return false;
  if (!isKeyword(tokens[table.next], "add") || !isKeyword(tokens[table.next + 1], "column")) {
    return false;
  }
  const definition = tokens.slice(table.next + 2);
  if (definition.length === 0 || topLevelGroups(definition).length > 1) return false;
  const notNull = definition.some(
    (token, index) => isKeyword(token, "not") && isKeyword(definition[index + 1], "null"),
  );
  return !notNull || definition.some((token) => isKeyword(token, "default"));
};

const isColumnList = (tokens: Tokens): boolean =>
  isSymbol(tokens[0], "(") &&
  isSymbol(tokens.at(-1), ")") &&
  tokens.slice(1, -1).every((token) => namePart(token) !== undefined || isSymbol(token, ","));

const isAdditivePrivilege = ([privilege, ...columns]: Tokens): boolean =>
  privilege?.kind === "word" &&
  ADDITIVE_PRIVILEGES.has(folded(privilege.text)) &&
  (columns.length === 0 || isColumnList(columns));

const isAdditiveGrant = (tokens: Tokens): boolean => {
  if (!isKeyword(tokens[0], "grant")) return false;
  const on = tokens.findIndex((token) => isKeyword(token, "on"));
  if (on === -1) return false;
  return (
    topLevelGroups(tokens.slice(1, on)).every(isAdditivePrivilege) &&
    !tokens.some((token) => isKeyword(token, "with"))
  );
};

const isEmptySchemaCreation = (tokens: Tokens): boolean => {
  if (!startsWith(tokens, ["create", "schema"])) return false;
  const name = startsWith(tokens.slice(2), ["if", "not", "exists"]) ? 5 : 2;
  return tokens.length === name + 1 && namePart(tokens[name]) !== undefined;
};

const altersCreatedTable = (tokens: Tokens, createdTables: ReadonlySet<string>): boolean => {
  const table = alteredTable(tokens);
  return table !== undefined && createdTables.has(tableKey(table));
};

const isAdditive = ({ tokens, closed }: Statement, createdTables: ReadonlySet<string>): boolean =>
  closed &&
  (ADDITIVE_PREFIXES.some((prefix) => startsWith(tokens, prefix)) ||
    isEmptySchemaCreation(tokens) ||
    isAdditiveGrant(tokens) ||
    isSafeColumnAddition(tokens) ||
    altersCreatedTable(tokens, createdTables));

export const rejectedStatements = (sql: string): readonly string[] => {
  const all = sqlStatements(sql);
  const createdTables = new Set(all.flatMap(({ tokens }) => createdTable(tokens)));
  return all.filter((statement) => !isAdditive(statement, createdTables)).map(({ text }) => text);
};
