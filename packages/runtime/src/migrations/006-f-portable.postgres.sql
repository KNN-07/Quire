CREATE TABLE event_counter (
  id INTEGER PRIMARY KEY CHECK(id=1), value BIGINT NOT NULL CHECK(value>=0)
);
INSERT INTO event_counter(id,value) SELECT 1,COALESCE(MAX(seq),0) FROM events;
CREATE TABLE branch_leases (
  project_id TEXT NOT NULL, branch TEXT NOT NULL, owner TEXT NOT NULL,
  fence BIGINT NOT NULL CHECK(fence>0), expires_at TEXT NOT NULL,
  PRIMARY KEY(project_id,branch)
);
CREATE TABLE repository_intents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT NOT NULL,
  owner TEXT NOT NULL, fence BIGINT NOT NULL, updates_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared','published','finalized','conflicted')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX repository_pending ON repository_intents(project_id)
  WHERE state<>'finalized';
ALTER TABLE suggestion_edits ADD COLUMN edit_order INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX suggestion_edit_order ON suggestion_edits(suggestion_id,edit_order);
