export const migrations = [{
  version: 1,
  sql: `
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
    CREATE TABLE products (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE sources (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), data TEXT NOT NULL CHECK(json_valid(data)), deleted INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX sources_product ON sources(product_id, deleted);
    CREATE TABLE checks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), finished_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE INDEX checks_source ON checks(source_id, finished_at DESC);
    CREATE TABLE events (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), created_at TEXT NOT NULL, dedup_key TEXT NOT NULL UNIQUE, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE INDEX events_created ON events(created_at DESC);
    CREATE TABLE tracking (source_id TEXT PRIMARY KEY REFERENCES sources(id), data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE jobs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), revision INTEGER NOT NULL, reason TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL, lease_token TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX jobs_due ON jobs(status,due_at);
    CREATE UNIQUE INDEX jobs_one_active_source ON jobs(source_id) WHERE status IN ('queued','running');
    CREATE TABLE domains (hostname TEXT PRIMARY KEY, next_allowed_at TEXT NOT NULL);
  `,
}];
