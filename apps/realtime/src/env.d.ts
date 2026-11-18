import type { ProjectRoom } from "./project-room.ts";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly PROJECT_ROOMS: DurableObjectNamespace<ProjectRoom>;
    }
  }
}
