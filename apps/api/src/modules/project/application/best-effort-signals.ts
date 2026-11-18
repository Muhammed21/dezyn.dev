import { errorDetails, type LogSink } from "#platform/logging.ts";

import type { ProjectSignals } from "../domain/project-signals.ts";

export const bestEffortSignals = (signals: ProjectSignals, log: LogSink): ProjectSignals => {
  const bestEffort = async (projectId: string, send: () => Promise<void>) => {
    try {
      await send();
    } catch (error) {
      log({ level: "error", msg: "project signal failed", projectId, ...errorDetails(error) });
    }
  };
  return {
    changed: (signal) => bestEffort(signal.projectId, () => signals.changed(signal)),
    signalAt: (signal) => bestEffort(signal.projectId, () => signals.signalAt(signal)),
  };
};
