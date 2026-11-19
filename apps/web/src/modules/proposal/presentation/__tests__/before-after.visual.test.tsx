import interUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { TokenValue } from "../../domain/proposal.ts";
import { BeforeAfter } from "../before-after.tsx";

const SAMPLE_FONT = "Inter";

const embedSampleFont = async () => {
  const face = new FontFace(SAMPLE_FONT, `url(${interUrl})`, { weight: "100 900" });
  document.fonts.add(await face.load());
  const style = document.createElement("style");
  style.textContent = `body, body * { font-family: "${SAMPLE_FONT}"; }`;
  document.head.append(style);
};

const NO_ALIASES = { before: new Map(), after: new Map() };

const makeColor = (components: readonly number[], alpha?: number) => ({
  colorSpace: "srgb",
  components,
  ...(alpha === undefined ? {} : { alpha }),
});

const makeLength = (value: number) => ({ value, unit: "px" });

const makeShadow = (blur: number) => ({
  color: makeColor([0, 0, 0], 0.4),
  offsetX: makeLength(0),
  offsetY: makeLength(4),
  blur: makeLength(blur),
  spread: makeLength(0),
});

const makeTypography = (fontSize: number, fontWeight: number) => ({
  fontFamily: SAMPLE_FONT,
  fontSize: makeLength(fontSize),
  fontWeight,
  lineHeight: 1.4,
  letterSpacing: makeLength(0),
});

type Case = {
  readonly name: string;
  readonly validated: TokenValue;
  readonly proposed: TokenValue;
};

const makeToken = ($type: string, $value: unknown): TokenValue => ({ $type, $value });

const CASES: readonly Case[] = [
  {
    name: "color-opaque",
    validated: makeToken("color", makeColor([0.2, 0.4, 0.8])),
    proposed: makeToken("color", makeColor([0.8, 0.2, 0.3])),
  },
  {
    name: "color-transparent",
    validated: makeToken("color", makeColor([0.2, 0.4, 0.8], 0.5)),
    proposed: makeToken("color", makeColor([0.8, 0.2, 0.3], 0.25)),
  },
  {
    name: "dimension",
    validated: makeToken("dimension", makeLength(48)),
    proposed: makeToken("dimension", { value: 6, unit: "rem" }),
  },
  { name: "number", validated: makeToken("number", 1.25), proposed: makeToken("number", 1.5) },
  {
    name: "shadow",
    validated: makeToken("shadow", makeShadow(4)),
    proposed: makeToken("shadow", makeShadow(16)),
  },
  {
    name: "typography",
    validated: makeToken("typography", makeTypography(14, 400)),
    proposed: makeToken("typography", makeTypography(18, 700)),
  },
  {
    name: "font-family",
    validated: makeToken("fontFamily", [SAMPLE_FONT, "sans-serif"]),
    proposed: makeToken("fontFamily", SAMPLE_FONT),
  },
  {
    name: "font-weight",
    validated: makeToken("fontWeight", 300),
    proposed: makeToken("fontWeight", "bold"),
  },
  {
    name: "gradient",
    validated: makeToken("gradient", [
      { color: makeColor([0.2, 0.4, 0.8]), position: 0 },
      { color: makeColor([0.8, 0.2, 0.3]), position: 1 },
    ]),
    proposed: makeToken("gradient", [
      { color: makeColor([1, 0.8, 0]), position: 0 },
      { color: makeColor([0.2, 0.4, 0.8], 0), position: 1 },
    ]),
  },
];

describe("aperçu avant/après", () => {
  beforeAll(embedSampleFont);

  it.each(CASES)("garde le rendu de référence : $name", async ({ name, validated, proposed }) => {
    const screen = await render(
      <div style={{ width: "32rem", padding: "1rem", background: "#ffffff", color: "#1a1a1a" }}>
        <BeforeAfter
          validated={validated}
          proposed={proposed}
          aliases={NO_ALIASES}
          projectModes={[]}
        />
      </div>,
    );

    await expect.element(screen.locator).toMatchScreenshot(name);
  });
});
