import { endedTeamSpaces } from "../src/ended-team-spaces.ts";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("DATABASE_URL manquante : URL du rôle app");
}

const spaces = await endedTeamSpaces({ connectionString });
console.log(spaces.join("\n"));
