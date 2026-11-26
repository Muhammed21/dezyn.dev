import { describe, expect, it } from "vitest";

import { bilanSante } from "../bilan-sante.ts";

const makeProject = () => ({
  id: "0b7c2f4e-5a61-4d3b-9e8f-1a2b3c4d5e6f",
  name: "Site vitrine",
  figmaFile: null,
});

const instructionsOf = ({
  today = new Date("2026-11-25T09:00:00Z"),
}: { readonly today?: Date } = {}) => bilanSante.instructionsFor({ project: makeProject(), today });

describe("la recette bilan_sante (spec #425)", () => {
  it("se présente sous son nom, avec son titre et sa description", () => {
    expect(bilanSante).toMatchObject({
      name: "bilan_sante",
      title: "Bilan de santé",
      description:
        "Bilan de santé d'un projet : lit ses tokens et le contraste de ses paires déclarées, propose dans un seul lot les corrections sans ambiguïté, et rapporte le reste dans un compte rendu.",
    });
  });

  it("nomme le projet du bilan", () => {
    const text = instructionsOf();

    expect(text).toContain("« Site vitrine »");
    expect(text).toContain("0b7c2f4e-5a61-4d3b-9e8f-1a2b3c4d5e6f");
  });

  it("ne lit pas Figma", () => {
    expect(instructionsOf()).toContain("Le bilan ne lit pas Figma.");
  });

  it("fait lire les tokens avec les propositions en attente, puis appeler check_contrast", () => {
    const text = instructionsOf();

    expect(text).toContain("read_tokens avec includeProposals à true");
    expect(text).toContain("Appelle check_contrast");
    expect(text).toContain("Ne calcule aucun contraste toi-même.");
  });

  it.each([
    [
      "1. Un doublon est un groupe de tokens validés de même type et de même valeur dans chaque mode",
    ],
    [
      "La source du groupe est le seul token du groupe que d'autres tokens validés citent par alias",
    ],
    [
      "2. Quand un groupe a une source unique, propose de remplacer chaque autre token du groupe par un alias vers elle",
    ],
    [
      "3. Quand un groupe n'a aucune source, ou en a plusieurs, ne propose rien : signale ce doublon ambigu dans ton compte rendu",
    ],
    [
      "4. Rapporte dans ton compte rendu chaque paire que check_contrast rend en fail ou en indeterminate",
    ],
    ["Ne propose aucune correction de couleur."],
    ["5. Une paire de contraste manque quand un token de couleur validé ne déclare aucune paire"],
    ["Propose sa déclaration seulement si les noms la rendent évidente"],
    [
      "6. L'usage d'une paire proposée se déduit du nom du premier plan : text pour un texte, ui pour une bordure, une icône ou un focus. Ne propose jamais large-text.",
    ],
    [
      "7. Une paire proposée réécrit le token avec write_tokens tel que read_tokens le rend, en ajoutant seulement l'entrée",
    ],
    ["8. Juge la cohérence des noms par rapport à la convention majoritaire du projet"],
    ["Ne propose jamais de renommage."],
    ["9. Ne propose jamais la suppression d'un token."],
    ["10. Ne propose jamais une correction déjà en attente."],
    ["11. Un token remplacé par un alias ne reçoit pas de paire dans le même bilan."],
    ["12. Un bilan ouvre un lot de propositions seulement s'il crée au moins une proposition"],
    [
      "13. L'intention du lot est « Bilan de santé du 25 nov. : <A> doublons remplacés par un alias, <P> paires de contraste déclarées »",
    ],
    ["14. Le bilan se termine par un compte rendu à l'utilisateur. dezyn ne le stocke pas."],
  ])("énonce la règle « %s »", (rule) => {
    expect(instructionsOf()).toContain(rule);
  });

  it("fait écrire l'alias à la place de la valeur, sans rien changer d'autre au token", () => {
    expect(instructionsOf()).toContain(
      "sa valeur ($value, ou chaque mode dans modes) devenant {nom.de.la.source}, sans rien changer d'autre (type, description, extensions)",
    );
  });

  it("fait déclarer la paire sous la clé dev.dezyn, sans rien changer d'autre au token", () => {
    const text = instructionsOf();

    expect(text).toContain(
      '{ "on": "{nom.du.fond}", "usage": "<usage>" } dans $extensions["dev.dezyn"].contrastOn',
    );
    expect(text).toContain(
      "sa valeur, ses modes, sa description et ses autres extensions ne changent pas",
    );
  });

  it("fait citer un fond validé, seul fond qu'une paire proposée puisse citer (#427)", () => {
    expect(instructionsOf()).toContain("Le fond cité est un token validé.");
  });

  it("fait réécrire un token avec les seuls champs que write_tokens accepte", () => {
    expect(instructionsOf()).toContain(
      "avec les seuls champs name, $type, $value ou modes, $description et $extensions : les autres champs que rend read_tokens (id, status, duplicates, figma) ne s'écrivent pas.",
    );
  });

  it("ne fait jamais réécrire un token qui a déjà une proposition en attente", () => {
    expect(instructionsOf()).toContain(
      "Un token qui a déjà une proposition en attente n'est pas réécrit",
    );
  });

  it("fait ouvrir le lot avec la recette et y écrire en le désignant par son identifiant", () => {
    const text = instructionsOf();

    expect(text).toContain("open_proposal_batch avec recipe « bilan_sante »");
    expect(text).toContain(
      "passe son identifiant (batch.id) en batchId à write_tokens et close_proposal_batch",
    );
    expect(text).toContain("Sans proposition à créer, n'ouvre aucun lot.");
  });

  it("omet une partie à zéro de l'intention et accorde le singulier", () => {
    const text = instructionsOf();

    expect(text).toContain(
      "Omets une partie à zéro : « Bilan de santé du 25 nov. : 1 paire de contraste déclarée ».",
    );
    expect(text).toContain(
      "Au singulier : « 1 doublon remplacé par un alias », « 1 paire de contraste déclarée ».",
    );
  });

  it.each([
    [new Date("2026-11-25T09:00:00Z"), "Bilan de santé du 25 nov. :"],
    [new Date("2026-12-01T08:00:00Z"), "Bilan de santé du 1er déc. :"],
    [new Date("2027-01-31T23:30:00Z"), "Bilan de santé du 31 janv. :"],
  ])("date l'intention du jour du bilan, en UTC (%s)", (today, dated) => {
    expect(instructionsOf({ today })).toContain(dated);
  });

  it("fait finir par un compte rendu structuré, une section par point", () => {
    const text = instructionsOf();

    expect(text).toContain(
      "les contrastes insuffisants ou indéterminés ; les doublons ambigus ; les paires manquantes non évidentes ; les noms incohérents ; les corrections déjà en attente",
    );
    expect(text).toContain("Une section vide dit « rien à signaler ».");
  });
});
