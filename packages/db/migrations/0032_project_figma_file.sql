ALTER TABLE "project" ADD COLUMN "figma_file_url" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "figma_file_key" text;--> statement-breakpoint
-- Tout membre renseigne, modifie ou retire le fichier Figma d'un projet : l'app ne modifie que ces deux colonnes du projet (ADR 0059 §4).
GRANT UPDATE ("figma_file_url", "figma_file_key") ON "project" TO app;
