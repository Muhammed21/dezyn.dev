import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { LogSink } from "#platform/logging.ts";
import type { Mailer } from "#platform/mailer.ts";

import { acceptInvitation, invitedSpaceOf } from "./application/accept-invitation.ts";
import { decideStorageAlert, sendStorageAlert } from "./application/alert-storage.ts";
import { inviteMember } from "./application/invite-member.ts";
import { leaveSpace } from "./application/leave-space.ts";
import { listMembers } from "./application/list-members.ts";
import { changeRole, removeMember } from "./application/manage-members.ts";
import { projectAccess } from "./application/project-access.ts";
import { readSpace, type SpaceSubscriptions } from "./application/read-space.ts";
import { spaceAccess } from "./application/space-access.ts";
import { createPersonalSpace, listMySpaces } from "./application/spaces.ts";
import type { ProjectLocator } from "./domain/project-access.ts";
import { postgresDepartures } from "./infrastructure/postgres-departures.ts";
import { postgresInvitationAcceptance } from "./infrastructure/postgres-invitation-acceptance.ts";
import { postgresInvitationStore } from "./infrastructure/postgres-invitation-store.ts";
import { postgresInvitedSpaces } from "./infrastructure/postgres-invited-spaces.ts";
import { postgresMemberDirectory } from "./infrastructure/postgres-member-directory.ts";
import { postgresMemberList } from "./infrastructure/postgres-member-list.ts";
import { postgresMemberManagement } from "./infrastructure/postgres-member-management.ts";
import { postgresMembershipReader } from "./infrastructure/postgres-membership-reader.ts";
import { postgresSpaceStore } from "./infrastructure/postgres-space-store.ts";
import { postgresStorageAlerts } from "./infrastructure/postgres-storage-alerts.ts";

const now = () => new Date();

const newToken = () => randomBytes(32).toString("base64url");

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export const spaceModule = ({
  db,
  mailer,
  webUrl,
  log,
  subscriptions,
}: {
  readonly db: PostgresDatabase;
  readonly mailer: Mailer;
  readonly webUrl: string;
  readonly log: LogSink;
  readonly subscriptions: SpaceSubscriptions;
}) => {
  const store = postgresSpaceStore(db);
  const memberships = postgresMembershipReader(db);
  return {
    memberships,
    allowedInSpace: spaceAccess({ memberships }),
    projectAccess: (projects: ProjectLocator) => projectAccess({ projects, memberships }),
    createPersonalSpace: createPersonalSpace({ store, newId: randomUUID, now }),
    listMySpaces: listMySpaces({ store }),
    storageAlertOn: (tx: PostgresTransaction) =>
      decideStorageAlert({ alerts: postgresStorageAlerts(tx), now }),
    sendStorageAlert: sendStorageAlert({ mailer, log }),
    readSpace: readSpace({ memberships, spaces: store, subscriptions }),
    listMembers: listMembers({ memberships, members: postgresMemberList(db) }),
    inviteMember: inviteMember({
      memberships,
      spaces: store,
      members: postgresMemberDirectory(db),
      invitations: postgresInvitationStore(db),
      mailer,
      newId: randomUUID,
      newToken,
      hashToken,
      now,
      webUrl,
    }),
    invitedSpaceOf: invitedSpaceOf({ invitations: postgresInvitedSpaces(db), hashToken }),
    acceptInvitation: acceptInvitation({
      acceptance: postgresInvitationAcceptance(db),
      hashToken,
      newId: randomUUID,
      now,
    }),
    leaveSpace: leaveSpace({ departures: postgresDepartures(db), now }),
    changeRole: changeRole({ management: postgresMemberManagement(db), newId: randomUUID, now }),
    removeMember: removeMember({ management: postgresMemberManagement(db), now }),
  };
};
