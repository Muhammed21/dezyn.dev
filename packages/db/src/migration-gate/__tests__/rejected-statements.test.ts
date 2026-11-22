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
