import { Client } from "pg";

const ENDED_TEAM_SPACES = `SELECT s.id FROM space s
  JOIN space_subscription ss ON ss.space_id = s.id
  WHERE s.plan = 'team' AND ss.status = 'ended'
  ORDER BY s.id`;

export const endedTeamSpaces = async ({
  connectionString,
}: {
  readonly connectionString: string;
}): Promise<readonly string[]> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query<{ id: string }>(ENDED_TEAM_SPACES);
    return rows.map(({ id }) => id);
  } finally {
    await client.end();
  }
};
