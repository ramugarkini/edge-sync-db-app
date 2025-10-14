// src/db/sqlite.js
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { defineCustomElements as jeepDefine } from 'jeep-sqlite/loader';

let sqlite, db;

export async function getDB(dbName, version = 1) {
  if (db) return db;

  if (Capacitor.getPlatform() === 'web') {
    await jeepDefine(window);
    await customElements.whenDefined('jeep-sqlite');
    if (typeof window.initSqlJs === 'function') {
      // sql-wasm.wasm must be in your built /assets
      await window.initSqlJs({ locateFile: f => `/assets/${f}` });
    }
    await CapacitorSQLite.initWebStore();
  }

  sqlite = new SQLiteConnection(CapacitorSQLite);

  const consistency = await sqlite.checkConnectionsConsistency();
  const isConn = await sqlite.isConnection(dbName, false);
  db = isConn.result
    ? await sqlite.retrieveConnection(dbName, false)
    : await sqlite.createConnection(dbName, false, 'no-encryption', version, false);

  await db.open();
  return db;
}

export async function saveWebStore(dbName) {
  if (Capacitor.getPlatform() === 'web') {
    await CapacitorSQLite.saveToStore({ database: dbName });
  }
}
