-- Une écriture qui échoue côté serveur libère sa clé d'idempotence au lieu de mémoriser sa réponse.
GRANT DELETE ON "idempotency_key" TO app;
