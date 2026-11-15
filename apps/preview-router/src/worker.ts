import { createPreviewRouter } from "./preview-router.ts";

export default createPreviewRouter({ fetch: (request) => fetch(request) });
