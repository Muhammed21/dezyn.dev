export type ProjectTopic = "proposals";

export type ProjectSignal = {
  readonly projectId: string;
  readonly topics: readonly ProjectTopic[];
};

export interface ProjectSignals {
  changed(signal: ProjectSignal): Promise<void>;
}
