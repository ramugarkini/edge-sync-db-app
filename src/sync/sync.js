// src/sync/sync.js
import { Network } from '@capacitor/network';
import { getDB, saveWebStore } from '../db/sqlite.js';
import { API_BASE, DB_NAME, DEVICE_CODE } from '../config.js';

async function isOnline() {
  const status = await Network.getStatus();
  return status.connected && !!API_BASE;
}

async function isAcked(queueId, source) {
  const db = await getDB(DB_NAME);
  const { values } = await db.query(
    `SELECT 1 FROM sync_ack WHERE queue_id=? AND synced_by_location_code=? AND source_type=? LIMIT 1`,
    [queueId, DEVICE_CODE, source]
  );
  return (values || []).length > 0;
}

async function writeAck(queueId, source) {
  const db = await getDB(DB_NAME);
  await db.run(
    `INSERT OR IGNORE INTO sync_ack(queue_id, synced_by_location_code, source_type) VALUES(?,?,?)`,
    [queueId, DEVICE_CODE, source]
  );
  await saveWebStore(DB_NAME);
}

async function applyCloudRow(row) {
  const db = await getDB(DB_NAME);
  let raw = {};
  try { raw = JSON.parse(row.json_payload || '{}'); } catch {}

  const table = row.table_name;
  const op    = String(row.operation || raw.operation || 'UPSERT').toUpperCase();
  const src   = (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object') ? raw.data : raw;

  const uuid  = src.uuid || row.record_uuid;
  if (!uuid) throw new Error(`Cloud row ${row.id}: missing uuid`);

  const lu  = src.last_updated || new Date().toISOString();
  const del = op === 'DELETE' ? (src.deleted_at || new Date().toISOString()) : (src.deleted_at ?? null);

  if (table === 'countries') {
    if (op === 'DELETE') {
      await db.run(`UPDATE countries SET deleted_at=?, last_updated=? WHERE uuid=?`, [del, lu, uuid]);
      return;
    }
    await db.run(
      `INSERT INTO countries(uuid,name,last_updated,deleted_at)
       VALUES(?,?,?,?)
       ON CONFLICT(uuid) DO UPDATE SET
         name=excluded.name,
         last_updated=excluded.last_updated,
         deleted_at=excluded.deleted_at`,
      [uuid, src.name ?? '', lu, del]
    );
    return;
  }

  if (table === 'states') {
    const country_uuid = src.country_uuid || src.country_id || null;
    if (op === 'DELETE') {
      await db.run(`UPDATE states SET deleted_at=?, last_updated=? WHERE uuid=?`, [del, lu, uuid]);
      return;
    }
    await db.run(
      `INSERT INTO states(uuid,name,country_uuid,last_updated,deleted_at)
       VALUES(?,?,?,?,?)
       ON CONFLICT(uuid) DO UPDATE SET
         name=excluded.name,
         country_uuid=excluded.country_uuid,
         last_updated=excluded.last_updated,
         deleted_at=excluded.deleted_at`,
      [uuid, src.name ?? '', country_uuid, lu, del]
    );
    return;
  }

  if (table === 'cities') {
    const state_uuid = src.state_uuid || src.state_id || null;
    if (op === 'DELETE') {
      await db.run(`UPDATE cities SET deleted_at=?, last_updated=? WHERE uuid=?`, [del, lu, uuid]);
      return;
    }
    await db.run(
      `INSERT INTO cities(uuid,name,state_uuid,last_updated,deleted_at)
       VALUES(?,?,?,?,?)
       ON CONFLICT(uuid) DO UPDATE SET
         name=excluded.name,
         state_uuid=excluded.state_uuid,
         last_updated=excluded.last_updated,
         deleted_at=excluded.deleted_at`,
      [uuid, src.name ?? '', state_uuid, lu, del]
    );
    return;
  }
}

export async function syncNow() {
  const db = await getDB(DB_NAME);

  // Cloud → Local
  try {
    const res = await fetch(`${API_BASE}/api/get_sync_queue.php`, { cache: 'no-store' });
    if (res.ok) {
      const cloudQueue = await res.json().catch(() => []);
      if (Array.isArray(cloudQueue)) {
        for (const row of cloudQueue) {
          if (await isAcked(row.id, 'cloud')) continue;
          await applyCloudRow(row);
          await writeAck(row.id, 'cloud');
        }
        await saveWebStore(DB_NAME);
      }
    }
  } catch (err) {
    console.error('Cloud → Local sync error:', err);
  }

  // Local → Cloud
  const { values: localRows } = await db.query(
    `SELECT id, table_name, json_payload FROM sync_queue
     WHERE id NOT IN (
       SELECT queue_id FROM sync_ack
       WHERE source_type='local' AND synced_by_location_code=?
     )
     ORDER BY id ASC`,
    [DEVICE_CODE]
  );

  for (const r of (localRows || [])) {
    let payload = {};
    try { payload = JSON.parse(r.json_payload || '{}'); } catch {}
    const endpoint = `${API_BASE}/api/save_${r.table_name}.php`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await writeAck(r.id, 'local');
        await db.run(`DELETE FROM sync_queue WHERE id=?`, [r.id]);
      } else {
        console.error('Upload failed', r.table_name, r.id, res.status);
      }
    } catch (err) {
      console.error('Local → Cloud upload error:', err);
      // keep for retry
    }
  }

  await saveWebStore(DB_NAME);
}

export async function trySync() {
  if (!(await isOnline())) return false;
  await syncNow();
  return true;
}
