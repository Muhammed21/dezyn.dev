-- Toute API en ligne écrit stored_size (ADR 0049) : le trigger de la migration 0020 et les fonctions qui calculaient la taille en SQL ne servent plus.
DROP TRIGGER history_entry_fill_stored_size ON "history_entry";--> statement-breakpoint
DROP FUNCTION history_entry_fill_stored_size();--> statement-breakpoint
DROP FUNCTION history_entry_stored_size("history_entry");--> statement-breakpoint
DROP FUNCTION history_entry_json_length(jsonb);
