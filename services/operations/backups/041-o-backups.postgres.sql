CREATE TABLE o_backup_schedule (
  singleton BIGINT PRIMARY KEY CHECK(singleton=1),
  schedule TEXT NOT NULL,
  retention_days BIGINT NOT NULL CHECK(retention_days>=1),
  destination TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  last_slot TEXT
);
CREATE TABLE o_backup_receipts (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  action TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  PRIMARY KEY(actor_id,request_key)
);
