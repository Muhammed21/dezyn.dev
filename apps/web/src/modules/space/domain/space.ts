const PLANS = ["free", "team"] as const;

const ROLES = ["owner", "editor"] as const;

const ACTIONS = [
  "space.read",
  "project.create",
  "member.invite",
  "member.leave",
  "member.manage",
  "token.create",
  "token.declareFigmaState",
  "proposal.review",
  "subscription.checkout",
] as const;

const SUBSCRIPTION_STATUSES = ["active", "canceling", "past_due", "ended"] as const;

export type Plan = (typeof PLANS)[number] | "unknown";

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number] | "unknown";

export type Role = (typeof ROLES)[number] | "unknown";

export type Action = (typeof ACTIONS)[number];

export type Space = {
  readonly id: string;
  readonly name: string;
  readonly plan: Plan;
  readonly role: Role;
  readonly allowedActions: readonly Action[];
};

export type SpaceStorage = {
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly alertReached: boolean;
};

export type SpaceSubscription = { readonly status: SubscriptionStatus };

export type SpaceWithStorage = Space & {
  readonly storage: SpaceStorage;
  readonly subscription?: SpaceSubscription;
};

export type SpaceFailure = "unauthenticated" | "not_found" | "unavailable" | "invalid_response";

export type SpaceMember = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
};

export type MembersFailure = SpaceFailure;

export type RemovalFailure =
  | "unauthenticated"
  | "not_found"
  | "forbidden"
  | "self_removal"
  | "unavailable"
  | "invalid_response";

export type AcceptanceFailure =
  | "unauthenticated"
  | "gone"
  | "email_mismatch"
  | "already_member"
  | "plan_required"
  | "unavailable"
  | "invalid_response";

export type SentInvitation = {
  readonly id: string;
  readonly email: string;
  readonly expiresAt: Date;
};

export type InvitationFailure =
  | "unauthenticated"
  | "not_found"
  | "invalid_email"
  | "forbidden"
  | "plan_required"
  | "already_member"
  | "unavailable"
  | "invalid_response";

export type Checkout = { readonly url: string };

export type CheckoutFailure =
  | "unauthenticated"
  | "not_found"
  | "forbidden"
  | "already_team"
  | "unavailable"
  | "invalid_response";

export type AssignableRole = (typeof ROLES)[number];

export type ChangedRole = {
  readonly userId: string;
  readonly role: Role;
};

export type RoleChangeFailure =
  | "unauthenticated"
  | "not_found"
  | "forbidden"
  | "last_owner"
  | "unavailable"
  | "invalid_response";

export const planOf = (value: string): Plan => PLANS.find((plan) => plan === value) ?? "unknown";

export const subscriptionStatusOf = (value: string): SubscriptionStatus =>
  SUBSCRIPTION_STATUSES.find((status) => status === value) ?? "unknown";

export const roleOf = (value: string): Role => ROLES.find((role) => role === value) ?? "unknown";

export const knownActionsOf = (values: readonly string[]): readonly Action[] =>
  ACTIONS.filter((action) => values.includes(action));
