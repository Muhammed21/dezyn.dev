-- Un lot ouvert pour une recette est désigné par son identifiant : l'index d'unicité ne vaut plus que pour le lot implicite d'un utilisateur, d'un client et d'un projet (ADR 0059 §2).
DROP INDEX "proposal_batch_open_key";--> statement-breakpoint
ALTER TABLE "proposal_batch" ADD COLUMN "recipe" text;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_batch_open_key" ON "proposal_batch" USING btree ("project_id","user_id","client_id") WHERE "proposal_batch"."state" = 'open' and "proposal_batch"."recipe" is null;