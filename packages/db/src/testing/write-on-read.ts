import { asAdminOn } from "./clients.ts";

type WriteOnRead = {
  readonly databaseUrl: string;
  readonly readTable: string;
  readonly reader: string;
  readonly write: string;
};

export const READ_ONLY_REFUSAL = "cannot execute INSERT in a read-only transaction";

export const seedWriteOnRead = async ({ databaseUrl, readTable, reader, write }: WriteOnRead) => {
  await asAdminOn(
    databaseUrl,
    `CREATE FUNCTION public.write_on_read() RETURNS boolean LANGUAGE sql AS $$ ${write}; SELECT true $$`,
  );
  await asAdminOn(databaseUrl, `ALTER TABLE ${readTable} ENABLE ROW LEVEL SECURITY`);
  await asAdminOn(databaseUrl, `ALTER TABLE ${readTable} FORCE ROW LEVEL SECURITY`);
  await asAdminOn(
    databaseUrl,
    `CREATE POLICY write_on_read ON ${readTable} FOR SELECT TO ${reader} USING (public.write_on_read())`,
  );
};
