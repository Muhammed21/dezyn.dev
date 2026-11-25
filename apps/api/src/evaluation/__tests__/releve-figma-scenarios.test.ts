import { describe, expect, it } from "vitest";

import type { ObservedBatch, Observation } from "../observation.ts";
import { RELEVE_FIGMA_SCENARIOS } from "../releve-figma-scenarios.ts";
import type { ScenarioRun } from "../scenario.ts";

const STARTED_AT = new Date("2026-11-25T09:00:00Z");

const DURING_RUN = new Date("2026-11-25T09:01:00Z");

const BEFORE_RUN = new Date("2026-11-18T09:00:00Z");

const FIGMA_FILE = {
  url: "https://www.figma.com/design/aB3dE5fG7hI9jK1lM3nO5p/Design-system",
  key: "aB3dE5fG7hI9jK1lM3nO5p",
};

const makeObservation = (overrides: Partial<Observation> = {}): Observation => ({
  figmaFile: FIGMA_FILE,
  modes: [],
  tokens: [],
  batches: [],
  history: [{ id: "h0", action: "project.created", outcome: undefined }],
  ...overrides,
});

const makeBatch = (overrides: Partial<ObservedBatch> = {}): ObservedBatch => ({
  id: "lot-du-releve",
  intent: "Relevé Figma du 25 nov. : 2 nouveaux tokens, 1 valeur changée",
  recipe: "releve_figma",
  state: "closed",
  proposals: [
    { name: "couleur.alerte", kind: "create", status: "proposed" },
    { name: "couleur.fond.primaire", kind: "update", status: "proposed" },
    { name: "couleur.succes", kind: "create", status: "proposed" },
  ],
  ...overrides,
});

const RELEVE_ENTRIES = [
  { id: "h1", action: "mcp.releve_figma", outcome: "success" },
  { id: "h2", action: "mcp.open_proposal_batch", outcome: "success" },
];

const makeRun = (after: Partial<Observation>, before: Partial<Observation> = {}): ScenarioRun => ({
  before: makeObservation(before),
  after: makeObservation(after),
  startedAt: STARTED_AT,
});

const scenario = (name: string) => {
  const found = RELEVE_FIGMA_SCENARIOS.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`Scénario inconnu : ${name}`);
  }
  return found;
};

