import { describe, expect, it } from "vitest";

import { rejectedStatements } from "../rejected-statements.ts";

describe("rejectedStatements", () => {
  it("accepte la création d'une table", () => {
    expect(rejectedStatements(`CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`)).toEqual(
      [],
    );
  });

  it.each([
    `CREATE INDEX "token_project_id_idx" ON "token" USING btree ("project_id")`,
    `CREATE UNIQUE INDEX "proposal_pending_key" ON "proposal" USING btree ("project_id")`,
    `CREATE TYPE "status" AS ENUM('open', 'closed')`,
    `CREATE SCHEMA "audit"`,
    `GRANT SELECT, INSERT ON "token" TO app`,
    `create index "token_name_idx" on "token" ("name")`,
  ])("accepte l'instruction additive %s", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([]);
  });

  it.each([
    `ALTER TABLE "token" ADD COLUMN "extensions" jsonb`,
    `ALTER TABLE "project" ADD COLUMN "stored_bytes" bigint DEFAULT 0 NOT NULL`,
    `ALTER TABLE "proposal" ADD COLUMN "amount" numeric(10, 2)`,
  ])("accepte l'ajout d'une colonne nullable ou avec une valeur par défaut : %s", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([]);
  });

  it("refuse l'ajout d'une colonne NOT NULL sans valeur par défaut à une table existante", () => {
    const statement = `ALTER TABLE "token" ADD COLUMN "kind" text NOT NULL`;

    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it("refuse un ALTER TABLE qui ajoute une colonne et en supprime une autre", () => {
    const statement = `ALTER TABLE "token" ADD COLUMN "kind" text, DROP COLUMN "type"`;

    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it("accepte tout ALTER sur une table créée dans la même migration", () => {
    const sql = [
      `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL, "project_id" uuid NOT NULL);`,
      `ALTER TABLE "palette" ADD CONSTRAINT "palette_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id");`,
      `ALTER TABLE "public"."palette" ALTER COLUMN "project_id" DROP NOT NULL;`,
    ].join("--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([]);
  });

  it("refuse un ALTER autre qu'un ajout de colonne sur une table existante", () => {
    const sql = [
      `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`,
      `ALTER TABLE "token" ADD CONSTRAINT "token_palette_fk" FOREIGN KEY ("id") REFERENCES "palette"("id");`,
    ].join("--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([
      `ALTER TABLE "token" ADD CONSTRAINT "token_palette_fk" FOREIGN KEY ("id") REFERENCES "palette"("id")`,
    ]);
  });

  it("refuse une instruction écrite après une autre sans séparateur Drizzle", () => {
    const sql = `GRANT SELECT ON "token" TO app; DROP TABLE "token";`;

    expect(rejectedStatements(sql)).toEqual([`DROP TABLE "token"`]);
  });

  it("ne coupe pas une instruction sur un point-virgule entre guillemets", () => {
    const sql = `ALTER TABLE "token" ADD COLUMN "separator" text DEFAULT ';' NOT NULL;`;

    expect(rejectedStatements(sql)).toEqual([]);
  });

  it("garde une fonction plpgsql entière, sans la couper sur les points-virgules de son corps", () => {
    const sql = `CREATE FUNCTION fill() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  NEW.size := 1;\n  RETURN NEW;\nEND;\n$$;`;

    expect(rejectedStatements(sql)).toEqual([
      "CREATE FUNCTION fill() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.size := 1; RETURN NEW; END; $$",
    ]);
  });

  it("reprend le découpage après la fin d'un corps $$", () => {
    const sql = `CREATE FUNCTION one() RETURNS integer LANGUAGE sql AS $$ SELECT 1; $$; DROP TABLE "token";`;

    expect(rejectedStatements(sql)).toEqual([
      "CREATE FUNCTION one() RETURNS integer LANGUAGE sql AS $$ SELECT 1; $$",
      `DROP TABLE "token"`,
    ]);
  });

  it("garde les guillemets et les tirets d'un corps $$ comme du texte", () => {
    const sql = `CREATE FUNCTION label() RETURNS text LANGUAGE sql AS $$ SELECT 'l''app -- ; "x' $$;`;

    expect(rejectedStatements(sql)).toEqual([
      `CREATE FUNCTION label() RETURNS text LANGUAGE sql AS $$ SELECT 'l''app -- ; "x' $$`,
    ]);
  });

  it("ne prend pas un $$ entre guillemets pour le début d'un corps", () => {
    const sql = `COMMENT ON TABLE "token" IS '$$'; DROP TABLE "token";`;

    expect(rejectedStatements(sql)).toEqual([
      `COMMENT ON TABLE "token" IS '$$'`,
      `DROP TABLE "token"`,
    ]);
  });

  it.each([
    `CREATE INDEX "i" ON "t" (a$$b)`,
    `GRANT SELECT ON a$$b TO app`,
    `GRANT SELECT ON é$$b TO app`,
    `GRANT SELECT ON €$$b TO app`,
  ])("ne prend pas le $$ d'un identifiant pour le début d'un corps : %s", (statement) => {
    expect(rejectedStatements(`${statement}; DROP TABLE "t";`)).toEqual([`DROP TABLE "t"`]);
  });

  it.each([
    "body",
    "fn",
    "_corps2",
    "Fn",
    "étiquette",
    "_é1",
    "corps_à2",
    "€",
    "😀",
    "a€1",
    "a😀1",
    "𝒜",
  ])("garde un corps $%s$ entier et refuse le DROP qui le suit", (label) => {
    const tag = `$${label}$`;
    const sql = `CREATE FUNCTION one() RETURNS integer LANGUAGE sql AS ${tag} SELECT 1; ${tag}; DROP TABLE "t";`;

    expect(rejectedStatements(sql)).toEqual([
      `CREATE FUNCTION one() RETURNS integer LANGUAGE sql AS ${tag} SELECT 1; ${tag}`,
      `DROP TABLE "t"`,
    ]);
  });

  it.each(["$b$", "$$", "$ab$", "$A$", "$a", "'", '"', "--"])(
    "ne ferme un corps $a$ que sur $a$, pas sur %s",
    (inner) => {
      const sql = `DO $a$ SELECT ${inner}; DROP TABLE "x"; ${inner} $a$; DROP TABLE "t";`;

      expect(rejectedStatements(sql)).toEqual([
        `DO $a$ SELECT ${inner}; DROP TABLE "x"; ${inner} $a$`,
        `DROP TABLE "t"`,
      ]);
    },
  );

  it.each([
    `CREATE INDEX "i" ON "t" (a$tag$b)`,
    `GRANT SELECT ON a$tag$b TO app`,
    `GRANT SELECT ON é$tag$b TO app`,
    `GRANT SELECT ON 😀$tag$b TO app`,
    `GRANT SELECT ON 𝒜$tag$b TO app`,
    `GRANT SELECT ON 𝒳$tag$b TO app`,
  ])("ne prend pas le $tag$ d'un identifiant pour le début d'un corps : %s", (statement) => {
    expect(rejectedStatements(`${statement}; DROP TABLE "t";`)).toEqual([`DROP TABLE "t"`]);
  });

  it.each(["$1$", "$1a$", "$a-b$", "$ $", "$1é$", "$é-b$"])(
    "ne prend pas %s pour un délimiteur de corps",
    (text) => {
      const sql = `PREPARE q AS SELECT ${text}; DROP TABLE "t"; PREPARE r AS SELECT ${text};`;

      expect(rejectedStatements(sql)).toEqual([
        `PREPARE q AS SELECT ${text}`,
        `DROP TABLE "t"`,
        `PREPARE r AS SELECT ${text}`,
      ]);
    },
  );

  it("garde dans l'instruction tout ce qui suit un corps $tag$ jamais fermé", () => {
    const sql = `DO $tag$ SELECT 1; DROP TABLE "t";`;

    expect(rejectedStatements(sql)).toEqual([`DO $tag$ SELECT 1; DROP TABLE "t";`]);
  });

  it("garde dans l'instruction tout ce qui suit un corps $$ jamais fermé", () => {
    const sql = `DO $$ SELECT 1; DROP TABLE "t";`;

    expect(rejectedStatements(sql)).toEqual([`DO $$ SELECT 1; DROP TABLE "t";`]);
  });

  it("ne coupe pas une chaîne d'échappement E'…' sur son point-virgule", () => {
    expect(rejectedStatements(`COMMENT ON TABLE "t" IS E'a;b'; DROP TABLE "t";`)).toEqual([
      `COMMENT ON TABLE "t" IS E'a;b'`,
      `DROP TABLE "t"`,
    ]);
  });

  it("ne prend pas un $$ en commentaire pour le début d'un corps", () => {
    const sql = `-- Fonction en $$\nGRANT SELECT ON "token" TO app; DROP TABLE "token";`;

    expect(rejectedStatements(sql)).toEqual([`DROP TABLE "token"`]);
  });

  it("ne prend pas un signe moins pour un commentaire", () => {
    const statement = `UPDATE "token" SET "position" = "position" - 1`;

    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it("refuse une virgule de premier niveau après un type à paramètres", () => {
    const statement = `ALTER TABLE "proposal" ADD COLUMN "amount" numeric(10, 2), DROP COLUMN "kind"`;

    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it.each([`'('`, `'(à compléter'`])(
    "ne laisse pas une parenthèse dans la chaîne %s masquer une seconde action",
    (text) => {
      const statement = `ALTER TABLE "users" ADD COLUMN "note" text DEFAULT ${text}, DROP COLUMN "email"`;

      expect(rejectedStatements(`${statement};`)).toEqual([statement]);
    },
  );

  it("ne prend pas une colonne nommée « default » pour une valeur par défaut", () => {
    const statement = `ALTER TABLE "users" ADD COLUMN "default" text NOT NULL`;

    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it("ne coupe pas une instruction sur un point-virgule dans un identifiant entre guillemets", () => {
    expect(rejectedStatements(`ALTER TABLE "token" ADD COLUMN "odd;name" text;`)).toEqual([]);
  });

  it("refuse le retrait d'un droit de transmettre un privilège", () => {
    const statement = `REVOKE GRANT OPTION FOR SELECT ON "token" FROM app`;

    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it("ne se laisse pas tromper par une instruction additive citée dans une autre", () => {
    const sql = [
      `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`,
      `COMMENT ON TABLE "token" IS 'CREATE TABLE "token" (), CREATE INDEX, CREATE TYPE, CREATE SCHEMA, GRANT, ALTER TABLE "palette" ADD COLUMN "x" text';`,
      `ALTER TABLE "token" DROP COLUMN "description";`,
    ].join("--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([
      `COMMENT ON TABLE "token" IS 'CREATE TABLE "token" (), CREATE INDEX, CREATE TYPE, CREATE SCHEMA, GRANT, ALTER TABLE "palette" ADD COLUMN "x" text'`,
      `ALTER TABLE "token" DROP COLUMN "description"`,
    ]);
  });

  it("reconnaît une table créée dans la migration sous son nom qualifié sans guillemets", () => {
    const sql = [
      `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`,
      `ALTER TABLE public.palette ADD CONSTRAINT "palette_id_check" CHECK ("id" IS NOT NULL);`,
    ].join("--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([]);
  });

  it("ne confond pas une table créée avec une table de même nom dans un autre schéma", () => {
    const sql = [
      `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`,
      `ALTER TABLE "audit"."palette" DROP COLUMN "id";`,
    ].join("--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([`ALTER TABLE "audit"."palette" DROP COLUMN "id"`]);
  });

  it('ne prend pas un schéma nommé « "public » pour le schéma public', () => {
    const sql = [
      `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`,
      `ALTER TABLE """public".palette DROP COLUMN "id";`,
    ].join("--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([`ALTER TABLE """public".palette DROP COLUMN "id"`]);
  });

  it("nomme une instruction écrite sur plusieurs lignes sur une seule ligne", () => {
    const sql = `ALTER TABLE "token"\n\tADD COLUMN  "kind" text\n\tNOT NULL;`;

    expect(rejectedStatements(sql)).toEqual([
      `ALTER TABLE "token" ADD COLUMN "kind" text NOT NULL`,
    ]);
  });

  it("ignore les commentaires, y compris un bloc qui n'en contient que", () => {
    const sql = [
      `-- L'app lit les tokens.\nGRANT SELECT ON "token" TO app;`,
      `-- Une note de fin de migration.\n`,
    ].join("--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([]);
  });

  it("nomme une instruction refusée sans le commentaire qui la précède", () => {
    const sql = `-- L'app ne supprime plus d'historique.\nREVOKE DELETE ON "history_entry" FROM app;`;

    expect(rejectedStatements(sql)).toEqual([`REVOKE DELETE ON "history_entry" FROM app`]);
  });

  it("refuse la suppression d'une colonne en la nommant", () => {
    const sql = [
      `CREATE TABLE "palette" ("id" uuid PRIMARY KEY NOT NULL);`,
      `ALTER TABLE "token" DROP COLUMN "description";`,
    ].join("\n--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([`ALTER TABLE "token" DROP COLUMN "description"`]);
  });
});

describe("rejectedStatements sur les chaînes, identifiants et commentaires de PostgreSQL", () => {
  it("refuse le DROP TABLE caché derrière un \\' dans une chaîne E'…'", () => {
    const sql = String.raw`ALTER TABLE "t" ADD COLUMN "c" text DEFAULT E'\''; DROP TABLE "t"; --';`;

    expect(rejectedStatements(sql)).toEqual([`DROP TABLE "t"`]);
  });

  it.each([String.raw`E'a\\'`, String.raw`e'a\\'`, String.raw`E'\\\''`, String.raw`E'l''app'`])(
    "coupe en deux instructions la chaîne d'échappement %s suivie d'une autre instruction",
    (text) => {
      const sql = `COMMENT ON TABLE "t" IS ${text}; DROP TABLE "t";`;

      expect(rejectedStatements(sql)).toEqual([
        `COMMENT ON TABLE "t" IS ${text}`,
        `DROP TABLE "t"`,
      ]);
    },
  );

  it("garde dans une chaîne E'…' le point-virgule qui suit un guillemet doublé", () => {
    const sql = `COMMENT ON TABLE "t" IS E'l''app; DROP TABLE "x"'; DROP TABLE "t";`;

    expect(rejectedStatements(sql)).toEqual([
      `COMMENT ON TABLE "t" IS E'l''app; DROP TABLE "x"'`,
      `DROP TABLE "t"`,
    ]);
  });

  it.each(["1E", "1.5e", "E"])(
    "lit une chaîne d'échappement dans %s'…', comme PostgreSQL après un nombre",
    (prefix) => {
      const sql = `ALTER TABLE "t" ADD COLUMN "c" int DEFAULT ${prefix}'\\''; DROP TABLE "t"; --';`;

      expect(rejectedStatements(sql)).toEqual([`DROP TABLE "t"`]);
    },
  );

  it.each([
    String.raw`'a\'`,
    String.raw`date'\'`,
    String.raw`"E"'\'`,
    String.raw`aE'\'`,
    String.raw`_e'\'`,
    String.raw`N'\'`,
    String.raw`U&'\'`,
    String.raw`en'\'`,
  ])("n'échappe rien par \\ dans la chaîne ordinaire %s", (text) => {
    const sql = `COMMENT ON TABLE "t" IS ${text}; DROP TABLE "t"; --';`;

    expect(rejectedStatements(sql)).toEqual([`COMMENT ON TABLE "t" IS ${text}`, `DROP TABLE "t"`]);
  });

  it.each(["\n", " \n\t", " -- suite\n", "\n-- note\n  ", "\r"])(
    "continue une chaîne E'…' sur la ligne suivante, après %j",
    (between) => {
      const sql = `ALTER TABLE "t" ADD COLUMN "c" text DEFAULT E'a'${between}'\\''; DROP TABLE "t"; --';`;

      expect(rejectedStatements(sql)).toEqual([`DROP TABLE "t"`]);
    },
  );

  it("garde ordinaire la suite d'une chaîne ordinaire sur la ligne suivante", () => {
    const sql = `COMMENT ON TABLE "t" IS 'a'\n'\\'; DROP TABLE "t";`;

    expect(rejectedStatements(sql)).toEqual([
      String.raw`COMMENT ON TABLE "t" IS 'a' '\'`,
      `DROP TABLE "t"`,
    ]);
  });

  it.each([" ", " /* x */\n"])("ne continue pas une chaîne E'…' après %j", (between) => {
    const sql = `COMMENT ON TABLE "t" IS E'a'${between}'\\'; DROP TABLE "t"; --';`;

    expect(rejectedStatements(sql)).toEqual([
      String.raw`COMMENT ON TABLE "t" IS E'a' '\'`,
      `DROP TABLE "t"`,
    ]);
  });

  it("analyse sans délai une chaîne suivie de longs espaces et commentaires jamais suivis d'une chaîne", () => {
    const sql = `COMMENT ON TABLE "t" IS 'a'${" --".repeat(40)}${" ".repeat(40)}x\n${" ".repeat(40)}x;`;

    expect(rejectedStatements(sql)).toEqual([`COMMENT ON TABLE "t" IS 'a' x`]);
  });

  it.each([
    `GRANT\vSELECT ON "t" TO app`,
    `ALTER TABLE "t" ADD COLUMN "c" text DEFAULT E'a'\v\n'b'`,
  ])("refuse l'instruction %j qui a une tabulation verticale hors d'une chaîne", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([statement.replaceAll(/\s+/g, " ")]);
  });

  it("accepte une tabulation verticale dans une chaîne", () => {
    expect(rejectedStatements(`ALTER TABLE "t" ADD COLUMN "c" text DEFAULT '\v';`)).toEqual([]);
  });

  it("n'échappe rien par \\ dans un corps $$", () => {
    const sql = String.raw`DO $$ SELECT E'\'; $$; DROP TABLE "t";`;

    expect(rejectedStatements(sql)).toEqual([String.raw`DO $$ SELECT E'\'; $$`, `DROP TABLE "t"`]);
  });

  it.each([`"a"";--"`, `"a"";b"`, `"""x"`])(
    "garde entier l'identifiant à guillemets doublés %s",
    (identifier) => {
      const sql = `GRANT SELECT ON ${identifier} TO app; DROP TABLE "t";`;

      expect(rejectedStatements(sql)).toEqual([`DROP TABLE "t"`]);
    },
  );

  it.each([
    `/* ; DROP TABLE "x"; */ GRANT SELECT ON "t" TO app;`,
    `/* a /* b */ ; DROP TABLE "x"; */ GRANT SELECT ON "t" TO app;`,
    `/* ' " $$ -- */ GRANT SELECT ON "t" TO app;`,
    `GRANT/**/SELECT/* , DELETE */ON "t" TO app;`,
    `/**/GRANT SELECT ON "t" TO app;/***/`,
  ])("ignore le commentaire /* */ de %s", (sql) => {
    expect(rejectedStatements(sql)).toEqual([]);
  });

  it.each([
    [`/* -- */ DROP TABLE "t";`, `DROP TABLE "t"`],
    [`-- /*\nDROP TABLE "t";`, `DROP TABLE "t"`],
    [`/* /* */ */ DROP TABLE "t";`, `DROP TABLE "t"`],
    [`/* ' */ DROP TABLE "t"; -- '`, `DROP TABLE "t"`],
    [`DROP/* x */TABLE "t";`, `DROP TABLE "t"`],
    [`DROP TABLE "t" -- fin\r;`, `DROP TABLE "t"`],
  ])("voit l'instruction que PostgreSQL exécute dans %j", (sql, statement) => {
    expect(rejectedStatements(sql)).toEqual([statement]);
  });

  it("ne prend pas un /* entre guillemets pour un commentaire", () => {
    const sql = `COMMENT ON TABLE "t" IS '/*'; DROP TABLE "t"; -- */`;

    expect(rejectedStatements(sql)).toEqual([`COMMENT ON TABLE "t" IS '/*'`, `DROP TABLE "t"`]);
  });

  it.each([
    [`GRANT SELECT ON "t" TO app; /* DROP TABLE "t";`, `/* DROP TABLE "t";`],
    [`GRANT SELECT ON "t" TO app; /* /* */ DROP TABLE "t";`, `/* /* */ DROP TABLE "t";`],
    [`GRANT SELECT ON "t TO app;`, `GRANT SELECT ON "t TO app;`],
    [`GRANT SELECT ON "t" TO app; COMMENT ON TABLE "t" IS 'x;`, `COMMENT ON TABLE "t" IS 'x;`],
    [
      `GRANT SELECT ON "t" TO app; COMMENT ON TABLE "t" IS E'x\\';`,
      `COMMENT ON TABLE "t" IS E'x\\';`,
    ],
  ])("refuse l'instruction de %j, jamais fermée", (sql, statement) => {
    expect(rejectedStatements(sql)).toEqual([statement]);
  });

  it("refuse un ALTER TABLE dont une chaîne E'…' cache une seconde action", () => {
    const statement = String.raw`ALTER TABLE "t" ADD COLUMN "c" text DEFAULT E'\'', DROP COLUMN "x", ADD COLUMN "d" text DEFAULT 'a'`;

    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it("refuse un ALTER TABLE dont le nom de table entre guillemets contient « ADD COLUMN »", () => {
    const statement = `ALTER TABLE "x ADD COLUMN c text" DROP COLUMN "y"`;

    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it.each([
    [`CREATE TABLE "token x" ("id" uuid);`, `ALTER TABLE "token" DROP COLUMN "id"`],
    [`CREATE TABLE Token ("id" uuid);`, `ALTER TABLE "Token" DROP COLUMN "id"`],
    [`CREATE TABLE IF NOT EXISTS "token" ("id" uuid);`, `ALTER TABLE "token" DROP COLUMN "id"`],
    [`CREATE TABLE "token" AS SELECT 1;`, `ALTER TABLE "token" DROP COLUMN "id"`],
    [`CREATE TABLE "a"."b" ("id" uuid);`, `ALTER TABLE "a" DROP COLUMN "id"`],
    [`CREATE TABLE "a" ("id" uuid);`, `ALTER TABLE "a"."b" DROP COLUMN "id"`],
    [`CREATE TABLE "a.b" ("id" uuid);`, `ALTER TABLE "a"."b" DROP COLUMN "id"`],
    [`CREATE TABLE "a" ("id" uuid);`, `ALTER TABLE "a". DROP COLUMN "id"`],
    [`CREATE TABLE "audit"."a" ("id" uuid);`, `ALTER TABLE "other"."a" DROP COLUMN "id"`],
    [`CREATE TABLE "a" ("id" uuid);`, `DROP TABLE "a"`],
    [`CREATE TABLE "a" ("id" uuid);`, `ALTER TABLE 'a' DROP COLUMN "id"`],
    [`CREATE TABLE "public"."a"."b" ("id" uuid);`, `ALTER TABLE "a"."b" DROP COLUMN "id"`],
  ])("ne tient pas %s pour la création de la table de « %s »", (create, alter) => {
    expect(rejectedStatements(`${create}\n--> statement-breakpoint\n${alter};`)).toEqual([alter]);
  });

  it("ne retient aucune table créée d'un CREATE TABLE sans nom lisible", () => {
    const sql = `CREATE TABLE ("id" uuid);\n--> statement-breakpoint\nALTER TABLE "a" DROP COLUMN "id";`;

    expect(rejectedStatements(sql)).toEqual([`ALTER TABLE "a" DROP COLUMN "id"`]);
  });

  it("ne tient pas une fonction du nom d'une table pour la création de cette table", () => {
    const sql = [
      `CREATE FUNCTION "token"() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;`,
      `ALTER TABLE "token" DROP COLUMN "id";`,
    ].join("--> statement-breakpoint\n");

    expect(rejectedStatements(sql)).toEqual([
      `CREATE FUNCTION "token"() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$`,
      `ALTER TABLE "token" DROP COLUMN "id"`,
    ]);
  });

  it.each([
    [`CREATE TABLE Palette ("id" uuid);`, `ALTER TABLE palette DROP COLUMN "id";`],
    [`CREATE TABLE "Palette" ("id" uuid);`, `ALTER TABLE "Palette" DROP COLUMN "id";`],
    [`CREATE TABLE public."palette"("id" uuid);`, `ALTER TABLE PUBLIC.Palette DROP COLUMN "id";`],
    [
      `CREATE TABLE "audit"."palette" ("id" uuid);`,
      `ALTER TABLE "audit".palette DROP COLUMN "id";`,
    ],
  ])("reconnaît la table de %s dans %s", (create, alter) => {
    expect(rejectedStatements(`${create}\n--> statement-breakpoint\n${alter}`)).toEqual([]);
  });

  it.each([
    `ALTER TABLE "t" ADD COLUMN "c" text NOT/* x */NULL`,
    `ALTER TABLE "t" ADD COLUMN "c" text not null`,
    `ALTER TABLE "t" ADD COLUMN "c" text NOT NULL "default"`,
    `ALTER TABLE "t" ADD COLUMN "c" text NOT NULL CHECK ('DEFAULT' <> '')`,
    `ALTER TABLE "t" ADD "c" text`,
    `ALTER TABLE ONLY "t" ADD COLUMN "c" text`,
    `ALTER TABLE "t" ADD COLUMN`,
    `ALTER TABLE "t".`,
    `ALTER TABLE "t"`,
    `ALTER TABLE 't' ADD COLUMN "c" text`,
  ])("refuse l'ajout de colonne %s", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([statement.replace("/* x */", " ")]);
  });

  it.each([
    `ALTER TABLE "t" ADD COLUMN "c" text DEFAULT 'x' NOT NULL`,
    `alter table t add column c text default '' not null`,
    String.raw`ALTER TABLE "public"."t" ADD COLUMN "c" text NOT NULL DEFAULT E'\''`,
    `ALTER TABLE "t" ADD COLUMN "c" text DEFAULT ','`,
    `ALTER TABLE "t" ADD COLUMN "c" "NOT" "NULL"`,
    `ALTER TABLE "t" ADD COLUMN "c" text NOT "NULL"`,
    String.raw`ALTER TABLE "t" ADD COLUMN "c" text DEFAULT E'a\ b' NOT NULL`,
    `ALTER TABLE "t" ADD COLUMN "e" text DEFAULT e NOT NULL`,
  ])("accepte l'ajout de colonne %s", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([]);
  });
});

describe("rejectedStatements sur les droits accordés et retirés", () => {
  it.each([
    `GRANT SELECT ON "t" TO app`,
    `GRANT SELECT, INSERT ON "t", "u" TO app`,
    `GRANT SELECT ("a", "b") ON "t" TO app`,
    `GRANT SELECT ("a"), INSERT ("b") ON "t" TO app`,
    `GRANT REFERENCES ON "t" TO app`,
    `GRANT USAGE ON SCHEMA drizzle TO app`,
    `grant select, insert, references, usage on "t" to app`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO app`,
    `GRANT SELECT ON "on" TO app`,
    `GRANT SELECT ON "with" TO app`,
    `GRANT SELECT ON "t" TO app GRANTED BY CURRENT_USER`,
    `GRANT SELECT ON e TO E`,
  ])("accepte le droit de lire ou d'ajouter %s", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([]);
  });

  it.each([
    `GRANT DELETE ON "t" TO app`,
    `GRANT UPDATE ON "t" TO app`,
    `GRANT UPDATE ("status") ON "t" TO app`,
    `GRANT TRUNCATE ON "t" TO app`,
    `GRANT TRIGGER ON "t" TO app`,
    `GRANT ALL ON "t" TO app`,
    `GRANT ALL PRIVILEGES ON "t" TO app`,
    `GRANT ALL ("a") ON "t" TO app`,
    `grant delete on "t" to app`,
    `GRANT SELECT, DELETE ON "t" TO app`,
    `GRANT SELECT ("a"), DELETE ON "t" TO app`,
    `GRANT SELECT ("a") DELETE ON "t" TO app`,
    `GRANT SELECT ("a")) ON "t" TO app`,
    `GRANT SELECT (("a")) ON "t" TO app`,
    `GRANT SELECT ( ON "t" TO app`,
    `GRANT SELECT ("a" ON "t" TO app`,
    `GRANT SELECT "a") ON "t" TO app`,
    `GRANT SELECT DELETE ON "t" TO app`,
    `GRANT SELECT ON "t" TO app WITH GRANT OPTION`,
    `GRANT SELECT ON "t" TO app with grant option`,
    `GRANT EXECUTE ON FUNCTION f() TO app`,
    `GRANT CREATE ON SCHEMA public TO app`,
    `GRANT TEMPORARY ON DATABASE d TO app`,
    `GRANT MAINTAIN ON "t" TO app`,
    `GRANT "select" ON "t" TO app`,
    `GRANT "delete" ON "t" TO app`,
    `GRANT ON "t" TO app`,
    `GRANT , SELECT ON "t" TO app`,
    `GRANT SELECT TO app`,
    `GRANT app TO history_maintainer`,
    `GRANT app, history_maintainer TO someone`,
    `GRANT "on" TO app`,
    `GRANT app TO someone WITH ADMIN OPTION`,
  ])("demande l'approbation du droit accordé par %s", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it("voit le DELETE accordé après un commentaire de fin de ligne", () => {
    expect(rejectedStatements(`GRANT SELECT -- note\n, DELETE ON "t" TO app;`)).toEqual([
      `GRANT SELECT , DELETE ON "t" TO app`,
    ]);
  });

  it.each([
    `REVOKE SELECT ON "t" FROM app`,
    `REVOKE DELETE ON "t" FROM app`,
    `REVOKE app FROM history_maintainer`,
  ])("demande l'approbation du retrait %s", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });

  it("ne refuse que le GRANT qui élève les droits parmi plusieurs", () => {
    const sql = `GRANT SELECT ON "t" TO app; GRANT DELETE ON "t" TO app; GRANT INSERT ON "t" TO app;`;

    expect(rejectedStatements(sql)).toEqual([`GRANT DELETE ON "t" TO app`]);
  });

  it.each([`CREATE SCHEMA "audit"`, `CREATE SCHEMA IF NOT EXISTS audit`, `create schema "a""b"`])(
    "accepte la création du schéma vide %s",
    (statement) => {
      expect(rejectedStatements(`${statement};`)).toEqual([]);
    },
  );

  it.each([
    `CREATE SCHEMA "audit" GRANT DELETE ON "public"."token" TO app`,
    `CREATE SCHEMA "audit" CREATE TABLE "x" ("id" uuid)`,
    `CREATE SCHEMA "audit" AUTHORIZATION app`,
    `CREATE SCHEMA AUTHORIZATION app`,
    `CREATE SCHEMA IF NOT EXISTS`,
    `CREATE SCHEMA IF EXISTS audit`,
    `CREATE SCHEMA "a".b`,
    `CREATE SCHEMA`,
    `CREATE SCHEMA 'audit'`,
  ])("demande l'approbation du schéma %s", (statement) => {
    expect(rejectedStatements(`${statement};`)).toEqual([statement]);
  });
});
