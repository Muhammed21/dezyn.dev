CREATE TABLE "space_plan_change" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"polar_subscription_id" text NOT NULL,
	"polar_event" text NOT NULL,
	"plan_before" text NOT NULL,
	"plan_after" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_subscription" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"polar_subscription_id" text NOT NULL,
	"payer_id" uuid NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"polar_modified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_plan_change" ADD CONSTRAINT "space_plan_change_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_subscription" ADD CONSTRAINT "space_subscription_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_subscription" ADD CONSTRAINT "space_subscription_payer_id_identity_user_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."identity_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_plan_change_space_id_idx" ON "space_plan_change" USING btree ("space_id");--> statement-breakpoint
-- L'app écrit l'abonnement d'un espace à chaque événement Polar, et trace chaque changement de plan sans jamais le modifier ni le supprimer (ADR 0050 §3).
GRANT SELECT, INSERT, UPDATE ON "space_subscription" TO app;--> statement-breakpoint
GRANT SELECT, INSERT ON "space_plan_change" TO app;
