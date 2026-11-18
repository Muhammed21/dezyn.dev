export type QueryTiming = {
  readonly queries: number;
  readonly durationMs: number;
};

export type Database = {
  readonly ping: () => Promise<void>;
  readonly timeQueries: (run: () => Promise<void>) => Promise<QueryTiming>;
};
