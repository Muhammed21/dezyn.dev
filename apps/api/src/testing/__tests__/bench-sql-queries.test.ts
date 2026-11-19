import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { benchGroupOf, sqlQueriesOf, writeBenchSqlQueries } from "../bench-sql-queries.ts";

const makeResponse = (serverTiming?: string) =>
  new Response(null, {
    headers: serverTiming === undefined ? {} : { "server-timing": serverTiming },
  });

const makeServerTiming = (queries: number) =>
  `db;dur=3.4;desc="${queries} requetes", total;dur=8.1`;

describe("requêtes SQL d'une itération de bench, lues dans Server-Timing", () => {
  it("compte les requêtes SQL d'un appel", () => {
    expect(sqlQueriesOf([makeResponse(makeServerTiming(7))])).toEqual({ queries: 7, calls: 1 });
  });

  it("additionne les requêtes SQL des appels enchaînés et les compte", () => {
    expect(
      sqlQueriesOf([
        makeResponse(makeServerTiming(12)),
        makeResponse(makeServerTiming(3)),
        makeResponse(makeServerTiming(25)),
      ]),
    ).toEqual({ queries: 40, calls: 3 });
  });

  it("lit une réponse sans accès à la base", () => {
    expect(sqlQueriesOf([makeResponse('db;dur=0;desc="0 requetes", total;dur=0.2')])).toEqual({
      queries: 0,
      calls: 1,
    });
  });

  it("refuse une réponse sans Server-Timing, que le bench ne peut pas compter", () => {
    expect(() => sqlQueriesOf([makeResponse(makeServerTiming(7)), makeResponse()])).toThrow(
      "Réponse sans requêtes SQL dans Server-Timing : null",
    );
  });

  it("refuse un Server-Timing sans nombre de requêtes", () => {
    expect(() => sqlQueriesOf([makeResponse("total;dur=8.1")])).toThrow(
      "Réponse sans requêtes SQL dans Server-Timing : total;dur=8.1",
    );
  });
});

describe("groupe vitest d'un bench, celui de son rapport --outputJson", () => {
  it("nomme le fichier puis le describe", () => {
    expect(
      benchGroupOf({
        file: { name: "bench/mcp.bench.ts" },
        suite: { name: "/v1/mcp sur un projet de 130 tokens" },
      }),
    ).toBe("bench/mcp.bench.ts > /v1/mcp sur un projet de 130 tokens");
  });

  it("nomme chaque describe imbriqué, du plus externe au plus interne", () => {
    expect(
      benchGroupOf({
        file: { name: "bench/mcp.bench.ts" },
        suite: { name: "lecture", suite: { name: "/v1/mcp" } },
      }),
    ).toBe("bench/mcp.bench.ts > /v1/mcp > lecture");
  });
});

describe("relevé des requêtes SQL d'un bench pour le commentaire perf-pr", () => {
  it("écrit les requêtes du bench sous son groupe vitest et son nom", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-sql-queries-"));

    writeBenchSqlQueries({
      dir,
      group: "bench/mcp.bench.ts > /v1/mcp sur un projet de 130 tokens",
      name: "read_tokens",
      sqlQueries: { queries: 7, calls: 1 },
    });

    const files = readdirSync(join(dir, "bench-sql-queries"));
    expect(files).toHaveLength(1);
    expect(
      JSON.parse(readFileSync(join(dir, "bench-sql-queries", files[0] ?? ""), "utf8")),
    ).toEqual({
      benchmarks: [
        {
          group: "bench/mcp.bench.ts > /v1/mcp sur un projet de 130 tokens",
          name: "read_tokens",
          queries: 7,
          calls: 1,
        },
      ],
    });
  });

  it("garde un fichier par bench, réécrit à chaque passage", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-sql-queries-"));
    const group = "bench/mcp.bench.ts > /v1/mcp sur un projet de 130 tokens";

    writeBenchSqlQueries({ dir, group, name: "read_tokens", sqlQueries: { queries: 7, calls: 1 } });
    writeBenchSqlQueries({
      dir,
      group,
      name: "write_tokens",
      sqlQueries: { queries: 9, calls: 1 },
    });
    writeBenchSqlQueries({ dir, group, name: "read_tokens", sqlQueries: { queries: 6, calls: 1 } });

    const recorded = readdirSync(join(dir, "bench-sql-queries"))
      .map((file) => JSON.parse(readFileSync(join(dir, "bench-sql-queries", file), "utf8")))
      .flatMap(({ benchmarks }: { benchmarks: readonly { name: string; queries: number }[] }) =>
        benchmarks.map(({ name, queries }) => ({ name, queries })),
      )
      .toSorted((left, right) => left.name.localeCompare(right.name));
    expect(recorded).toEqual([
      { name: "read_tokens", queries: 6 },
      { name: "write_tokens", queries: 9 },
    ]);
  });
});
