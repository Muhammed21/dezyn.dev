import { ABSOLUTE_LIFETIME_MS } from "./refresh-chain.ts";

export type StoredRefreshToken = {
  readonly revoked: Date | null;
  readonly rotationReplayExpiresAt: Date | null;
  readonly authTime: Date | null;
  readonly sessionId: string | null;
};

export type RefreshGrantOutcome =
  | "allowed"
  | "cut"
  | "reuse"
  | "orphaned"
  | "withdrawn"
  | "expired";

const withinReplayWindow = ({ rotationReplayExpiresAt }: StoredRefreshToken, now: Date) =>
  rotationReplayExpiresAt !== null && rotationReplayExpiresAt.getTime() >= now.getTime();

const isReuse = (token: StoredRefreshToken, now: Date) =>
  token.revoked !== null && !withinReplayWindow(token, now);

const exceedsAbsoluteLifetime = ({ authTime }: StoredRefreshToken, now: Date) =>
  authTime === null || now.getTime() - authTime.getTime() > ABSOLUTE_LIFETIME_MS;

export const refreshGrantOutcome = ({
  token,
  consented,
  cut,
  now,
}: {
  readonly token: StoredRefreshToken;
  readonly consented: boolean;
  readonly cut: boolean;
  readonly now: Date;
}): RefreshGrantOutcome => {
  if (cut) {
    return "cut";
  }
  if (isReuse(token, now)) {
    return "reuse";
  }
  if (token.sessionId === null) {
    return "orphaned";
  }
  if (!consented) {
    return "withdrawn";
  }
  return exceedsAbsoluteLifetime(token, now) ? "expired" : "allowed";
};
