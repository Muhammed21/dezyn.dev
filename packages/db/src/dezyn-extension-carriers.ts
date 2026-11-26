import { type Connection, inControlTransaction } from "./control-transaction.ts";

const DEZYN_EXTENSION_CARRIERS = `SELECT 'token ' || id AS carrier FROM token
    WHERE extensions ? 'dev.dezyn'
  UNION ALL
  SELECT 'proposal ' || id AS carrier FROM proposal
    WHERE payload -> '$extensions' ? 'dev.dezyn'
  ORDER BY carrier`;

export const dezynExtensionCarriers = (connection: Connection): Promise<readonly string[]> =>
  inControlTransaction(connection, async (client) => {
    const { rows } = await client.query<{ carrier: string }>(DEZYN_EXTENSION_CARRIERS);
    return rows.map(({ carrier }) => carrier);
  });
