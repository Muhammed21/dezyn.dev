ALTER TABLE "space_subscription" ADD COLUMN "stored_bytes_at_end" bigint;--> statement-breakpoint
-- history_maintainer lit le statut de l'abonnement d'un espace, pour ne pas purger un espace gelé (ADR 0050 §5, §6).
GRANT SELECT ("space_id", "status") ON "space_subscription" TO history_maintainer;
