import { describe, expect, it } from "vitest";

import { BILAN_SANTE_SCENARIOS } from "../bilan-sante-scenarios.ts";
import type {
  ObservedBatch,
  ObservedEntry,
  ObservedProposal,
  Observation,
} from "../observation.ts";
import type { ScenarioRun } from "../scenario.ts";

const STARTED_AT = new Date("2026-11-25T09:00:00Z");

const BLUE = { colorSpace: "srgb", components: [0.2, 0.4, 0.8], alpha: 1 };

const DARK = { colorSpace: "srgb", components: [0.1, 0.1, 0.1], alpha: 1 };

const GREY = { colorSpace: "srgb", components: [0.45, 0.45, 0.45], alpha: 1 };

const makeObservation = (overrides: Partial<Observation> = {}): Observation => ({
  figmaFile: null,
  modes: [],
  tokens: [],
  batches: [],
  history: [{ id: "h0", action: "project.created", outcome: undefined }],
  ...overrides,
});

const makeProposal = (overrides: Partial<ObservedProposal> = {}): ObservedProposal => ({
  name: "couleur.marque",
  kind: "update",
  status: "proposed",
  token: { name: "couleur.marque", $type: "color", $value: "{couleur.primaire}" },
  ...overrides,
});

const makeBatch = (overrides: Partial<ObservedBatch> = {}): ObservedBatch => ({
  id: "lot-du-bilan",
  intent: "Bilan de santé du 25 nov. : 1 doublon remplacé par un alias",
  recipe: "bilan_sante",
  state: "closed",
  proposals: [makeProposal()],
  ...overrides,
});

const makePairsBatch = (proposals: readonly ObservedProposal[]) =>
  makeBatch({ intent: "Bilan de santé du 25 nov. : 2 paires de contraste déclarées", proposals });

const READ_ENTRIES: readonly ObservedEntry[] = [
  { id: "h1", action: "mcp.bilan_sante", outcome: "success" },
  { id: "h2", action: "mcp.read_tokens", outcome: "success" },
  { id: "h3", action: "mcp.check_contrast", outcome: "success" },
];

const OPENING_ENTRY: ObservedEntry = {
  id: "h4",
  action: "mcp.open_proposal_batch",
  outcome: "success",
};

const makeRun = (after: Partial<Observation>, before: Partial<Observation> = {}): ScenarioRun => ({
  before: makeObservation(before),
  after: makeObservation({ history: READ_ENTRIES, ...after }),
  startedAt: STARTED_AT,
});

const WITHOUT_CHECK_CONTRAST = READ_ENTRIES.filter(({ action }) => action !== "mcp.check_contrast");

const scenario = (name: string) => {
  const found = BILAN_SANTE_SCENARIOS.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`Scénario inconnu : ${name}`);
  }
  return found;
};

