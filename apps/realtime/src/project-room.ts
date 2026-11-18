import { DurableObject } from "cloudflare:workers";

const SIGNAL_INTERVAL_MS = 1000;

const merged = (pending: readonly string[], topics: readonly string[]): readonly string[] => [
  ...new Set([...pending, ...topics]),
];

export class ProjectRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response(null, { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async changed(topics: readonly string[]): Promise<void> {
    const now = Date.now();
    const lastSentAt = (await this.ctx.storage.get<number>("lastSentAt")) ?? 0;
    const pending = (await this.ctx.storage.get<readonly string[]>("pending")) ?? [];
    if (now - lastSentAt >= SIGNAL_INTERVAL_MS) {
      await this.ctx.storage.delete("pending");
      await this.ctx.storage.deleteAlarm();
      await this.send(merged(pending, topics), now);
      return;
    }
    await this.ctx.storage.put("pending", merged(pending, topics));
    await this.ctx.storage.setAlarm(lastSentAt + SIGNAL_INTERVAL_MS);
  }

  async alarm(): Promise<void> {
    const pending = (await this.ctx.storage.get<readonly string[]>("pending")) ?? [];
    await this.ctx.storage.delete("pending");
    await this.send(pending, Date.now());
  }

  private async send(topics: readonly string[], at: number): Promise<void> {
    await this.ctx.storage.put("lastSentAt", at);
    const signal = JSON.stringify({ type: "changed", topics });
    this.ctx.getWebSockets().forEach((socket) => socket.send(signal));
  }
}
