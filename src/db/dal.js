// src/db/dal.js
import { getDB, saveWebStore } from './sqlite.js';
import { DB_NAME, DEVICE_CODE } from '../config.js';

const nowISO = () => new Date().toISOString();

function uuid32() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g,'').toLowerCase();
  return (Math.random().toString(16).slice(2).padEnd(16,'0') + Date.now().toString(16).padEnd(16,'0')).slice(0,32);
}

async function enqueue(table, record_uuid, operation, payloadObj) {
  const db = await getDB(DB_NAME);
  await db.run(
    `INSERT INTO sync_queue(origin_location_code, table_name, record_uuid, operation, json_payload, created_at)
     VALUES(?,?,?,?,?,?)`,
    [DEVICE_CODE, table, record_uuid, operation, JSON.stringify(payloadObj), nowISO()]
  );
  await saveWebStore(DB_NAME);
}

/* -------- Countries -------- */
export async function saveCountryOffline({ uuid, name, last_updated, deleted_at = null }) {
  const id = uuid || uuid32();
  const lu = last_updated || nowISO();
  const db = await getDB(DB_NAME);
  await db.run(
    `INSERT INTO countries(uuid, name, last_updated, deleted_at)
     VALUES(?,?,?,?)
     ON CONFLICT(uuid) DO UPDATE SET
       name=excluded.name,
       last_updated=excluded.last_updated,
       deleted_at=excluded.deleted_at`,
    [id, name, lu, deleted_at]
  );
  await enqueue('countries', id, 'UPSERT', { operation:'UPSERT', data:{ uuid:id, name, last_updated:lu, deleted_at } });
  return id;
}

export async function listCountries() {
  const db = await getDB(DB_NAME);
  const { values } = await db.query(`SELECT * FROM countries WHERE deleted_at IS NULL ORDER BY name`);
  return values || [];
}

/* -------- States -------- */
export async function saveStateOffline({ uuid, name, country_uuid, last_updated, deleted_at = null }) {
  const id = uuid || uuid32();
  const lu = last_updated || nowISO();
  const db = await getDB(DB_NAME);
  await db.run(
    `INSERT INTO states(uuid, name, country_uuid, last_updated, deleted_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(uuid) DO UPDATE SET
       name=excluded.name,
       country_uuid=excluded.country_uuid,
       last_updated=excluded.last_updated,
       deleted_at=excluded.deleted_at`,
    [id, name, country_uuid, lu, deleted_at]
  );
  await enqueue('states', id, 'UPSERT', { operation:'UPSERT', data:{ uuid:id, name, country_uuid, last_updated:lu, deleted_at } });
  return id;
}

export async function listStates() {
  const db = await getDB(DB_NAME);
  const { values } = await db.query(
    `SELECT s.*, c.name AS country_name
     FROM states s LEFT JOIN countries c ON c.uuid = s.country_uuid
     WHERE s.deleted_at IS NULL
     ORDER BY s.name`
  );
  return values || [];
}

/* -------- Cities -------- */
export async function saveCityOffline({ uuid, name, state_uuid, last_updated, deleted_at = null }) {
  const id = uuid || uuid32();
  const lu = last_updated || nowISO();
  const db = await getDB(DB_NAME);
  await db.run(
    `INSERT INTO cities(uuid, name, state_uuid, last_updated, deleted_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(uuid) DO UPDATE SET
       name=excluded.name,
       state_uuid=excluded.state_uuid,
       last_updated=excluded.last_updated,
       deleted_at=excluded.deleted_at`,
    [id, name, state_uuid, lu, deleted_at]
  );
  await enqueue('cities', id, 'UPSERT', { operation:'UPSERT', data:{ uuid:id, name, state_uuid, last_updated:lu, deleted_at } });
  return id;
}

export async function listCities() {
  const db = await getDB(DB_NAME);
  const { values } = await db.query(
    `SELECT ci.*, st.name AS state_name
     FROM cities ci LEFT JOIN states st ON st.uuid = ci.state_uuid
     WHERE ci.deleted_at IS NULL
     ORDER BY ci.name`
  );
  return values || [];
}

/* -------- Delete (soft) + guards -------- */
export async function deleteCountryOffline(uuid) {
  const db = await getDB(DB_NAME);
  const del = nowISO();
  await db.run(`UPDATE countries SET deleted_at=?, last_updated=? WHERE uuid=?`, [del, del, uuid]);
  await db.run(
    `INSERT INTO sync_queue(origin_location_code, table_name, record_uuid, operation, json_payload, created_at)
     VALUES(?,?,?,?,?,?)`,
    [DEVICE_CODE, 'countries', uuid, 'DELETE', JSON.stringify({ operation:'DELETE', data:{ uuid, deleted_at: del } }), nowISO()]
  );
  await saveWebStore(DB_NAME);
}

export async function deleteStateOffline(uuid) {
  const db = await getDB(DB_NAME);
  const del = nowISO();
  await db.run(`UPDATE states SET deleted_at=?, last_updated=? WHERE uuid=?`, [del, del, uuid]);
  await db.run(
    `INSERT INTO sync_queue(origin_location_code, table_name, record_uuid, operation, json_payload, created_at)
     VALUES(?,?,?,?,?,?)`,
    [DEVICE_CODE, 'states', uuid, 'DELETE', JSON.stringify({ operation:'DELETE', data:{ uuid, deleted_at: del } }), nowISO()]
  );
  await saveWebStore(DB_NAME);
}

export async function deleteCityOffline(uuid) {
  const db = await getDB(DB_NAME);
  const del = nowISO();
  await db.run(`UPDATE cities SET deleted_at=?, last_updated=? WHERE uuid=?`, [del, del, uuid]);
  await db.run(
    `INSERT INTO sync_queue(origin_location_code, table_name, record_uuid, operation, json_payload, created_at)
     VALUES(?,?,?,?,?,?)`,
    [DEVICE_CODE, 'cities', uuid, 'DELETE', JSON.stringify({ operation:'DELETE', data:{ uuid, deleted_at: del } }), nowISO()]
  );
  await saveWebStore(DB_NAME);
}

export async function hasStates(country_uuid) {
  const db = await getDB(DB_NAME);
  const { values } = await db.query(
    `SELECT COUNT(*) AS n FROM states WHERE deleted_at IS NULL AND country_uuid=?`,
    [country_uuid]
  );
  return (values?.[0]?.n || 0) > 0;
}

export async function hasCities(state_uuid) {
  const db = await getDB(DB_NAME);
  const { values } = await db.query(
    `SELECT COUNT(*) AS n FROM cities WHERE deleted_at IS NULL AND state_uuid=?`,
    [state_uuid]
  );
  return (values?.[0]?.n || 0) > 0;
}
