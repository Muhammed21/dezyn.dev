import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ValuePreview } from "../before-after.tsx";

const NIGHT_BLUE = { colorSpace: "srgb", components: [0.1, 0.2, 0.4] };

describe("une valeur seule, au format des valeurs de l'écran du lot", () => {
  it("nomme la valeur par son libellé et son texte d'aperçu", async () => {
    const screen = await render(
      <ValuePreview label="Valeur Figma" type="color" value={NIGHT_BLUE} aliases={new Map()} />,
    );

    await expect
      .element(screen.getByRole("figure", { name: "Valeur Figma : #1a3366", exact: true }))
      .toBeVisible();
  });

  it("résout un alias parmi les valeurs données, et le nomme", async () => {
    const screen = await render(
      <ValuePreview
        label="sombre"
        type="color"
        value="{couleur.nuit}"
        aliases={new Map([["couleur.nuit", NIGHT_BLUE]])}
      />,
    );

    await expect
      .element(screen.getByRole("figure", { name: "sombre : #1a3366, alias de couleur.nuit" }))
      .toBeVisible();
  });
});
