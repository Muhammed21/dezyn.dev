export type SpaceRef = { readonly id: string; readonly name: string };

export type PaidSpace = SpaceRef & { readonly currentPeriodEnd: Date | undefined };

export type AccountDeletion = {
  readonly paidSpaces: readonly PaidSpace[];
  readonly lastOwnerSpaces: readonly SpaceRef[];
};

export type AccountDeletionFailure = "unauthenticated" | "unavailable" | "invalid_response";

export type DeleteAccountFailure =
  | { readonly kind: "last_owner"; readonly spaces: readonly SpaceRef[] }
  | { readonly kind: AccountDeletionFailure };
