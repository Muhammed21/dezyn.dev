import { Client } from "pg";

export type Connection = { readonly connectionString: string };

export const inControlTransaction = async <T>(
  { connectionString }: Connection,
  run: (client: Client) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    return await run(client);
  } finally {
    await client.end();
  }
};
