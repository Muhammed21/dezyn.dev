import { z } from "zod";

const MAX_URL_LENGTH = 2048;

const FIGMA_HOSTS: ReadonlySet<string> = new Set(["figma.com", "www.figma.com"]);

const FILE_KINDS: ReadonlySet<string> = new Set(["design", "file"]);

const FIGMA_KEY = /^[0-9A-Za-z]+$/;

export type FigmaFile = { readonly url: string; readonly key: string };

const parsedUrlOf = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

export const figmaFileOf = (link: string): FigmaFile | undefined => {
  const url = link.trim();
  const parsed = url.length > MAX_URL_LENGTH ? undefined : parsedUrlOf(url);
  if (parsed === undefined || parsed.protocol !== "https:" || !FIGMA_HOSTS.has(parsed.hostname)) {
    return undefined;
  }
  const [, kind = "", key = ""] = parsed.pathname.split("/");
  return FILE_KINDS.has(kind) && FIGMA_KEY.test(key) ? { url, key } : undefined;
};

export const FigmaFileInput = z.object({
  url: z
    .string()
    .trim()
    .refine((url) => figmaFileOf(url) !== undefined, "Lien de fichier Figma attendu")
    .nullable(),
});

export const FigmaFileOutput = z.looseObject({ url: z.string(), key: z.string() });
