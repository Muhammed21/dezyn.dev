import type { PostgresDatabase, PostgresTransaction } from "#db";
import type { HistoryWriter } from "#modules/history/contracts/history-writer.ts";
import { historyModule, historyWriterOn } from "#modules/history/history-module.ts";
import type { ProjectChannel } from "#modules/project/contracts/project-channel.ts";
import type { ProjectSignals } from "#modules/project/contracts/project-signals.ts";
import {
  bestEffortSignals,
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
import { spaceModule } from "#modules/space/space-module.ts";
import {
  type Billing,
  spaceSubscriptionsOf,
  subscriptionModule,
} from "#modules/subscription/subscription-module.ts";
import {
  checkTokensOn,
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
  });
  const writerOn = (tx: PostgresTransaction) =>
    wrapHistoryWriter(historyWriterOn(tx, storageMeterOn(tx)));
  const projectsOnly = projectModule({
    db,
    memberships: spaces.memberships,
    historyWriterOn: writerOn,
  });
  const access = spaces.projectAccess(projectsOnly.finder);
  const projects = {
    ...projectsOnly,
    readProject: readProject({ access, projects: projectsOnly.reader }),
    subscribeToProject: subscribeToProject({ access, channel }),
  };
  const projectSignals = bestEffortSignals(signals, log);
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
  const subscriptions = subscriptionModule({
    db,
    memberships: spaces.memberships,
    webUrl,
    log,
    clock,
    billing,
  });
  return {
    spaces,
    subscriptions,
    projects,
    history,
    tokens,
    proposals,
    idempotent: idempotent({ store: postgresIdempotencyStore(db) }),
    projectAccess: access,
  };
};
