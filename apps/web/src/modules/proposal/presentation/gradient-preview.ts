import { z } from "zod";

import { SrgbHex } from "./color-preview.ts";
import type { BandPreview } from "./preview.ts";

const GradientStop = z
  .object({ color: SrgbHex, position: z.number().min(0).max(1) })
  .transform(({ color, position }) => `${color} ${Math.round(position * 10_000) / 100}%`);

const Gradient = z.array(GradientStop).min(1);

export const gradientPreview = (value: unknown): BandPreview | undefined => {
  const gradient = Gradient.safeParse(value);
  if (!gradient.success) {
    return undefined;
  }
  const stops = gradient.data.length === 1 ? [...gradient.data, ...gradient.data] : gradient.data;
  return {
    shape: "band",
    text: gradient.data.join(", "),
    style: { backgroundImage: `linear-gradient(to right, ${stops.join(", ")})` },
  };
};
