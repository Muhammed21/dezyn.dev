import { dezynExtensionCarriers } from "../src/dezyn-extension-carriers.ts";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  throw new Error("DATABASE_URL manquante : URL du rôle app");
}

const carriers = await dezynExtensionCarriers({ connectionString });
console.log(carriers.join("\n"));
