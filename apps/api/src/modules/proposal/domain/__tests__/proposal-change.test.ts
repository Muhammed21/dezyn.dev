import { describe, expect, it } from "vitest";

import type { TokenDefinition } from "#modules/token/contracts/token-definition.ts";

import { deletionRefusals, plannedChange, remainingCitations } from "../proposal-change.ts";
import type { Proposal } from "../proposal.ts";

type ColorValue = NonNullable<Extract<TokenDefinition, { $type: "color" }>["$value"]>;

const PRIMARY_BLUE = { colorSpace: "srgb", components: [0.2, 0.4, 0.8] } satisfies ColorValue;
const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] } satisfies ColorValue;

const makeToken = (value: ColorValue = PRIMARY_BLUE): TokenDefinition => ({
  name: "couleur.fond",
  $type: "color",
  $value: value,
});

const makeWaiting = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: "proposition-en-attente",
  batchId: "lot",
  name: "couleur.fond",
  kind: "update",
  token: makeToken(NIGHT_BLUE),
  status: "proposed",
  createdAt: new Date("2026-11-26T09:00:00Z"),
  ...overrides,
});

describe("une suppression proposée par l'IA suit les règles de remplacement (ADR 0026 §1, ADR 0013 §6)", () => {
  it("propose la suppression d'un token validé sans proposition en attente", () => {
    expect(
      plannedChange({
        change: { kind: "delete", token: makeToken() },
        validated: makeToken(),
        waiting: undefined,
      }),
    ).toEqual({ token: makeToken(), kind: "delete", replaces: undefined, unchanged: false });
  });

  it("remplace la modification en attente sur le même token", () => {
    const waiting = makeWaiting({ kind: "update" });

    expect(
      plannedChange({
        change: { kind: "delete", token: makeToken() },
        validated: makeToken(),
        waiting,
      }),
    ).toEqual({ token: makeToken(), kind: "delete", replaces: waiting, unchanged: false });
  });

  it("une suppression déjà en attente revient inchangée, sans remplacer", () => {
    expect(
      plannedChange({
        change: { kind: "delete", token: makeToken() },
        validated: makeToken(),
        waiting: makeWaiting({ kind: "delete", token: makeToken() }),
      }),
    ).toEqual({ token: makeToken(), kind: "delete", replaces: undefined, unchanged: true });
  });

  it("réécrire la valeur validée remplace la suppression en attente, et revient inchangé (ADR 0013 §8)", () => {
    const waiting = makeWaiting({ kind: "delete", token: makeToken() });

    expect(
      plannedChange({
        change: { kind: "write", token: makeToken() },
        validated: makeToken(),
        waiting,
      }),
    ).toEqual({ token: makeToken(), kind: "update", replaces: waiting, unchanged: true });
  });

  it("une nouvelle valeur remplace la suppression en attente par une modification", () => {
    const waiting = makeWaiting({ kind: "delete", token: makeToken() });

    expect(
      plannedChange({
        change: { kind: "write", token: makeToken(NIGHT_BLUE) },
        validated: makeToken(),
        waiting,
      }),
    ).toEqual({
      token: makeToken(NIGHT_BLUE),
      kind: "update",
      replaces: waiting,
      unchanged: false,
    });
  });
});

describe("une écriture de l'IA garde ses règles (ADR 0013 §6 et §8)", () => {
  it("un token sans valeur validée est une création", () => {
    expect(
      plannedChange({
        change: { kind: "write", token: makeToken() },
        validated: undefined,
        waiting: undefined,
      }),
    ).toEqual({ token: makeToken(), kind: "create", replaces: undefined, unchanged: false });
  });

  it("une écriture identique à la proposition en attente revient inchangée, sans la remplacer", () => {
    expect(
      plannedChange({
        change: { kind: "write", token: makeToken(NIGHT_BLUE) },
        validated: makeToken(),
        waiting: makeWaiting({ token: makeToken(NIGHT_BLUE) }),
      }),
    ).toEqual({
      token: makeToken(NIGHT_BLUE),
      kind: "update",
      replaces: undefined,
      unchanged: true,
    });
  });

  it("une écriture différente de la proposition en attente la remplace", () => {
    const waiting = makeWaiting({ token: makeToken(NIGHT_BLUE) });

    expect(
      plannedChange({
        change: { kind: "write", token: makeToken(PRIMARY_BLUE) },
        validated: undefined,
        waiting,
      }),
    ).toMatchObject({ kind: "create", replaces: waiting, unchanged: false });
  });
});

