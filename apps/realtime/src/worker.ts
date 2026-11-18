export { ProjectRoom } from "./project-room.ts";

export default {
  fetch: async () => new Response(null, { status: 404 }),
} satisfies ExportedHandler;
