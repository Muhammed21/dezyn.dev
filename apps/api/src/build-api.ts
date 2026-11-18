import { composeModules } from "#compose-modules";
import { createApp } from "#create-app";
import type { PostgresDatabase } from "#db";
import { createIdentityAuth } from "#modules/identity/infrastructure/better-auth.ts";
import { durableObjectRooms, type ProjectRooms } from "#modules/project/project-module.ts";
import type { AuthSecret } from "#platform/api-config.ts";
import type { LogSink } from "#platform/logging.ts";
import type { Mailer } from "#platform/mailer.ts";

export const buildApi = async ({
  db,
  mailer,
  log,
  authSecret,
  authSecrets,
  baseURL,
  trustedIpHeader,
  webUrl,
  projectRooms,
}: {
  readonly db: PostgresDatabase;
  readonly mailer: Mailer;
  readonly log: LogSink;
  readonly authSecret: string;
  readonly authSecrets?: readonly AuthSecret[];
  readonly baseURL: string;
  readonly trustedIpHeader: string;
  readonly webUrl: string;
  readonly projectRooms?: ProjectRooms;
}) => {
  const modules = composeModules({
    db,
    mailer,
    webUrl,
    log,
    ...(projectRooms === undefined ? {} : durableObjectRooms(projectRooms)),
  });
  const auth = await createIdentityAuth({
    webUrl,
    db,
    secret: authSecret,
    secrets: authSecrets,
    baseURL,
    trustedIpHeader,
    log,
    onUserCreated: modules.spaces.createPersonalSpace,
  });
  return { app: createApp({ webUrl, db, auth, log, ...modules }), modules };
};
