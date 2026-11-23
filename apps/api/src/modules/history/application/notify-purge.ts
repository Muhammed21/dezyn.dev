import { purgeLimitOf } from "#modules/space/contracts/storage-limit.ts";
import { errorDetails, type LogSink } from "#platform/logging.ts";
import type { Mailer } from "#platform/mailer.ts";

import { purgeNoticeOf } from "../domain/purge-notice.ts";
import type { PurgedSpace, SpaceStorage } from "./purge-history.ts";

export type PurgeRecipients = SpaceStorage & { readonly owners: readonly string[] };

export interface PurgeNotices {
  recipientsOf(spaceId: string): Promise<PurgeRecipients>;
}

export const notifyPurge =
  ({
    notices,
    mailer,
    log,
  }: {
    readonly notices: PurgeNotices;
    readonly mailer: Mailer;
    readonly log: LogSink;
  }) =>
  async ({ spaceId, name, projects }: PurgedSpace): Promise<void> => {
    try {
      const { owners, ...storage } = await notices.recipientsOf(spaceId);
      const notice = purgeNoticeOf({
        spaceName: name,
        plan: storage.plan,
        storedBytes: storage.usage.storedBytes,
        limitBytes: purgeLimitOf(storage),
        projects,
      });
      await Promise.all(
        owners.map(async (to) => {
          const sent = await mailer.send({ to, ...notice });
          if (!sent.ok) {
            log({
              level: "error",
              msg: "history_purge_email_unsent",
              spaceId,
              to,
              error: sent.error,
            });
          }
        }),
      );
    } catch (error) {
      log({ level: "error", msg: "history_purge_notice_failed", spaceId, ...errorDetails(error) });
    }
  };
