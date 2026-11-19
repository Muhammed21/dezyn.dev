CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"response" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_scope_key" ON "idempotency_key" USING btree ("user_id","scope","key");--> statement-breakpoint
-- Une écriture portée par une clé d'idempotence réserve la clé, puis y mémorise sa réponse que rejoue chaque relance.
GRANT SELECT, INSERT, UPDATE ON "idempotency_key" TO app;
