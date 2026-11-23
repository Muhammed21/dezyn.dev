ALTER TABLE "space_subscription" ADD COLUMN "cancel_requested_at" timestamp with time zone;
-- Le Worker de l'API rejoue les résiliations en attente avec le rôle app, qui a déjà SELECT et UPDATE sur space_subscription (0022) : aucun GRANT de plus.
