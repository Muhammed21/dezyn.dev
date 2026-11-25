import { secretVersionsInUse } from "../src/secret-versions.ts";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("DATABASE_URL manquante : URL du rôle app");
}

const versions = await secretVersionsInUse({ connectionString, now: new Date() });
console.log(versions.join("\n"));
