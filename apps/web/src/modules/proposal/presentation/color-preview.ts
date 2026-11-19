import { z } from "zod";

import type { SwatchPreview } from "./preview.ts";

const Unit = z.number().min(0).max(1);

const SrgbColor = z.object({
  colorSpace: z.literal("srgb"),
  components: z.tuple([Unit, Unit, Unit]),
  alpha: Unit.optional(),
});

const byteOf = (unit: number) =>
  Math.round(unit * 255)
    .toString(16)
    .padStart(2, "0");

export const colorPreview = (value: unknown): SwatchPreview | undefined => {
  const color = SrgbColor.safeParse(value);
  if (!color.success) {
    return undefined;
  }
  const { components, alpha = 1 } = color.data;
  const hex = `#${[...components, ...(alpha === 1 ? [] : [alpha])].map(byteOf).join("")}`;
  return { shape: "swatch", text: hex, style: { backgroundColor: hex } };
};
