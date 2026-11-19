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
  | { readonly reserved: true }
  | { readonly reserved: false; readonly stored: StoredIdempotencyKey };

export interface IdempotencyStore {
  reserve(claim: IdempotencyClaim & { readonly createdAt: Date }): Promise<Reservation>;
  complete(claim: IdempotencyClaim, response: string): Promise<void>;
  release(claim: IdempotencyClaim): Promise<void>;
}

export type Execution<R> = { readonly response: R; readonly memorable: boolean };

export type IdempotencyRefusal =
  | "invalid_idempotency_key"
  | "idempotency_in_progress"
  | "idempotency_key_reused";

export type IdempotentOutcome<R> =
  | { readonly response: R }
  | { readonly refusal: IdempotencyRefusal };

export type Idempotent = <R>(request: {
  readonly claim: IdempotencyClaim;
  readonly parse: (stored: unknown) => R;
  readonly run: () => Promise<Execution<R>>;
  readonly replay: (stored: R) => Promise<R>;
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

const IDEMPOTENCY_KEY = /^[\x20-\x7E]{1,255}$/;

const verdictOf = (
  stored: StoredIdempotencyKey,
  fingerprint: string,
): { readonly refusal: IdempotencyRefusal } | { readonly response: string } => {
  if (stored.fingerprint !== fingerprint) {
    return { refusal: "idempotency_key_reused" };
  }
  if (stored.state === "in_progress") {
    return { refusal: "idempotency_in_progress" };
  }
  return { response: stored.response };
};

const executeReserved = async <R>(
  store: IdempotencyStore,
  { claim, run }: { readonly claim: IdempotencyClaim; readonly run: () => Promise<Execution<R>> },
): Promise<Execution<R>> => {
  try {
    return await run();
  } catch (error) {
    await store.release(claim);
    throw error;
  }
};

export const idempotent =
  ({ store, now }: { readonly store: IdempotencyStore; readonly now: () => Date }): Idempotent =>
  async ({ claim, parse, run, replay }) => {
    if (!IDEMPOTENCY_KEY.test(claim.key)) {
      return { refusal: "invalid_idempotency_key" };
    }
    const reservation = await store.reserve({ ...claim, createdAt: now() });
    if (reservation.reserved) {
      const { response, memorable } = await executeReserved(store, { claim, run });
      if (memorable) {
        await store.complete(claim, JSON.stringify(response));
      } else {
        await store.release(claim);
      }
      return { response };
    }
    const verdict = verdictOf(reservation.stored, claim.fingerprint);
    if ("refusal" in verdict) {
      return verdict;
    }
    const stored: unknown = JSON.parse(verdict.response);
    return { response: await replay(parse(stored)) };
  };
