import { errorDetails, type LogSink } from "#platform/logging.ts";

import type { ProjectSignals } from "../domain/project-signals.ts";

export const bestEffortSignals = (signals: ProjectSignals, log: LogSink): ProjectSignals => ({
  changed: async (signal) => {
    try {
      await signals.changed(signal);
    } catch (error) {
      log({
        level: "error",
        msg: "project signal failed",
        projectId: signal.projectId,
        ...errorDetails(error),
      });
    }
  },
});