describe("les scénarios d'évaluation du relevé Figma (#398)", () => {
  it("couvrent les sept situations de la spec", () => {
    expect(RELEVE_FIGMA_SCENARIOS.map(({ recipe, name }) => `${recipe}/${name}`)).toEqual([
      "releve_figma/premier-releve",
      "releve_figma/semaine-sans-changement",
      "releve_figma/deux-nouveaux-tokens-une-valeur-changee",
      "releve_figma/nouveautes-deja-en-attente",
      "releve_figma/token-absent-de-figma",
      "releve_figma/mode-seulement-dans-figma",
      "releve_figma/fichier-figma-non-renseigne",
    ]);
  });

  it("exigent que l'IA appelle des outils MCP, sauf quand le fichier Figma manque et qu'elle doit seulement le demander", () => {
    expect(
      RELEVE_FIGMA_SCENARIOS.filter(({ agentMustCallTools }) => !agentMustCallTools).map(
        ({ name }) => name,
      ),
    ).toEqual(["fichier-figma-non-renseigne"]);
  });

  describe("deux nouveaux tokens et une valeur changée", () => {
    const { check } = scenario("deux-nouveaux-tokens-une-valeur-changee");
    const declared = [
      { name: "couleur.fond.primaire", figmaState: "diverged", declaredAt: DURING_RUN },
      { name: "couleur.texte", figmaState: "synced", declaredAt: DURING_RUN },
    ];

    it("passe avec un seul lot fermé, l'intention exacte, ses trois propositions et les états déclarés", () => {
      expect(
        check(makeRun({ batches: [makeBatch()], tokens: declared, history: RELEVE_ENTRIES })),
      ).toEqual([]);
    });

    it("échoue sur une intention aux chiffres faux", () => {
      const batch = makeBatch({ intent: "Relevé Figma du 25 nov. : 3 nouveaux tokens" });

      expect(
        check(makeRun({ batches: [batch], tokens: declared, history: RELEVE_ENTRIES })),
      ).toContainEqual(expect.stringContaining("intention"));
    });

    it("échoue quand une proposition du relevé tombe dans un autre lot", () => {
      const designated = makeBatch({
        proposals: [{ name: "couleur.alerte", kind: "create", status: "proposed" }],
      });
      const implicit = makeBatch({
        id: "lot-implicite",
        intent: null,
        recipe: null,
        proposals: [
          { name: "couleur.fond.primaire", kind: "update", status: "proposed" },
          { name: "couleur.succes", kind: "create", status: "proposed" },
        ],
      });

      expect(
        check(
          makeRun({ batches: [designated, implicit], tokens: declared, history: RELEVE_ENTRIES }),
        ),
      ).toContainEqual(expect.stringContaining("lots ouverts par le relevé"));
    });

    it("échoue sur un lot ouvert sans la recette", () => {
      const batch = makeBatch({ recipe: null });

      expect(
        check(makeRun({ batches: [batch], tokens: declared, history: RELEVE_ENTRIES })),
      ).toContainEqual(expect.stringContaining("recette"));
    });
  });

  describe("semaine sans changement", () => {
    const { check } = scenario("semaine-sans-changement");
    const before = {
      tokens: [
        { name: "couleur.fond.primaire", figmaState: "synced", declaredAt: BEFORE_RUN },
        { name: "couleur.texte", figmaState: "synced", declaredAt: BEFORE_RUN },
      ],
    };

    it("passe sans lot, avec chaque token redéclaré synchronisé", () => {
      const tokens = before.tokens.map((token) => ({ ...token, declaredAt: DURING_RUN }));

      expect(check(makeRun({ tokens }, before))).toEqual([]);
    });

    it("échoue quand un lot est ouvert", () => {
      const tokens = before.tokens.map((token) => ({ ...token, declaredAt: DURING_RUN }));

      expect(
        check(makeRun({ tokens, batches: [makeBatch({ proposals: [] })] }, before)),
      ).toContainEqual(expect.stringContaining("lots ouverts par le relevé"));
    });

    it("échoue quand un token comparé n'est pas déclaré pendant le relevé", () => {
      expect(check(makeRun({ tokens: before.tokens }, before))).toContainEqual(
        expect.stringContaining("déclarés pendant le relevé"),
      );
    });
  });

  describe("nouveautés déjà en attente", () => {
    const { check } = scenario("nouveautes-deja-en-attente");
    const previous = makeBatch({
      id: "lot-precedent",
      intent: "Relevé Figma du 18 nov. : 1 nouveau token, 1 valeur changée",
      proposals: [
        { name: "couleur.alerte", kind: "create", status: "proposed" },
        { name: "couleur.fond.primaire", kind: "update", status: "proposed" },
      ],
    });
    const tokens = [
      { name: "couleur.fond.primaire", figmaState: "diverged", declaredAt: DURING_RUN },
    ];

    it("passe quand le lot précédent reste tel quel et qu'aucun lot n'est ouvert", () => {
      expect(check(makeRun({ batches: [previous], tokens }, { batches: [previous] }))).toEqual([]);
    });

    it("échoue quand le relevé recopie une proposition en attente", () => {
      const copied = makeBatch({
        intent: "Relevé Figma du 25 nov. : 1 nouveau token",
        proposals: [{ name: "couleur.alerte", kind: "create", status: "proposed" }],
      });

      expect(
        check(makeRun({ batches: [previous, copied], tokens }, { batches: [previous] })),
      ).not.toEqual([]);
    });
  });

  describe("token absent de Figma", () => {
    const { check } = scenario("token-absent-de-figma");
    const tokens = [
      { name: "couleur.ancienne", figmaState: "missing_in_figma", declaredAt: DURING_RUN },
      { name: "couleur.fond.primaire", figmaState: "synced", declaredAt: DURING_RUN },
    ];

    it("passe quand le token reçoit l'état absent de Figma, sans proposition", () => {
      expect(check(makeRun({ tokens }))).toEqual([]);
    });

    it("échoue quand le token est déclaré autrement", () => {
      const synced = tokens.map((token) => ({ ...token, figmaState: "synced" }));

      expect(check(makeRun({ tokens: synced }))).toContainEqual(
        expect.stringContaining("états Figma"),
      );
    });
  });

  describe("mode présent seulement dans Figma", () => {
    const { check } = scenario("mode-seulement-dans-figma");
    const tokens = [
      { name: "couleur.fond.primaire", figmaState: "synced", declaredAt: DURING_RUN },
    ];

    it("passe quand les modes du projet ne changent pas et que rien n'est proposé", () => {
      expect(check(makeRun({ modes: ["Clair"], tokens }, { modes: ["Clair"] }))).toEqual([]);
    });

    it("échoue quand le mode de Figma entre dans le projet", () => {
      expect(
        check(makeRun({ modes: ["Clair", "Sombre"], tokens }, { modes: ["Clair"] })),
      ).toContainEqual(expect.stringContaining("modes"));
    });
  });

  describe("fichier Figma non renseigné", () => {
    const { check } = scenario("fichier-figma-non-renseigne");

    it("passe quand rien n'est déclaré, proposé ni enregistré", () => {
      const tokens = [{ name: "couleur.fond.primaire", figmaState: null, declaredAt: null }];

      expect(check(makeRun({ figmaFile: null, tokens }, { figmaFile: null, tokens }))).toEqual([]);
    });

    it("échoue quand l'IA invente un fichier Figma", () => {
      expect(check(makeRun({ figmaFile: FIGMA_FILE }, { figmaFile: null }))).toContainEqual(
        expect.stringContaining("fichier Figma"),
      );
    });
  });
});
