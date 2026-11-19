import { err, ok, type Result } from "@repo/result";

import {
  type AcceptanceFacts,
  type AcceptanceRefusal,
  acceptanceRefusal,
  INVITEE_ROLE,
} from "../domain/acceptance.ts";
import { type MySpace, mySpaceOf, type Role, type SpaceWithRole } from "../domain/space.ts";

export type NewMember = { readonly id: string; readonly role: Role; readonly joinedAt: Date };

export type AcceptanceDecision = (
  facts: Omit<AcceptanceFacts, "now">,
) => Result<NewMember, AcceptanceRefusal>;

export interface InvitationAcceptance {
  accept(
    request: { readonly tokenHash: string; readonly userId: string },
    decide: AcceptanceDecision,
  ): Promise<Result<SpaceWithRole, AcceptanceRefusal>>;
}

export interface InvitedSpaces {
  spaceOf(tokenHash: string): Promise<string | undefined>;
}

export const invitedSpaceOf =
  ({
    invitations,
    hashToken,
  }: {
    readonly invitations: InvitedSpaces;
    readonly hashToken: (token: string) => string;
  }) =>
  (token: string): Promise<string | undefined> =>
    invitations.spaceOf(hashToken(token));

export const acceptInvitation =
  ({
    acceptance,
    hashToken,
    newId,
    now,
  }: {
    readonly acceptance: InvitationAcceptance;
    readonly hashToken: (token: string) => string;
    readonly newId: () => string;
    readonly now: () => Date;
  }) =>
  async ({
    token,
    userId,
  }: {
    readonly token: string;
    readonly userId: string;
  }): Promise<Result<MySpace, AcceptanceRefusal>> => {
    const at = now();
    const accepted = await acceptance.accept({ tokenHash: hashToken(token), userId }, (facts) => {
      const refusal = acceptanceRefusal({ ...facts, now: at });
      return refusal === undefined
        ? ok({ id: newId(), role: INVITEE_ROLE, joinedAt: at })
        : err(refusal);
    });
    return accepted.ok ? ok(mySpaceOf(accepted.value)) : accepted;
  };
