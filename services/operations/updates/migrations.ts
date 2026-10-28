import type { Migration } from "@quire/contracts";

const tables = `
CREATE TABLE update_jobs (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id),
  release_json TEXT NOT NULL, scheduled_at TEXT NOT NULL, security_only INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'queued', prior_target TEXT, staged_target TEXT, backup_json TEXT
);
CREATE TABLE update_install_state (
  install_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, version TEXT NOT NULL
);
`;
export const migrations: readonly Migration[] = [{
  id: "070-o-updates",
  sql: tables.replaceAll("\n);", "\n) STRICT;"),
  postgres: tables,
}, {
  id: "071-o-update-command-keys",
  sql: `
CREATE TABLE o_update_command_keys (
  actor_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL,
  PRIMARY KEY(actor_id,request_key)
) STRICT;
CREATE TABLE o_update_legacy_removals (
  source_id TEXT PRIMARY KEY, digest TEXT NOT NULL, snapshot_bytes TEXT NOT NULL,
  receipt_bytes TEXT NOT NULL
) STRICT;
CREATE TRIGGER o_update_key_insert BEFORE INSERT ON o_update_command_keys BEGIN
  SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM operations WHERE (actor_id=NEW.actor_id AND idempotency_key=NEW.request_key)
      OR id=NEW.operation_id
  );
END;
CREATE TRIGGER o_update_key_change BEFORE UPDATE ON o_update_command_keys BEGIN
  SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT');
END;
CREATE TRIGGER o_operation_update_key_insert BEFORE INSERT ON operations BEGIN
  SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM o_update_command_keys WHERE (actor_id=NEW.actor_id AND request_key=NEW.idempotency_key)
      OR operation_id=NEW.id
  );
END;
CREATE TRIGGER o_operation_update_key_change BEFORE UPDATE OF actor_id,idempotency_key,id ON operations BEGIN
  SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM o_update_command_keys WHERE (actor_id=NEW.actor_id AND request_key=NEW.idempotency_key)
      OR operation_id=NEW.id
  );
END;
`,
  postgres: `
CREATE TABLE o_update_command_keys (
  actor_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL,
  PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE o_update_legacy_removals (
  source_id TEXT PRIMARY KEY, digest TEXT NOT NULL, snapshot_bytes TEXT NOT NULL,
  receipt_bytes TEXT NOT NULL
);
CREATE FUNCTION o_update_key_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('o-update-key:' || NEW.actor_id || ':' || NEW.request_key, 0));
  IF EXISTS (SELECT 1 FROM operations WHERE (actor_id=NEW.actor_id AND idempotency_key=NEW.request_key)
      OR id=NEW.operation_id) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER o_update_key_insert BEFORE INSERT ON o_update_command_keys
  FOR EACH ROW EXECUTE FUNCTION o_update_key_guard();
CREATE FUNCTION o_update_key_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='IDEMPOTENCY_CONFLICT';
END;
$$;
CREATE TRIGGER o_update_key_change BEFORE UPDATE ON o_update_command_keys
  FOR EACH ROW EXECUTE FUNCTION o_update_key_immutable();
CREATE FUNCTION o_operation_update_key_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_id IS NOT NULL AND NEW.idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('o-update-key:' || NEW.actor_id || ':' || NEW.idempotency_key, 0));
  END IF;
  IF EXISTS (SELECT 1 FROM o_update_command_keys WHERE
      (actor_id=NEW.actor_id AND request_key=NEW.idempotency_key) OR operation_id=NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER o_operation_update_key_insert BEFORE INSERT ON operations
  FOR EACH ROW EXECUTE FUNCTION o_operation_update_key_guard();
CREATE TRIGGER o_operation_update_key_change BEFORE UPDATE OF actor_id,idempotency_key,id ON operations
  FOR EACH ROW EXECUTE FUNCTION o_operation_update_key_guard();
`,
}];
