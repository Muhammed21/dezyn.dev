import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import {
  historyModule,
  historyWriterOn,
  pseudonymizeAuthorOn,
} from "#modules/history/history-module.ts";
import { accountModule } from "#modules/identity/identity-module.ts";
import type { ProjectChannel } from "#modules/project/contracts/project-channel.ts";
import type { ProjectSignals } from "#modules/project/contracts/project-signals.ts";
import {
  bestEffortSignals,
  figmaFileModule,
  projectLockOn,
  projectModule,
  readProject,
  storageMeterOn,
  subscribeToProject,
} from "#modules/project/project-module.ts";
import {
  proposalModule,
  proposalReplacerOn,
  proposalWriterOn,
} from "#modules/proposal/proposal-module.ts";
import { recipeModule } from "#modules/recipe/recipe-module.ts";
import type { MembershipKey } from "#modules/space/contracts/membership.ts";
import { lastOwnerSpacesOn, orphanSpacesOn, spaceModule } from "#modules/space/space-module.ts";
import {
  type Billing,
  cancelRequestOn,
  payerAccountDeletionOn,
  spaceSubscriptionsOf,
  subscriptionModule,
} from "#modules/subscription/subscription-module.ts";
import {
  checkTokensOn,
  citationsOn,
  figmaStateOn,
  tokenModule,
  validatedTokensOn,
  validatedTokenWriterOn,
} from "#modules/token/token-module.ts";
import type { Clock } from "#platform/clock.ts";
import { idempotent } from "#platform/idempotency.ts";
import type { LogSink } from "#platform/logging.ts";
import type { Mailer } from "#platform/mailer.ts";
import { postgresIdempotencyStore } from "#platform/postgres-idempotency.ts";

export const composeModules = ({
  db,
  mailer,
  webUrl,
  log,
  billing,
  wrapHistoryWriter = (writer) => writer,
  clock = () => new Date(),
  signals = { changed: async () => undefined, signalAt: async () => undefined },
  channel = {
    connect: async () =>
      new Response(
        JSON.stringify({ type: "about:blank", title: "Temps réel indisponible", status: 503 }),
        {
          status: 503,
          headers: { "content-type": "application/problem+json" },
        },
      ),
  },
}: {
  readonly db: PostgresDatabase;
  readonly mailer: Mailer;
  readonly webUrl: string;
  readonly log: LogSink;
  readonly billing?: Billing;
  readonly wrapHistoryWriter?: (writer: HistoryWriter) => HistoryWriter;
  readonly clock?: Clock;
  readonly signals?: ProjectSignals;
  readonly channel?: ProjectChannel;
}) => {
  const spaces = spaceModule({
    db,
    mailer,
    webUrl,
    log,
    subscriptions: spaceSubscriptionsOf(db),
    departureOn: cancelRequestOn,
  });
  const writerOn = (tx: PostgresTransaction) =>
    wrapHistoryWriter(historyWriterOn(tx, storageMeterOn(tx)));
  const projectsOnly = projectModule({
    db,
    memberships: spaces.memberships,
    historyWriterOn: writerOn,
  });
  const access = spaces.projectAccess(projectsOnly.finder);
  const projectSignals = bestEffortSignals(signals, log);
  const projects = {
    ...projectsOnly,
    readProject: readProject({ access, projects: projectsOnly.reader }),
    subscribeToProject: subscribeToProject({ access, channel }),
    setFigmaFile: figmaFileModule({
      db,
      access,
      historyWriterOn: writerOn,
      signals: projectSignals,
      clock,
    }),
  };
  const history = historyModule({
    db,
    access,
    writerOn,
    signals: projectSignals,
  });
  const tokens = tokenModule({
    db,
    access,
    projectLockOn,
    historyWriterOn: writerOn,
    proposalReplacerOn,
    proposalWriterOn: (tx) => proposalWriterOn(tx, storageMeterOn(tx)),
    storageMeterOn,
    storageAlertOn: spaces.storageAlertOn,
    sendStorageAlert: spaces.sendStorageAlert,
    signals: projectSignals,
    clock,
  });
  const proposals = proposalModule({
    db,
    access,
    projectLockOn,
    checkTokensOn,
    validatedTokensOn,
    citationsOn,
    validatedTokensOf: async (projectId) => (await tokens.readTokens(projectId)).tokens,
    historyWriterOn: writerOn,
    validatedTokenWriterOn: (tx) => validatedTokenWriterOn(tx, storageMeterOn(tx)),
    figmaStateOn: (tx) => figmaStateOn(tx, storageMeterOn(tx)),
    storageMeterOn,
    storageAlertOn: spaces.storageAlertOn,
    sendStorageAlert: spaces.sendStorageAlert,
    signals: projectSignals,
    clock,
  });
  const recipes = recipeModule({ projectOf: projects.readProject, clock });
  const subscriptions = subscriptionModule({
    db,
    memberships: spaces.memberships,
    mailer,
    webUrl,
    log,
    clock,
    billing,
  });
  const account = accountModule({
    db,
    stepsOn: (tx) => ({
      ...payerAccountDeletionOn(tx),
      lastOwnerSpaces: lastOwnerSpacesOn(tx),
      orphanSpaces: orphanSpacesOn(tx),
      pseudonymizeHistory: pseudonymizeAuthorOn(tx),
    }),
    announce: subscriptions.payerDeletedAccount,
    clock,
  });
  return {
    account,
    spaces: {
      ...spaces,
      leaveSpace: async (key: MembershipKey) => {
        const left = await spaces.leaveSpace(key);
        if (left.ok) {
          await subscriptions.payerLeaves({ ...key, reason: "left" });
        }
        return left;
      },
      removeMember: async (request: Parameters<typeof spaces.removeMember>[0]) => {
        const removed = await spaces.removeMember(request);
        if (removed.ok) {
          await subscriptions.payerLeaves({
            spaceId: request.spaceId,
            userId: request.memberId,
            reason: "left",
          });
        }
        return removed;
      },
      changeRole: async (request: Parameters<typeof spaces.changeRole>[0]) => {
        const changed = await spaces.changeRole(request);
        if (
          changed.ok &&
          changed.value.previousRole === "owner" &&
          changed.value.role === "editor"
        ) {
          await subscriptions.payerLeaves({
            spaceId: request.spaceId,
            userId: request.memberId,
            reason: "demoted",
          });
        }
        return changed;
      },
    },
    subscriptions,
    projects,
    history,
    tokens,
    proposals,
    recipes,
    idempotent: idempotent({ store: postgresIdempotencyStore(db) }),
    projectAccess: access,
  };
};
