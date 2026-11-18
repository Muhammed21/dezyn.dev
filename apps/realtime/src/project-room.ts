import { DurableObject } from "cloudflare:workers";

const SIGNAL_INTERVAL_MS = 1000;

type Deadline = { readonly at: number; readonly topics: readonly string[] };

type Deadlines = Readonly<Record<string, Deadline>>;

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
    await this.accept(topics, Date.now());
  }

  async signalAt({
    key,
    topics,
    at,
  }: {
    readonly key: string;
    readonly topics: readonly string[];
    readonly at: number;
  }): Promise<void> {
    const deadlines = await this.deadlines();
    await this.ctx.storage.put("deadlines", { ...deadlines, [key]: { at, topics } });
    await this.reschedule();
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const entries = Object.entries(await this.deadlines());
    const due = entries.filter(([, { at }]) => at <= now);
    await this.ctx.storage.put(
      "deadlines",
      Object.fromEntries(entries.filter(([, { at }]) => at > now)),
    );
    await this.accept(
      due.reduce<readonly string[]>((topics, [, deadline]) => merged(topics, deadline.topics), []),
      now,
    );
  }

  private async accept(topics: readonly string[], now: number): Promise<void> {
    const lastSentAt = (await this.ctx.storage.get<number>("lastSentAt")) ?? 0;
    const pending = merged(
      (await this.ctx.storage.get<readonly string[]>("pending")) ?? [],
      topics,
    );
    if (pending.length > 0 && now - lastSentAt >= SIGNAL_INTERVAL_MS) {
      await this.ctx.storage.delete("pending");
      await this.send(pending, now);
    } else if (pending.length > 0) {
      await this.ctx.storage.put("pending", pending);
    }
    await this.reschedule();
  }

  private async reschedule(): Promise<void> {
    const pending = (await this.ctx.storage.get<readonly string[]>("pending")) ?? [];
    const lastSentAt = (await this.ctx.storage.get<number>("lastSentAt")) ?? 0;
    const moments = [
      ...(pending.length > 0 ? [lastSentAt + SIGNAL_INTERVAL_MS] : []),
      ...Object.values(await this.deadlines()).map(({ at }) => at),
    ];
    if (moments.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...moments));
  }

  private async deadlines(): Promise<Deadlines> {
    return (await this.ctx.storage.get<Deadlines>("deadlines")) ?? {};
  }

  private async send(topics: readonly string[], at: number): Promise<void> {
    await this.ctx.storage.put("lastSentAt", at);
    const signal = JSON.stringify({ type: "changed", topics });
    this.ctx.getWebSockets().forEach((socket) => socket.send(signal));
  }
}
