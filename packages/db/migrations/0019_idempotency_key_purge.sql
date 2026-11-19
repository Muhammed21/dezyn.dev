-- history_maintainer supprime les clés d'idempotence de plus de 24 heures dans le Worker dezyn-purge : il ne lit que leur date de création, et ne les modifie ni n'en ajoute.
GRANT SELECT ("created_at"), DELETE ON "idempotency_key" TO history_maintainer;
