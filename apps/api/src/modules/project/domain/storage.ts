const encoder = new TextEncoder();

export const storedSize = (row: object): number => encoder.encode(JSON.stringify(row)).length;

export interface StorageMeter {
  add(projectId: string, rows: readonly object[]): Promise<void>;
  addBytes(projectId: string, bytes: number): Promise<void>;
  remove(projectId: string, rows: readonly object[]): Promise<void>;
  removeBytes(projectId: string, bytes: number): Promise<void>;
  resize(
    projectId: string,
    rows: { readonly removed: readonly object[]; readonly added: readonly object[] },
  ): Promise<void>;
}
