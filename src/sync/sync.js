// src/sync/sync.js
import { Network } from '@capacitor/network';
import { getDB, saveWebStore } from '../db/sqlite.js';
import { API_BASE, DB_NAME, DEVICE_CODE } from '../config.js';

// ---- Online/Offline guard (UI + cache) --------------------------
let ONLINE_CACHE = false;
let NET_UNSUB = null;

function setSyncControlsUI(online, ids) {
  const { syncBtnId, resetBtnId, statusId } = ids || {};
  const syncBtn  = syncBtnId  ? document.getElementById(syncBtnId)  : null;
  const resetBtn = resetBtnId ? document.getElementById(resetBtnId) : null;
  const statusEl = statusId   ? document.getElementById(statusId)   : null;

  ONLINE_CACHE = !!online;

  // --- Buttons: identical disabled behavior for Sync & Reset when offline ---
  [syncBtn, resetBtn].forEach(el => {
    if (!el) return;
    if (ONLINE_CACHE) {
      el.removeAttribute('disabled');
      el.classList.remove('opacity-50','pointer-events-none');
      el.title = '';
      // Note: we do NOT touch your inline red styles on the Reset button.
    } else {
      el.setAttribute('disabled', 'true');
      el.classList.add('opacity-50','pointer-events-none'); // same visual as Sync
      el.title = 'Disabled while offline';
    }
  });

  // --- Status text: green when online, red when offline ---
  if (statusEl) {
    statusEl.textContent = ONLINE_CACHE ? 'Online' : 'No internet';
    statusEl.dataset.state = ONLINE_CACHE ? 'online' : 'offline';
    // Color: reuse your existing classes
    statusEl.classList.remove('ok','bad','muted');
    statusEl.classList.add(ONLINE_CACHE ? 'ok' : 'bad');
  }
}


/**
 * Initialize network → UI wiring once (e.g., on app start)
 * @param {{syncBtnId:string, resetBtnId:string, statusId?:string}} ids
 */
export async function initNetworkGuard(ids) {
  try {
    const st = await Network.getStatus();
    setSyncControlsUI(st.connected && !!API_BASE, ids);
  } catch {
    setSyncControlsUI(false, ids);
  }
  NET_UNSUB = await Network.addListener('networkStatusChange', (st) => {
    setSyncControlsUI(st.connected && !!API_BASE, ids);
  });
}

/** Optional cleanup if you navigate/unmount screens */
export function disposeNetworkGuard() {
  if (NET_UNSUB && typeof NET_UNSUB.remove === 'function') {
    NET_UNSUB.remove();
  }
  NET_UNSUB = null;
}

// ----------------------------------------------------------------

async function isOnline() {
  try {
    const status = await Network.getStatus();
    ONLINE_CACHE = status.connected && !!API_BASE;
    return ONLINE_CACHE;
  } catch {
    return ONLINE_CACHE && !!API_BASE;
  }
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
    `SELECT id, table_name, record_uuid, operation, json_payload FROM sync_queue
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

    let op = (r.operation || payload.operation || '').toUpperCase();
    if (!op) op = 'UPSERT';

    const rawData = payload && typeof payload === 'object'
      ? (payload.data && typeof payload.data === 'object' ? payload.data : payload)
      : {};

    const data = { ...rawData };

    if (!data.last_updated) data.last_updated = new Date().toISOString();

    if (r.table_name === 'states') {
      if (data.country_uuid && !data.country_id) data.country_id = data.country_uuid;
      delete data.country_uuid;
    }
    if (r.table_name === 'cities') {
      if (data.state_uuid && !data.state_id) data.state_id = data.state_uuid;
      delete data.state_uuid;
    }

    const effectiveUuid = data.uuid || r.record_uuid || '';
    if (!effectiveUuid) {
      console.error('[Skip upload: empty uuid]', { table: r.table_name, id: r.id, data });
      continue;
    }

    const form = new URLSearchParams();
    form.set('table', r.table_name);
    form.set('operation', op);
    form.set('uuid', effectiveUuid);
    form.set('data', JSON.stringify(data));

    const endpoint = `${API_BASE}/api/save_${r.table_name}.php`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString()
      });

      const txt = (await res.text().catch(() => '')).trim();

      if (!res.ok) {
        console.error('[Upload failed]', { table: r.table_name, id: r.id, status: res.status, resp: txt.slice(0,400) });
        continue;
      }

      let success = /success/i.test(txt);
      if (!success) { try { success = (JSON.parse(txt)?.ok === true); } catch {} }

      if (success) {
        await writeAck(r.id, 'local');
        await db.run(`DELETE FROM sync_queue WHERE id=?`, [r.id]);
      } else {
        console.error('[Upload response not success]', { table: r.table_name, id: r.id, resp: txt.slice(0,400) });
      }
    } catch (err) {
      console.error('[Local→Cloud upload error]', { table: r.table_name, id: r.id, endpoint, err });
    }
  }

  await saveWebStore(DB_NAME);
}

export async function trySync() {
  if (!(await isOnline())) return false;
  await syncNow();
  return true;
}
