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
