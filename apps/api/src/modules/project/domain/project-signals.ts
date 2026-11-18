export type ProjectTopic = "proposals" | "history" | "tokens";

export type ProjectSignal = {
  readonly projectId: string;
  readonly topics: readonly ProjectTopic[];
};

export interface ProjectSignals {
  changed(signal: ProjectSignal): Promise<void>;
}
