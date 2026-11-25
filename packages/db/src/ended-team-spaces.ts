import { type Connection, inControlTransaction } from "./control-transaction.ts";

const ENDED_TEAM_SPACES = `SELECT s.id FROM space s
  JOIN space_subscription ss ON ss.space_id = s.id
  WHERE s.plan = 'team' AND ss.status = 'ended'
  ORDER BY s.id`;

export const endedTeamSpaces = (connection: Connection): Promise<readonly string[]> =>
  inControlTransaction(connection, async (client) => {
    const { rows } = await client.query<{ id: string }>(ENDED_TEAM_SPACES);
    return rows.map(({ id }) => id);
  });
