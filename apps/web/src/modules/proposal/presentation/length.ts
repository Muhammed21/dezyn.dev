import { z } from "zod";

export const Length = z
  .object({ value: z.number(), unit: z.enum(["px", "rem"]) })
  .transform(({ value, unit }) => `${value}${unit}`);
