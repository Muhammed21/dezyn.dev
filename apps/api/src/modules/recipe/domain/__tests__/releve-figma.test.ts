import { describe, expect, it } from "vitest";

import { releveFigma } from "../releve-figma.ts";

const FIGMA_FILE = {
  url: "https://www.figma.com/design/aB3dE5fG7hI9jK1lM3nO5p/Design-system",
  key: "aB3dE5fG7hI9jK1lM3nO5p",
};

const makeProject = (
  overrides: Partial<Parameters<typeof releveFigma.instructionsFor>[0]["project"]> = {},
) => ({
  id: "0b7c2f4e-5a61-4d3b-9e8f-1a2b3c4d5e6f",
  name: "Site vitrine",
  figmaFile: FIGMA_FILE,
  ...overrides,
});

const WITHOUT_FIGMA_FILE = { figmaFile: null };

const instructionsOf = ({
  project = makeProject(),
  today = new Date("2026-11-25T09:00:00Z"),
}: {
  readonly project?: ReturnType<typeof makeProject>;
  readonly today?: Date;
} = {}) => releveFigma.instructionsFor({ project, today });

describe("la recette releve_figma (ADR 0059 §5)", () => {
  it("se présente sous son nom, avec son titre et sa description", () => {
    expect(releveFigma).toMatchObject({
      name: "releve_figma",
      title: "Relevé Figma",
      description:
        "Relevé Figma d'un projet : compare le fichier Figma du projet à ses tokens, déclare l'état Figma de chaque token comparé et, seulement s'il y a du nouveau, ouvre un seul lot de propositions à relire.",
    });
  });

  it("nomme le projet relevé", () => {
    const text = instructionsOf();

    expect(text).toContain("« Site vitrine »");
    expect(text).toContain("0b7c2f4e-5a61-4d3b-9e8f-1a2b3c4d5e6f");
  });

  it("donne le lien et la clé du fichier Figma du projet, seul fichier à comparer", () => {
    const text = instructionsOf();

    expect(text).toContain(
      "Le fichier Figma du projet est https://www.figma.com/design/aB3dE5fG7hI9jK1lM3nO5p/Design-system (clé aB3dE5fG7hI9jK1lM3nO5p).",
    );
    expect(text).toContain("Un relevé compare un seul fichier Figma : celui du projet.");
    expect(text).not.toContain("demande à l'utilisateur le lien");
  });

  it("sans fichier Figma, fait demander le lien à l'utilisateur puis l'enregistrer par set_project_figma_file", () => {
    const text = instructionsOf({ project: makeProject(WITHOUT_FIGMA_FILE) });

    expect(text).toContain("Le projet n'a pas encore de fichier Figma.");
    expect(text).toContain(
      "demande à l'utilisateur le lien du fichier Figma du projet, puis enregistre-le avec set_project_figma_file",
    );
    expect(text).not.toContain("Le fichier Figma du projet est");
  });

  it("ne dépend pas de la façon de lire Figma, et écarte get_variable_defs", () => {
    const text = instructionsOf();

    expect(text).toContain("use_figma");
    expect(text).toContain("l'API REST des variables");
    expect(text).toContain("get_variable_defs ne suffit pas : il ne lit que la sélection.");
  });

  it.each([
    ["1. Un relevé compare un seul fichier Figma : celui du projet."],
    ["2. Une variable Figma correspond au token de même nom"],
    ["3. La comparaison porte sur les modes que le projet connaît."],
    [
      "4. Déclare l'état Figma de chaque token comparé, même sans changement, avec declare_figma_states, 500 états au plus par appel",
    ],
    [
      "5. Une variable absente de dezyn devient une proposition de création, écrite avec write_tokens",
    ],
    ["6. Une valeur divergente devient une proposition"],
    [
      "7. Un token absent de Figma reçoit l'état absent de Figma (missing_in_figma). Ne propose jamais sa suppression.",
    ],
    [
      "8. Un mode présent seulement dans Figma n'est ni proposé ni créé : signale-le dans ton compte rendu.",
    ],
    ["9. Un relevé ouvre un lot de propositions seulement s'il crée au moins une proposition"],
    [
      "10. L'intention du lot est « Relevé Figma du 25 nov. : <N> nouveaux tokens, <M> valeurs changées »",
    ],
    ["11. N et M ne comptent que les propositions créées par ce relevé."],
    [
      "12. Un token créé par un relevé n'a pas d'état Figma tant que sa proposition n'est pas validée",
    ],
    ["13. Le relevé se termine par un compte rendu à l'utilisateur. dezyn ne le stocke pas."],
  ])("énonce la règle « %s »", (rule) => {
    expect(instructionsOf()).toContain(rule);
  });

  it("fait ouvrir le lot avec la recette et y écrire en le désignant par son identifiant", () => {
    const text = instructionsOf();

    expect(text).toContain("open_proposal_batch avec recipe « releve_figma »");
    expect(text).toContain(
      "passe son identifiant (batch.id) en batchId à write_tokens, declare_figma_states et close_proposal_batch",
    );
  });

  it("fait compter les écarts sur les propositions en attente, lues par read_tokens avec includeProposals", () => {
    const text = instructionsOf();

    expect(text).toContain("read_tokens avec includeProposals à true");
    expect(text).toContain("n'est ni recopiée ni comptée");
  });

  it("fait déclarer un token créé par un relevé précédent synchronisé une fois validé", () => {
    expect(instructionsOf()).toContain(
      "Au relevé suivant, une fois validé, il est déclaré synchronisé (synced).",
    );
  });

  it("omet une partie à zéro de l'intention", () => {
    expect(instructionsOf()).toContain(
      "Omets une partie à zéro : « Relevé Figma du 25 nov. : 2 valeurs changées ».",
    );
  });

  it.each([
    [new Date("2026-11-25T09:00:00Z"), "Relevé Figma du 25 nov. :"],
    [new Date("2026-12-01T08:00:00Z"), "Relevé Figma du 1er déc. :"],
    [new Date("2027-01-31T23:30:00Z"), "Relevé Figma du 31 janv. :"],
  ])("date l'intention du jour du relevé, en UTC (%s)", (today, dated) => {
    expect(instructionsOf({ today })).toContain(dated);
  });
});
