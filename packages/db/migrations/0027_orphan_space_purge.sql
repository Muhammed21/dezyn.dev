-- history_maintainer purge un espace orphelin, sans membre ouvert, après la fin de sa période payée : il lit l'abonnement, puis supprime l'espace et tout ce qui en dépend, sans rien modifier ni ajouter (ADR 0051, ADR 0052).
GRANT SELECT ("current_period_end", "cancel_requested_at"), DELETE ON "space_subscription" TO history_maintainer;--> statement-breakpoint
GRANT DELETE ON "space", "space_member", "project" TO history_maintainer;--> statement-breakpoint
GRANT SELECT ("space_id"), DELETE ON "space_invitation", "space_plan_change", "history_author" TO history_maintainer;--> statement-breakpoint
GRANT SELECT ("id", "project_id"), DELETE ON "token", "modifier" TO history_maintainer;--> statement-breakpoint
GRANT SELECT ("token_id"), DELETE ON "token_value", "token_figma_state" TO history_maintainer;--> statement-breakpoint
GRANT SELECT ("modifier_id"), DELETE ON "mode" TO history_maintainer;--> statement-breakpoint
GRANT SELECT ("project_id"), DELETE ON "proposal", "proposal_batch" TO history_maintainer;
