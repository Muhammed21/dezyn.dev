import { createHash } from "node:crypto";

export type IdempotencyClaim = {
  readonly userId: string;
  readonly scope: string;
  readonly key: string;
  readonly fingerprint: string;
};

export type StoredIdempotencyKey =
  | { readonly state: "in_progress"; readonly fingerprint: string }
  | { readonly state: "completed"; readonly fingerprint: string; readonly response: string };

export type Reservation =
  | { readonly kind: "reserved" }
  | { readonly kind: "taken"; readonly stored: StoredIdempotencyKey | undefined };

export interface IdempotencyStore {
  reserve(claim: IdempotencyClaim & { readonly createdAt: Date }): Promise<Reservation>;
  complete(claim: IdempotencyClaim, response: string): Promise<void>;
}

export type IdempotentOutcome<R> =
  | { readonly kind: "executed"; readonly response: R }
  | { readonly kind: "replayed"; readonly response: R };

export type Idempotent = <R>(request: {
  readonly claim: IdempotencyClaim;
  readonly parse: (stored: unknown) => R;
  readonly run: () => Promise<R>;
}) => Promise<IdempotentOutcome<R>>;

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value === "object" && value !== null) {
    const fields = new Map(Object.entries(value));
    return Object.fromEntries(
      [...fields.keys()].toSorted().map((name) => [name, canonical(fields.get(name))]),
    );
  }
  return value;
};

export const fingerprintOf = (value: Readonly<Record<string, unknown>>): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const replayable = (stored: StoredIdempotencyKey | undefined, fingerprint: string) =>
  stored?.state === "completed" && stored.fingerprint === fingerprint ? stored.response : undefined;

export const idempotent =
  ({ store, now }: { readonly store: IdempotencyStore; readonly now: () => Date }): Idempotent =>
  async ({ claim, parse, run }) => {
    const reservation = await store.reserve({ ...claim, createdAt: now() });
    if (reservation.kind === "reserved") {
      const response = await run();
      await store.complete(claim, JSON.stringify(response));
      return { kind: "executed", response };
    }
    const replayed = replayable(reservation.stored, claim.fingerprint);
    if (replayed !== undefined) {
      const stored: unknown = JSON.parse(replayed);
      return { kind: "replayed", response: parse(stored) };
    }
    return { kind: "executed", response: await run() };
  };