describe("les scénarios d'évaluation du bilan de santé (#430)", () => {
  it("couvrent les sept situations de la spec, sans fichier Figma", () => {
    expect(BILAN_SANTE_SCENARIOS.map(({ recipe, name }) => `${recipe}/${name}`)).toEqual([
      "bilan_sante/projet-sain",
      "bilan_sante/doublon-source-claire",
      "bilan_sante/doublon-ambigu",
      "bilan_sante/paire-sous-son-seuil",
      "bilan_sante/nommage-incoherent",
      "bilan_sante/alias-deja-en-attente",
      "bilan_sante/paires-manquantes",
    ]);
    expect(BILAN_SANTE_SCENARIOS.flatMap(({ figmaFiles }) => figmaFiles)).toEqual([]);
  });

  it("exigent tous que l'IA appelle des outils MCP", () => {
    expect(BILAN_SANTE_SCENARIOS.every(({ agentMustCallTools }) => agentMustCallTools)).toBe(true);
  });

  describe("projet sain", () => {
    const { check } = scenario("projet-sain");

    it("passe sans lot, après lecture des tokens et appel à check_contrast", () => {
      expect(check(makeRun({}))).toEqual([]);
    });

    it("échoue quand un lot est ouvert, même vide", () => {
      expect(
        check(
          makeRun({
            batches: [makeBatch({ proposals: [] })],
            history: [...READ_ENTRIES, OPENING_ENTRY],
          }),
        ),
      ).toContainEqual(expect.stringContaining("lots ouverts par le bilan"));
    });

    it("échoue sans appel à check_contrast", () => {
      expect(check(makeRun({ history: WITHOUT_CHECK_CONTRAST }))).toContainEqual(
        expect.stringContaining("check_contrast"),
      );
    });

    it("échoue quand check_contrast a été appelé sans succès", () => {
      const failed = READ_ENTRIES.map((entry) =>
        entry.action === "mcp.check_contrast" ? { ...entry, outcome: "error" } : entry,
      );

      expect(check(makeRun({ history: failed }))).toContainEqual(
        expect.stringContaining("check_contrast"),
      );
    });

    it("passe quand les tokens validés du projet restent les mêmes", () => {
      const tokens = [{ name: "couleur.fond", figmaState: null, declaredAt: null }];

      expect(check(makeRun({ tokens }, { tokens }))).toEqual([]);
    });

    it("échoue quand un token validé du projet disparaît ou change de nom", () => {
      const token = { figmaState: null, declaredAt: null };

      expect(
        check(
          makeRun(
            { tokens: [{ ...token, name: "couleur.fond" }] },
            {
              tokens: [
                { ...token, name: "couleur.fond" },
                { ...token, name: "couleur.texte" },
              ],
            },
          ),
        ),
      ).toContainEqual(expect.stringContaining("tokens validés du projet"));
    });

    it("échoue quand les modes du projet changent", () => {
      expect(check(makeRun({ modes: ["clair"] }, { modes: [] }))).toContainEqual(
        expect.stringContaining("modes du projet"),
      );
    });

    it("échoue sans lecture des tokens", () => {
      expect(
        check(
          makeRun({ history: READ_ENTRIES.filter(({ action }) => action !== "mcp.read_tokens") }),
        ),
      ).toContainEqual(expect.stringContaining("read_tokens"));
    });
  });

  describe("doublon avec une source claire", () => {
    const { check } = scenario("doublon-source-claire");
    const history = [...READ_ENTRIES, OPENING_ENTRY];

    it("passe avec un seul lot fermé, l'intention exacte et l'alias vers la source", () => {
      expect(check(makeRun({ batches: [makeBatch()], history }))).toEqual([]);
    });

    it("échoue sur un alias vers un autre token que la source", () => {
      const batch = makeBatch({
        proposals: [
          makeProposal({
            token: { name: "couleur.marque", $type: "color", $value: "{couleur.accent}" },
          }),
        ],
      });

      expect(check(makeRun({ batches: [batch], history }))).toContainEqual(
        expect.stringContaining("couleur.marque"),
      );
    });

    it("échoue quand la source est remplacée par un alias à la place du doublon", () => {
      const batch = makeBatch({
        proposals: [
          makeProposal({
            name: "couleur.primaire",
            token: { name: "couleur.primaire", $type: "color", $value: "{couleur.marque}" },
          }),
        ],
      });

      expect(check(makeRun({ batches: [batch], history }))).toContainEqual(
        expect.stringContaining("propositions du lot"),
      );
    });

    it("échoue sur une intention aux chiffres faux", () => {
      const batch = makeBatch({
        intent: "Bilan de santé du 25 nov. : 2 doublons remplacés par un alias",
      });

      expect(check(makeRun({ batches: [batch], history }))).toContainEqual(
        expect.stringContaining("intention"),
      );
    });

    it("échoue quand le bilan n'ouvre aucun lot", () => {
      expect(check(makeRun({}))).toContainEqual(
        expect.stringContaining("lots ouverts par le bilan"),
      );
    });

    it("échoue quand le bilan ouvre deux lots", () => {
      const second = makeBatch({ id: "second-lot" });

      expect(check(makeRun({ batches: [makeBatch(), second], history }))).toContainEqual(
        expect.stringContaining("lots ouverts par le bilan"),
      );
    });

    it("échoue sur un lot laissé ouvert", () => {
      expect(check(makeRun({ batches: [makeBatch({ state: "open" })], history }))).toContainEqual(
        expect.stringContaining("état du lot"),
      );
    });

    it("échoue quand l'ouverture du lot n'entre pas dans l'historique", () => {
      expect(check(makeRun({ batches: [makeBatch()] }))).toContainEqual(
        expect.stringContaining("ouvertures de lot dans l'historique"),
      );
    });

    it("échoue sur un lot ouvert sans la recette", () => {
      expect(check(makeRun({ batches: [makeBatch({ recipe: null })], history }))).toContainEqual(
        expect.stringContaining("recette"),
      );
    });
  });

  describe("doublon ambigu", () => {
    const { check } = scenario("doublon-ambigu");

    it("passe sans lot", () => {
      expect(check(makeRun({}))).toEqual([]);
    });

    it("échoue quand l'IA choisit une source à la place de l'éditeur", () => {
      expect(
        check(makeRun({ batches: [makeBatch()], history: [...READ_ENTRIES, OPENING_ENTRY] })),
      ).toContainEqual(expect.stringContaining("lots ouverts par le bilan"));
    });
  });

  describe("paire déclarée sous son seuil", () => {
    const { check } = scenario("paire-sous-son-seuil");

    it("passe sans lot, après appel à check_contrast", () => {
      expect(check(makeRun({}))).toEqual([]);
    });

    it("échoue sans appel à check_contrast", () => {
      expect(check(makeRun({ history: WITHOUT_CHECK_CONTRAST }))).toContainEqual(
        expect.stringContaining("check_contrast"),
      );
    });

    it("échoue quand l'IA propose de corriger la couleur", () => {
      const batch = makeBatch({
        intent: "Bilan de santé du 25 nov. : 1 couleur corrigée",
        proposals: [
          makeProposal({
            name: "couleur.texte.discret",
            token: { name: "couleur.texte.discret", $type: "color", $value: DARK },
          }),
        ],
      });

      expect(
        check(makeRun({ batches: [batch], history: [...READ_ENTRIES, OPENING_ENTRY] })),
      ).toContainEqual(expect.stringContaining("lots ouverts par le bilan"));
    });
  });

  describe("nommage incohérent", () => {
    const { check } = scenario("nommage-incoherent");

    it("passe sans lot", () => {
      expect(check(makeRun({}))).toEqual([]);
    });

    it("échoue quand l'IA propose un renommage", () => {
      const batch = makeBatch({
        intent: "Bilan de santé du 25 nov. : 1 nom corrigé",
        proposals: [
          makeProposal({
            name: "couleur.accent",
            kind: "create",
            token: { name: "couleur.accent", $type: "color", $value: BLUE },
          }),
        ],
      });

      expect(
        check(makeRun({ batches: [batch], history: [...READ_ENTRIES, OPENING_ENTRY] })),
      ).toContainEqual(expect.stringContaining("lots ouverts par le bilan"));
    });
  });

  describe("alias déjà en attente", () => {
    const { check } = scenario("alias-deja-en-attente");
    const previous = makeBatch({
      id: "lot-precedent",
      intent: "Bilan de santé du 18 nov. : 1 doublon remplacé par un alias",
    });

    it("passe quand le lot précédent reste tel quel et qu'aucun lot n'est ouvert", () => {
      expect(check(makeRun({ batches: [previous] }, { batches: [previous] }))).toEqual([]);
    });

    it("échoue quand le bilan recopie l'alias en attente", () => {
      expect(
        check(
          makeRun(
            { batches: [previous, makeBatch()], history: [...READ_ENTRIES, OPENING_ENTRY] },
            { batches: [previous] },
          ),
        ),
      ).toContainEqual(expect.stringContaining("lots ouverts par le bilan"));
    });

    it("échoue quand le bilan remplace la proposition en attente", () => {
      const replaced = makeBatch({
        ...previous,
        proposals: [makeProposal({ status: "replaced" })],
      });

      expect(check(makeRun({ batches: [replaced] }, { batches: [previous] }))).toContainEqual(
        expect.stringContaining("lots précédents"),
      );
    });
  });

  describe("paires manquantes", () => {
    const { check } = scenario("paires-manquantes");
    const history = [...READ_ENTRIES, OPENING_ENTRY];
    const text = makeProposal({
      name: "couleur.texte",
      token: {
        name: "couleur.texte",
        $type: "color",
        $value: { ...DARK, hex: "#1a1a1a" },
        $description: "Texte courant",
        $extensions: {
          "com.figma": { scopes: ["TEXT_FILL"] },
          "dev.dezyn": { contrastOn: [{ on: "{couleur.fond}", usage: "text" }] },
        },
      },
    });
    const borderToken = {
      name: "couleur.bordure",
      $type: "color",
      $value: GREY,
      $extensions: { "dev.dezyn": { contrastOn: [{ on: "{couleur.fond}", usage: "ui" }] } },
    };
    const border = makeProposal({ name: "couleur.bordure", token: borderToken });

    it("passe avec text pour le texte et ui pour la bordure, sans autre changement des tokens", () => {
      expect(check(makeRun({ batches: [makePairsBatch([border, text])], history }))).toEqual([]);
    });

    it("accepte une paire de texte écrite en simple référence", () => {
      const shortText = makeProposal({
        ...text,
        token: {
          name: "couleur.texte",
          $type: "color",
          $value: DARK,
          $description: "Texte courant",
          $extensions: {
            "com.figma": { scopes: ["TEXT_FILL"] },
            "dev.dezyn": { contrastOn: ["{couleur.fond}"] },
          },
        },
      });

      expect(check(makeRun({ batches: [makePairsBatch([border, shortText])], history }))).toEqual(
        [],
      );
    });

    it("accepte une couleur réécrite sans son alpha opaque", () => {
      const { alpha: _alpha, ...opaqueGrey } = GREY;
      const withoutAlpha = makeProposal({
        ...border,
        token: { ...borderToken, $value: opaqueGrey },
      });

      expect(check(makeRun({ batches: [makePairsBatch([withoutAlpha, text])], history }))).toEqual(
        [],
      );
    });

    it("échoue quand la proposition rend la couleur translucide", () => {
      const translucent = makeProposal({
        ...border,
        token: { ...borderToken, $value: { ...GREY, alpha: 0.5 } },
      });

      expect(
        check(makeRun({ batches: [makePairsBatch([translucent, text])], history })),
      ).toContainEqual(expect.stringContaining("couleur.bordure"));
    });

    it("échoue quand la proposition garde les autres extensions sans déclarer la paire", () => {
      const withoutPair = makeProposal({
        ...text,
        token: {
          name: "couleur.texte",
          $type: "color",
          $value: DARK,
          $description: "Texte courant",
          $extensions: { "com.figma": { scopes: ["TEXT_FILL"] } },
        },
      });

      expect(
        check(makeRun({ batches: [makePairsBatch([border, withoutPair])], history })),
      ).toContainEqual(expect.stringContaining("couleur.texte"));
    });

    it("échoue quand la bordure reçoit l'usage large-text", () => {
      const largeText = makeProposal({
        ...border,
        token: {
          ...borderToken,
          $extensions: {
            "dev.dezyn": { contrastOn: [{ on: "{couleur.fond}", usage: "large-text" }] },
          },
        },
      });

      expect(
        check(makeRun({ batches: [makePairsBatch([largeText, text])], history })),
      ).toContainEqual(expect.stringContaining("couleur.bordure"));
    });

    it("échoue quand la proposition change aussi la valeur du token", () => {
      const recolored = makeProposal({
        ...border,
        token: { ...borderToken, $value: DARK },
      });

      expect(
        check(makeRun({ batches: [makePairsBatch([recolored, text])], history })),
      ).toContainEqual(expect.stringContaining("couleur.bordure"));
    });

    it("échoue quand la proposition perd la description ou une autre extension", () => {
      const stripped = makeProposal({
        ...text,
        token: {
          name: "couleur.texte",
          $type: "color",
          $value: DARK,
          $extensions: { "dev.dezyn": { contrastOn: [{ on: "{couleur.fond}", usage: "text" }] } },
        },
      });

      expect(
        check(makeRun({ batches: [makePairsBatch([border, stripped])], history })),
      ).toContainEqual(expect.stringContaining("couleur.texte"));
    });
  });
});
