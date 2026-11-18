export interface ProjectChannel {
  connect(subscription: {
    readonly projectId: string;
    readonly request: Request;
  }): Promise<Response>;
}
