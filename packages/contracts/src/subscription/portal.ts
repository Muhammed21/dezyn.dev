import { z } from "zod";

export const PortalOutput = z.looseObject({
  url: z.url({ protocol: /^https?$/ }),
});
