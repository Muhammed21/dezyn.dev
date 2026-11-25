export const ABSOLUTE_LIFETIME_MS = 180 * 86_400_000;

export const earliestAllowedAuthTime = (now: Date): Date =>
  new Date(now.getTime() - ABSOLUTE_LIFETIME_MS);

export const sessionEndCutsChains = ({
  expiresAt,
  now,
}: {
  readonly expiresAt: Date;
  readonly now: Date;
}): boolean => expiresAt.getTime() > now.getTime();
