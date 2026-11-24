import { Client } from "pg";

const ENDED_TEAM_SPACES = `SELECT s.id FROM space s
  JOIN space_subscription ss ON ss.space_id = s.id
  WHERE s.plan = 'team' AND ss.status = 'ended'
  ORDER BY s.id`;

type Connection = { readonly connectionString: string };

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

export const endedTeamSpaces = (connection: Connection): Promise<readonly string[]> =>
  inControlTransaction(connection, async (client) => {
    const { rows } = await client.query<{ id: string }>(ENDED_TEAM_SPACES);
    return rows.map(({ id }) => id);
  });
