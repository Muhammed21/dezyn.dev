import { DurableObject } from "cloudflare:workers";

export class ProjectRoom extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response(null, { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async changed(topics: readonly string[]): Promise<void> {
    const signal = JSON.stringify({ type: "changed", topics });
    this.ctx.getWebSockets().forEach((socket) => socket.send(signal));
  }
}
