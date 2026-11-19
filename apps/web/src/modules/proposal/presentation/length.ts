import { z } from "zod";

export const LengthValue = z.object({ value: z.number(), unit: z.enum(["px", "rem"]) });

export const lengthText = ({ value, unit }: z.infer<typeof LengthValue>) => `${value}${unit}`;

export const Length = LengthValue.transform(lengthText);
