import type { Role } from "./space.ts";

export const ACTIONS = [
  "space.read",
  "project.create",
  "member.invite",
  "member.leave",
  "member.manage",
  "project.setFigmaFile",
  "token.create",
  "token.delete",
  "token.declareFigmaState",
  "proposal.review",
  "subscription.checkout",
] as const;

export type Action = (typeof ACTIONS)[number];

export type Membership = {
  readonly spaceId: string;
  readonly userId: string;
  readonly role: Role;
};

const PERMISSIONS: Readonly<Record<Role, ReadonlySet<Action>>> = {
  owner: new Set([
    "space.read",
    "project.create",
    "member.invite",
    "member.leave",
    "member.manage",
    "project.setFigmaFile",
    "token.create",
    "token.delete",
    "token.declareFigmaState",
    "proposal.review",
    "subscription.checkout",
  ]),
  editor: new Set([
    "space.read",
    "member.leave",
    "project.setFigmaFile",
    "token.create",
    "token.delete",
    "token.declareFigmaState",
    "proposal.review",
  ]),
};

export const can = ({
  membership,
  action,
}: {
  readonly membership: Membership | undefined;
  readonly action: Action;
}): boolean => membership !== undefined && PERMISSIONS[membership.role].has(action);

export const allowedActionsOf = (role: Role): readonly Action[] =>
  ACTIONS.filter((action) => PERMISSIONS[role].has(action));
