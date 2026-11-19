-- La taille d'une entrée est celle de son JSON, que l'app compte au compteur du projet et écrit dans stored_size ; la purge la lit sans relire l'entrée (ADR 0049).
ALTER TABLE "history_entry" ADD COLUMN "stored_size" integer;--> statement-breakpoint
-- Longueur du JSON compact d'une valeur jsonb, comme JSON.stringify : le texte de PostgreSQL, sans l'espace qu'il ajoute après chaque « : » et chaque « , », et avec les nombres que JS écrit en exposant.
CREATE FUNCTION history_entry_json_length(value jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (octet_length(value::text)
    - (SELECT 2 * count(*) - count(DISTINCT pair.id)
       FROM jsonb_path_query(value, 'strict $.** ? (@.type() == "object").keyvalue().id') AS pair(id))
    - (SELECT coalesce(sum(list.size::integer - 1), 0)
       FROM jsonb_path_query(value, 'strict $.** ? (@.type() == "array" && @.size() > 0).size()') AS list(size))
    + (SELECT coalesce(sum(octet_length(shortest.text) - (shortest.text ~ 'e[-+]0')::integer
         - octet_length(number.value::text)), 0)
       FROM jsonb_path_query(value, 'strict $.** ? (@.type() == "number" && @ != 0 && ((@ < 0.000001 && @ > -0.000001) || @ >= 1e21 || @ <= -1e21))') AS number(value),
         LATERAL (SELECT (number.value::numeric)::float8::text AS text) AS shortest))::integer
$$;--> statement-breakpoint
-- Taille du JSON de l'entrée telle que l'app la lit : 115 octets de structure (accolades, clés, « : », « , »), 4 par null, 26 par date, chaque texte échappé entre guillemets.
CREATE FUNCTION history_entry_stored_size(entry "history_entry") RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT 115
    + octet_length(to_json(entry.id)::text)
    + octet_length(to_json(entry.space_id)::text)
    + octet_length(to_json(entry.project_id)::text)
    + octet_length(to_json(entry.action)::text)
    + octet_length(to_json(entry.author_id)::text)
    + coalesce(octet_length(to_json(entry.client_id)::text), 4)
    + coalesce(history_entry_json_length(entry.before), 4)
    + coalesce(history_entry_json_length(entry.after), 4)
    + octet_length(to_json(entry.correlation_id)::text)
    + 26
$$;--> statement-breakpoint
-- La version précédente de l'API écrit encore des entrées sans taille pendant le déploiement : le trigger la calcule, jusqu'à sa suppression par une migration suivante.
CREATE FUNCTION history_entry_fill_stored_size() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.stored_size := history_entry_stored_size(NEW);
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER history_entry_fill_stored_size BEFORE INSERT ON "history_entry"
  FOR EACH ROW WHEN (NEW.stored_size IS NULL) EXECUTE FUNCTION history_entry_fill_stored_size();--> statement-breakpoint
UPDATE "history_entry" SET "stored_size" = history_entry_stored_size("history_entry");--> statement-breakpoint
ALTER TABLE "history_entry" ALTER COLUMN "stored_size" SET NOT NULL;
