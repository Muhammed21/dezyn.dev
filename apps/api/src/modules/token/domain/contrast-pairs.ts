import { aliasName } from "./reference.ts";

export const DEZYN_EXTENSION = "dev.dezyn";

export const CONTRAST_USAGES = ["text", "large-text", "ui"] as const;

export type ContrastUsage = (typeof CONTRAST_USAGES)[number];

export type ContrastPairRefusal = {
  readonly path: readonly (string | number)[];
  readonly refusal:
    | "malformed_extension"
    | "unknown_property"
    | "unknown_entry_property"
    | "malformed_contrast_on"
    | "malformed_entry"
    | "malformed_reference"
    | "unknown_usage"
    | "not_a_color"
    | "self_reference"
    | "duplicate_background";
};

export type ContrastBackground = { readonly index: number; readonly name: string };

type Declaring = {
  readonly name: string;
  readonly $type: string;
  readonly $extensions?: Readonly<Record<string, unknown>>;
};

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const DEZYN_PROPERTIES: readonly string[] = ["contrastOn"];

const ENTRY_PROPERTIES: readonly string[] = ["on", "usage"];

const isUsage = (usage: unknown): usage is ContrastUsage =>
  CONTRAST_USAGES.some((known) => known === usage);

const unknownProperties = (
  value: Readonly<Record<string, unknown>>,
  {
    known,
    prefix,
    refusal,
  }: {
    readonly known: readonly string[];
    readonly prefix: readonly (string | number)[];
    readonly refusal: "unknown_property" | "unknown_entry_property";
  },
): readonly ContrastPairRefusal[] =>
  Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => ({ path: [...prefix, key], refusal }));

const backgroundOf = (entry: unknown): string | undefined =>
  aliasName(isObject(entry) ? entry.on : entry);

const entryShapeRefusals = (entry: unknown, index: number): readonly ContrastPairRefusal[] => {
  const path = ["contrastOn", index];
  if (typeof entry === "string") {
    return aliasName(entry) === undefined ? [{ path, refusal: "malformed_entry" }] : [];
  }
  if (!isObject(entry) || !("on" in entry)) {
    return [{ path, refusal: "malformed_entry" }];
  }
  const malformedOn: readonly ContrastPairRefusal[] =
    aliasName(entry.on) === undefined
      ? [{ path: [...path, "on"], refusal: "malformed_reference" }]
      : [];
  const unknownUsage: readonly ContrastPairRefusal[] =
    "usage" in entry && !isUsage(entry.usage)
      ? [{ path: [...path, "usage"], refusal: "unknown_usage" }]
      : [];
  return [
    ...malformedOn,
    ...unknownUsage,
    ...unknownProperties(entry, {
      known: ENTRY_PROPERTIES,
      prefix: path,
      refusal: "unknown_entry_property",
    }),
  ];
};

const citationRefusals = (
  name: string,
  backgrounds: readonly ContrastBackground[],
): readonly ContrastPairRefusal[] =>
  backgrounds.flatMap((background, position): readonly ContrastPairRefusal[] => {
    const path = ["contrastOn", background.index];
    if (background.name === name) {
      return [{ path, refusal: "self_reference" }];
    }
    return backgrounds.slice(0, position).some((earlier) => earlier.name === background.name)
      ? [{ path, refusal: "duplicate_background" }]
      : [];
  });

const contrastOnRefusals = (
  { name, $type }: Declaring,
  contrastOn: unknown,
): readonly ContrastPairRefusal[] => {
  if (!Array.isArray(contrastOn)) {
    return [{ path: ["contrastOn"], refusal: "malformed_contrast_on" }];
  }
  if ($type !== "color") {
    return [{ path: ["contrastOn"], refusal: "not_a_color" }];
  }
  const shapes = contrastOn.flatMap(entryShapeRefusals);
  return shapes.length > 0 ? shapes : citationRefusals(name, backgroundsIn(contrastOn));
};

const backgroundsIn = (contrastOn: readonly unknown[]): readonly ContrastBackground[] =>
  contrastOn.flatMap((entry, index) => {
    const name = backgroundOf(entry);
    return name === undefined ? [] : [{ index, name }];
  });

export const contrastPairRefusals = (token: Declaring): readonly ContrastPairRefusal[] => {
  if (token.$extensions === undefined || !(DEZYN_EXTENSION in token.$extensions)) {
    return [];
  }
  const dezyn = token.$extensions[DEZYN_EXTENSION];
  if (!isObject(dezyn)) {
    return [{ path: [], refusal: "malformed_extension" }];
  }
  return [
    ...unknownProperties(dezyn, {
      known: DEZYN_PROPERTIES,
      prefix: [],
      refusal: "unknown_property",
    }),
    ...("contrastOn" in dezyn ? contrastOnRefusals(token, dezyn.contrastOn) : []),
  ];
};

export const contrastBackgrounds = (
  extensions: Readonly<Record<string, unknown>> | undefined,
): readonly ContrastBackground[] => {
  const dezyn = extensions?.[DEZYN_EXTENSION];
  return isObject(dezyn) && Array.isArray(dezyn.contrastOn) ? backgroundsIn(dezyn.contrastOn) : [];
};
