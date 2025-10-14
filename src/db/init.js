// src/db/init.js
import { getDB, saveWebStore } from './sqlite.js';
import { DB_NAME } from '../config.js';

const schema = `
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS countries(
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deleted_at TEXT NULL,
  last_updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS states(
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country_uuid TEXT NOT NULL,
  deleted_at TEXT NULL,
  last_updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cities(
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state_uuid TEXT NOT NULL,
  deleted_at TEXT NULL,
  last_updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_location_code TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_uuid TEXT NOT NULL,
  operation TEXT NOT NULL,
  json_payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_ack(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL,
  synced_by_location_code TEXT NOT NULL,
  source_type TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ack
  ON sync_ack(queue_id, synced_by_location_code, source_type);

-- helpful indexes
CREATE INDEX IF NOT EXISTS idx_states_country ON states(country_uuid);
CREATE INDEX IF NOT EXISTS idx_cities_state ON cities(state_uuid);
CREATE INDEX IF NOT EXISTS idx_sync_ack_lookup ON sync_ack(queue_id, synced_by_location_code, source_type);
`;

export async function openAndMigrate() {
  const db = await getDB(DB_NAME, 1);
  await db.execute(schema);
  await saveWebStore(DB_NAME);
}
