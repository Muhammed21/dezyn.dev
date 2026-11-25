ALTER TABLE "identity_oauth_refresh_token" DROP CONSTRAINT "identity_oauth_refresh_token_session_id_identity_session_id_fk";
--> statement-breakpoint
ALTER TABLE "identity_oauth_refresh_token" ADD COLUMN "cut_at" timestamp with time zone;--> statement-breakpoint
-- Une chaîne de refresh tokens garde la session depuis laquelle l'IA a été autorisée, même quand cette session expire et disparaît. La déconnexion d'une session encore valide et le rejeu hors fenêtre enregistrent la coupure dans cut_at (ADR 0060). Le droit UPDATE de app sur la table, accordé par 0002, couvre la colonne.
