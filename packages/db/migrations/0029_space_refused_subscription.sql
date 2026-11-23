CREATE TABLE "space_refused_subscription" (
	"polar_subscription_id" text PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"payer_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"settling_since" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "space_refused_subscription" ADD CONSTRAINT "space_refused_subscription_payer_id_identity_user_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."identity_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Le webhook enregistre un abonnement payé par un non-propriétaire de l'espace, puis l'app marque sa révocation et son remboursement chez Polar, sans jamais modifier l'abonnement, l'espace ni le payeur, ni supprimer la ligne (ADR 0055).
GRANT SELECT, INSERT, UPDATE ("revoked_at", "refunded_at", "settling_since") ON "space_refused_subscription" TO app;
