ALTER TABLE "space" ADD COLUMN "orphaned_at" timestamp with time zone;--> statement-breakpoint
-- Un espace déjà orphelin au déploiement commence son délai de grâce maintenant : la fermeture de sa dernière appartenance est perdue avec le compte supprimé (ADR 0056).
UPDATE "space" SET "orphaned_at" = now() WHERE NOT EXISTS (SELECT 1 FROM "space_member" WHERE "space_member"."space_id" = "space"."id" AND "space_member"."closed_at" IS NULL);
