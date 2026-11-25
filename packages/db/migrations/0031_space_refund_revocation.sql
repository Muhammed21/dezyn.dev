CREATE TABLE "space_refund_revocation" (
	"polar_subscription_id" text PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"polar_order_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"settling_since" timestamp with time zone
);--> statement-breakpoint
-- Le webhook enregistre le remboursement total de la commande d'un abonnement enregistré, puis l'app marque sa révocation chez Polar, sans jamais modifier l'abonnement, la commande ni l'espace, ni supprimer la ligne (ADR 0058).
GRANT SELECT, INSERT, UPDATE ("revoked_at", "settling_since") ON "space_refund_revocation" TO app;
