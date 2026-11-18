export type ProjectTopic = "proposals" | "history" | "tokens";

export type ProjectSignal = {
  readonly projectId: string;
  readonly topics: readonly ProjectTopic[];
};

export type ScheduledProjectSignal = ProjectSignal & {
  readonly key: string;
  readonly at: Date;
};

export interface ProjectSignals {
  changed(signal: ProjectSignal): Promise<void>;
  signalAt(signal: ScheduledProjectSignal): Promise<void>;
}
