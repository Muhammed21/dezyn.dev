ALTER TABLE "identity_oauth_access_token" DROP CONSTRAINT "identity_oauth_access_token_user_id_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "identity_oauth_client" DROP CONSTRAINT "identity_oauth_client_user_id_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "identity_oauth_consent" DROP CONSTRAINT "identity_oauth_consent_user_id_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "identity_oauth_refresh_token" DROP CONSTRAINT "identity_oauth_refresh_token_user_id_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "proposal_batch" DROP CONSTRAINT "proposal_batch_user_id_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "space_invitation" DROP CONSTRAINT "space_invitation_invited_by_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "space_member" DROP CONSTRAINT "space_member_user_id_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "space_subscription" DROP CONSTRAINT "space_subscription_payer_id_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "token_figma_state" DROP CONSTRAINT "token_figma_state_user_id_identity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "proposal_batch" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "space_invitation" ALTER COLUMN "invited_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "space_subscription" ALTER COLUMN "payer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "token_figma_state" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_oauth_access_token" ADD CONSTRAINT "identity_oauth_access_token_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_oauth_client" ADD CONSTRAINT "identity_oauth_client_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_oauth_consent" ADD CONSTRAINT "identity_oauth_consent_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_oauth_refresh_token" ADD CONSTRAINT "identity_oauth_refresh_token_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_batch" ADD CONSTRAINT "proposal_batch_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invitation" ADD CONSTRAINT "space_invitation_invited_by_identity_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."identity_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member" ADD CONSTRAINT "space_member_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_subscription" ADD CONSTRAINT "space_subscription_payer_id_identity_user_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."identity_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_figma_state" ADD CONSTRAINT "token_figma_state_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- La suppression d'un compte remplace son auteur d'historique par un membre supprimé numéroté (ADR 0015) : le rôle app modifie ces deux colonnes, jamais history_entry (ADR 0019).
GRANT UPDATE ("user_id", "deleted_member_number") ON "history_author" TO app;
