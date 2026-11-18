import type { Fetch } from "../../platform/http.ts";
import { projectUseCases } from "./application/projects.ts";
import { createHttpProjectGateway } from "./infrastructure/http-project-gateway.ts";
import { createWebSocketProjectEvents } from "./infrastructure/websocket-project-events.ts";

export const createProjects = (options: { readonly apiUrl: string; readonly fetch: Fetch }) =>
  projectUseCases({ gateway: createHttpProjectGateway(options) });

export const createProjectEvents = createWebSocketProjectEvents;
