-- Migration de test pour le gate (ADR 0053, 0054) : ne pas fusionner.
GRANT DELETE ON "space_refused_subscription" TO app;
GRANT TRUNCATE ON "space_refused_subscription" TO app;