describe("seul un token validé se supprime (ADR 0026 §1)", () => {
  it("accepte des noms de tokens validés", () => {
    expect(
      deletionRefusals({
        names: ["couleur.a", "couleur.b"],
        validatedNames: ["couleur.a", "couleur.b", "couleur.c"],
        pendingNames: [],
      }),
    ).toEqual([]);
  });

  it("refuse un nom inconnu du projet", () => {
    expect(
      deletionRefusals({
        names: ["couleur.a", "couleur.z"],
        validatedNames: ["couleur.a"],
        pendingNames: [],
      }),
    ).toEqual([{ index: 1, failure: { code: "unknown_token" } }]);
  });

  it("refuse un token seulement en attente de création", () => {
    expect(
      deletionRefusals({
        names: ["couleur.neuve"],
        validatedNames: [],
        pendingNames: ["couleur.neuve"],
      }),
    ).toEqual([{ index: 0, failure: { code: "pending_creation" } }]);
  });

  it("refuse un nom répété dans le même appel", () => {
    expect(
      deletionRefusals({
        names: ["couleur.a", "couleur.a"],
        validatedNames: ["couleur.a"],
        pendingNames: [],
      }),
    ).toEqual([{ index: 1, failure: { code: "duplicate_name" } }]);
  });
});

describe("une modification en attente dans le même lot retire la citation qu'elle remplace (ADR 0026 §2)", () => {
  const CITED_BY_ALIAS = { cited: "couleur.bleu", citing: "couleur.fond", via: "alias" } as const;

  it("une citation sans proposition en attente dans le lot reste", () => {
    expect(remainingCitations({ citations: [CITED_BY_ALIAS], pendingInBatch: [] })).toEqual([
      CITED_BY_ALIAS,
    ]);
  });

  it("une modification en attente du token qui cite, sans l'alias, retire la citation", () => {
    expect(
      remainingCitations({
        citations: [CITED_BY_ALIAS],
        pendingInBatch: [makeWaiting({ name: "couleur.fond", kind: "update", token: makeToken() })],
      }),
    ).toEqual([]);
  });

  it("une modification en attente du token qui cite, qui garde l'alias, laisse la citation", () => {
    expect(
      remainingCitations({
        citations: [CITED_BY_ALIAS],
        pendingInBatch: [
          makeWaiting({
            name: "couleur.fond",
            kind: "update",
            token: { name: "couleur.fond", $type: "color", $value: "{couleur.bleu}" },
          }),
        ],
      }),
    ).toEqual([CITED_BY_ALIAS]);
  });

  it("une suppression en attente du token qui cite retire la citation", () => {
    expect(
      remainingCitations({
        citations: [CITED_BY_ALIAS],
        pendingInBatch: [
          makeWaiting({
            name: "couleur.fond",
            kind: "delete",
            token: { name: "couleur.fond", $type: "color", $value: "{couleur.bleu}" },
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("une modification en attente d'un autre token ne retire pas la citation", () => {
    expect(
      remainingCitations({
        citations: [CITED_BY_ALIAS],
        pendingInBatch: [makeWaiting({ name: "couleur.bord", kind: "update", token: makeToken() })],
      }),
    ).toEqual([CITED_BY_ALIAS]);
  });
});

const makeText = (extensions?: Readonly<Record<string, unknown>>): TokenDefinition => ({
  name: "couleur.texte",
  $type: "color",
  $value: PRIMARY_BLUE,
  ...(extensions === undefined ? {} : { $extensions: extensions }),
});

describe("une modification en attente dans le même lot qui retire la paire de contraste retire la citation (ADR 0061 §3)", () => {
  const CITED_BY_PAIR = {
    cited: "couleur.fond",
    citing: "couleur.texte",
    via: "contrastOn",
  } as const;

  it("une modification en attente qui garde la paire laisse la citation", () => {
    expect(
      remainingCitations({
        citations: [CITED_BY_PAIR],
        pendingInBatch: [
          makeWaiting({
            name: "couleur.texte",
            kind: "update",
            token: makeText({
              "dev.dezyn": { contrastOn: [{ on: "{couleur.fond}", usage: "ui" }] },
            }),
          }),
        ],
      }),
    ).toEqual([CITED_BY_PAIR]);
  });

  it("une modification en attente qui retire la paire retire la citation", () => {
    expect(
      remainingCitations({
        citations: [CITED_BY_PAIR],
        pendingInBatch: [
          makeWaiting({
            name: "couleur.texte",
            kind: "update",
            token: makeText({ "dev.dezyn": { contrastOn: ["{couleur.bord}"] } }),
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("une modification en attente qui garde un alias vers le fond mais retire la paire retire la citation de la paire", () => {
    expect(
      remainingCitations({
        citations: [CITED_BY_PAIR],
        pendingInBatch: [
          makeWaiting({
            name: "couleur.texte",
            kind: "update",
            token: { name: "couleur.texte", $type: "color", $value: "{couleur.fond}" },
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("une modification en attente qui garde la paire mais retire l'alias retire la citation de l'alias", () => {
    const citedByAlias = { ...CITED_BY_PAIR, via: "alias" } as const;

    expect(
      remainingCitations({
        citations: [citedByAlias, CITED_BY_PAIR],
        pendingInBatch: [
          makeWaiting({
            name: "couleur.texte",
            kind: "update",
            token: makeText({ "dev.dezyn": { contrastOn: ["{couleur.fond}"] } }),
          }),
        ],
      }),
    ).toEqual([CITED_BY_PAIR]);
  });
});
