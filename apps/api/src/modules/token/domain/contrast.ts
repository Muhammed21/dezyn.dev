import type { SrgbColor } from "./color.ts";
import { type ContrastUsage, contrastPairs } from "./contrast-pairs.ts";
import { aliasName } from "./reference.ts";

export type ContrastVerdict = "pass" | "fail" | "indeterminate";

export type IndeterminateReason = "translucent_background" | "missing_value";

export type Contrast =
  | {
      readonly ratio: number;
      readonly threshold: number;
      readonly verdict: Exclude<ContrastVerdict, "indeterminate">;
    }
  | {
      readonly ratio: null;
      readonly threshold: number;
      readonly verdict: "indeterminate";
      readonly reason: IndeterminateReason;
    };

export type ContrastToken = {
  readonly name: string;
  readonly $type: string;
  readonly $value?: unknown;
  readonly modes?: Readonly<Record<string, unknown>>;
  readonly $extensions?: Readonly<Record<string, unknown>>;
};

export type PairContrast = {
  readonly token: string;
  readonly background: string;
  readonly usage: ContrastUsage;
  readonly mode: string | null;
} & Contrast;

const THRESHOLDS: Readonly<Record<ContrastUsage, number>> = {
  text: 4.5,
  "large-text": 3,
  ui: 3,
};

type Components = SrgbColor["components"];

type Paint = { readonly components: Components; readonly alpha: number };

const paintOf = ({ components, alpha = 1 }: SrgbColor): Paint => ({ components, alpha });

const linear = (component: number): number =>
  component <= 0.040_45 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;

const luminance = ([red, green, blue]: Components): number =>
  0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);

const composed = (
  { components: [red, green, blue], alpha }: Paint,
  [underRed, underGreen, underBlue]: Components,
): Components => {
  const sourceOver = (front: number, under: number) => alpha * front + (1 - alpha) * under;
  return [sourceOver(red, underRed), sourceOver(green, underGreen), sourceOver(blue, underBlue)];
};

const ratioOf = (foreground: Paint, background: Paint): number => {
  const front = luminance(composed(foreground, background.components));
  const under = luminance(background.components);
  return (Math.max(front, under) + 0.05) / (Math.min(front, under) + 0.05);
};

export const contrastRatio = ({
  foreground,
  background,
}: {
  readonly foreground: SrgbColor;
  readonly background: SrgbColor;
}): number => ratioOf(paintOf(foreground), paintOf(background));

const truncated = (ratio: number): number => Math.floor(ratio * 100) / 100;

export const judgeRatio = ({
  ratio,
  usage,
}: {
  readonly ratio: number;
  readonly usage: ContrastUsage;
}): Contrast => {
  const threshold = THRESHOLDS[usage];
  return { ratio: truncated(ratio), threshold, verdict: ratio >= threshold ? "pass" : "fail" };
};

const indeterminate = (usage: ContrastUsage, reason: IndeterminateReason): Contrast => ({
  ratio: null,
  threshold: THRESHOLDS[usage],
  verdict: "indeterminate",
  reason,
});

const judgePaints = ({
  foreground,
  background,
  usage,
}: {
  readonly foreground: Paint;
  readonly background: Paint;
  readonly usage: ContrastUsage;
}): Contrast =>
  background.alpha < 1
    ? indeterminate(usage, "translucent_background")
    : judgeRatio({ ratio: ratioOf(foreground, background), usage });

export const contrastOf = ({
  foreground,
  background,
  usage,
}: {
  readonly foreground: SrgbColor;
  readonly background: SrgbColor;
  readonly usage: ContrastUsage;
}): Contrast =>
  judgePaints({ foreground: paintOf(foreground), background: paintOf(background), usage });

const isComponents = (value: unknown): value is Components =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((component) => typeof component === "number");

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const storedPaint = (value: unknown): Paint | undefined => {
  if (!isRecord(value) || value.colorSpace !== "srgb" || !isComponents(value.components)) {
    return undefined;
  }
  const { components, alpha } = value;
  return { components, alpha: typeof alpha === "number" ? alpha : 1 };
};

const valueIn = (token: ContrastToken, mode: string | null): unknown =>
  token.modes === undefined || mode === null ? token.$value : token.modes[mode];

const paintIn = ({
  name,
  mode,
  tokens,
  visited = [],
}: {
  readonly name: string;
  readonly mode: string | null;
  readonly tokens: readonly ContrastToken[];
  readonly visited?: readonly string[];
}): Paint | undefined => {
  const token = tokens.find((candidate) => candidate.name === name);
  if (token === undefined || visited.includes(name)) {
    return undefined;
  }
  const value = valueIn(token, mode);
  const alias = aliasName(value);
  return alias === undefined
    ? storedPaint(value)
    : paintIn({ name: alias, mode, tokens, visited: [...visited, name] });
};

export const projectContrast = ({
  modes,
  tokens,
}: {
  readonly modes: readonly string[];
  readonly tokens: readonly ContrastToken[];
}): readonly PairContrast[] => {
  const judgedModes: readonly (string | null)[] = modes.length === 0 ? [null] : modes;
  return tokens
    .filter(({ $type }) => $type === "color")
    .flatMap(({ name, $extensions }) =>
      contrastPairs($extensions).flatMap(({ background, usage }) =>
        judgedModes.map((mode): PairContrast => {
          const foreground = paintIn({ name, mode, tokens });
          const under = paintIn({ name: background, mode, tokens });
          const contrast =
            foreground === undefined || under === undefined
              ? indeterminate(usage, "missing_value")
              : judgePaints({ foreground, background: under, usage });
          return { token: name, background, usage, mode, ...contrast };
        }),
      ),
    );
};
