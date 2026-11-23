-- history_maintainer lit le stockage d'un espace à la fin de son abonnement, la limite de purge d'un espace gelé (ADR 0050 §6).
GRANT SELECT ("stored_bytes_at_end") ON "space_subscription" TO history_maintainer;
