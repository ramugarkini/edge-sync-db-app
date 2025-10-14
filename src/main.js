// src/main.js
import { openAndMigrate } from './db/init.js';
import { trySync } from './sync/sync.js';
import {
  listCountries, listStates, listCities,
  saveCountryOffline, saveStateOffline, saveCityOffline,
  deleteCountryOffline, deleteStateOffline, deleteCityOffline,
  hasStates, hasCities
} from './db/dal.js';

import { getDB, saveWebStore } from './db/sqlite.js';
import { DB_NAME, API_BASE } from './config.js';

/* Diagnostics */
window.addEventListener('unhandledrejection', e => console.error('Unhandled promise rejection:', e.reason));
window.addEventListener('error', e => console.error('Window error:', e.error || e.message));

/* DOM */
const statusEl     = document.getElementById('status');
const syncBtn      = document.getElementById('syncBtn');

const countryForm  = document.getElementById('countryForm');
const countryName  = document.getElementById('countryName');
const countryList  = document.getElementById('countryList');

const stateForm    = document.getElementById('stateForm');
const stateCountry = document.getElementById('stateCountry');
const stateName    = document.getElementById('stateName');
const stateList    = document.getElementById('stateList');

const cityForm     = document.getElementById('cityForm');
const cityState    = document.getElementById('cityState');
const cityName     = document.getElementById('cityName');
const cityList     = document.getElementById('cityList');

const resetBtn    = document.getElementById('resetBtn');
const RESET_TOKEN = 'RGramuGarkini9876543210A9F3B7C6D2E8F10B7C9A1D4E6F8B3C220251015T203000Z';

let editCountryUuid = null;
let editStateUuid   = null;
let editCityUuid    = null;

/* Helpers */
function ok(msg){ if(statusEl){ statusEl.textContent = msg; statusEl.className='ok'; } }
function bad(msg){ if(statusEl){ statusEl.textContent = msg; statusEl.className='bad'; } }
function muted(msg){ if(statusEl){ statusEl.textContent = msg; statusEl.className='muted'; } }

/* Renderers */
async function renderCountries() {
  const rows = await listCountries();
  if (countryList) {
    countryList.innerHTML = rows.length
      ? `<ul>
           ${rows.map(r => `
             <li>
               <span class="nm">${r.name}</span>
               <button type="button" data-act="edit-country" data-id="${r.uuid}">Edit</button>
               <button type="button" data-act="del-country" data-id="${r.uuid}">Delete</button>
             </li>
           `).join('')}
         </ul>`
      : `<div class="muted">No countries yet.</div>`;
  }
  if (stateCountry) {
    const prev = stateCountry.value || '';
    stateCountry.innerHTML = `<option value="">-- Select Country --</option>` +
      rows.map(r => `<option value="${r.uuid}">${r.name}</option>`).join('');
    if (prev) stateCountry.value = prev;
  }
}

async function renderStates() {
  const rows = await listStates();
  if (stateList) {
    stateList.innerHTML = rows.length
      ? `<ul>
           ${rows.map(r => `
             <li>
               <span class="nm">${r.name}</span>
               <span class="muted">(${r.country_name||'—'})</span>
               <button type="button" data-act="edit-state" data-id="${r.uuid}" data-country="${r.country_uuid}">Edit</button>
               <button type="button" data-act="del-state" data-id="${r.uuid}">Delete</button>
             </li>
           `).join('')}
         </ul>`
      : `<div class="muted">No states yet.</div>`;
  }
  if (cityState) {
    const prev = cityState.value || '';
    cityState.innerHTML = `<option value="">-- Select State --</option>` +
      rows.map(s => `<option value="${s.uuid}">${s.name}</option>`).join('');
    if (prev) cityState.value = prev;
  }
}

async function renderCities() {
  const rows = await listCities();
  if (cityList) {
    cityList.innerHTML = rows.length
      ? `<ul>
           ${rows.map(r => `
             <li>
               <span class="nm">${r.name}</span>
               <span class="muted">(${r.state_name||'—'})</span>
               <button type="button" data-act="edit-city" data-id="${r.uuid}" data-state="${r.state_uuid}">Edit</button>
               <button type="button" data-act="del-city" data-id="${r.uuid}">Delete</button>
             </li>
           `).join('')}
         </ul>`
      : `<div class="muted">No cities yet.</div>`;
  }
}

async function renderAll() {
  await renderCountries();
  await renderStates();
  await renderCities();
}

/* Busy guard */
let busy = false;
function blockWhile(fn){
  return async (...args)=>{
    if (busy) return;
    try {
      busy = true;
      setDisabled(true);
      await fn(...args);
    } finally {
      setDisabled(false);
      busy = false;
    }
  };
}
function setDisabled(disabled){
  if (syncBtn) syncBtn.disabled = disabled;
  if (countryForm) [...countryForm.elements].forEach(el => el.disabled = disabled);
  if (stateForm)   [...stateForm.elements].forEach(el => el.disabled = disabled);
  if (cityForm)    [...cityForm.elements].forEach(el => el.disabled = disabled);
}

/* List click delegates */
countryList?.addEventListener('click', async (e)=>{
  const t = e.target.closest('button'); if(!t) return;
  const id = t.dataset.id;
  const li = t.closest('li');
  if (t.dataset.act === 'edit-country') {
    editCountryUuid = id;
    countryName.value = li.querySelector('.nm')?.textContent?.trim() || '';
  } else if (t.dataset.act === 'del-country') {
    if (await hasStates(id)) { bad('Delete states first.'); return; }
    if (confirm('Delete country? (soft delete)')) {
      await deleteCountryOffline(id);
      await renderCountries(); await renderStates(); await renderCities();
      ok('Country deleted (soft).');
    }
  }
});

stateList?.addEventListener('click', async (e)=>{
  const t = e.target.closest('button'); if(!t) return;
  const id = t.dataset.id;
  const li = t.closest('li');
  if (t.dataset.act === 'edit-state') {
    editStateUuid = id;
    stateName.value = li.querySelector('.nm')?.textContent?.trim() || '';
    if (t.dataset.country) stateCountry.value = t.dataset.country;
  } else if (t.dataset.act === 'del-state') {
    if (await hasCities(id)) { bad('Delete cities first.'); return; }
    if (confirm('Delete state? (soft delete)')) {
      await deleteStateOffline(id);
      await renderStates(); await renderCities();
      ok('State deleted (soft).');
    }
  }
});

cityList?.addEventListener('click', async (e)=>{
  const t = e.target.closest('button'); if(!t) return;
  const id = t.dataset.id;
  const li = t.closest('li');
  if (t.dataset.act === 'edit-city') {
    editCityUuid = id;
    cityName.value = li.querySelector('.nm')?.textContent?.trim() || '';
    if (t.dataset.state) cityState.value = t.dataset.state;
  } else if (t.dataset.act === 'del-city') {
    if (confirm('Delete city? (soft delete)')) {
      await deleteCityOffline(id);
      await renderCities();
      ok('City deleted (soft).');
    }
  }
});

/* Save handlers (create/update) */
countryForm?.addEventListener('submit', blockWhile(async (e)=>{
  e.preventDefault();
  try {
    const name = (countryName?.value || '').trim();
    if (!name) return;
    await saveCountryOffline({ uuid: editCountryUuid || undefined, name });
    editCountryUuid = null;
    countryName.value = '';
    await renderCountries();
    ok('Country saved offline.');
  } catch (err) { console.error(err); bad(`Save country failed: ${err?.message || err}`); }
}));

stateForm?.addEventListener('submit', blockWhile(async (e)=>{
  e.preventDefault();
  try {
    const name = (stateName?.value || '').trim();
    const country_uuid = stateCountry?.value || '';
    if (!name || !country_uuid) return;
    await saveStateOffline({ uuid: editStateUuid || undefined, name, country_uuid });
    editStateUuid = null;
    stateName.value = '';
    await renderStates();
    ok('State saved offline.');
  } catch (err) { console.error(err); bad(`Save state failed: ${err?.message || err}`); }
}));

cityForm?.addEventListener('submit', blockWhile(async (e)=>{
  e.preventDefault();
  try {
    const name = (cityName?.value || '').trim();
    const state_uuid = cityState?.value || '';
    if (!name || !state_uuid) return;
    await saveCityOffline({ uuid: editCityUuid || undefined, name, state_uuid });
    editCityUuid = null;
    cityName.value = '';
    await renderCities();
    ok('City saved offline.');
  } catch (err) { console.error(err); bad(`Save city failed: ${err?.message || err}`); }
}));

/* Sync */
syncBtn?.addEventListener('click', blockWhile(async ()=>{
  try {
    muted('Syncing…');
    await trySync();
    await renderAll();
    ok('Sync complete.');
  } catch (e) { console.error(e); bad(`Sync error: ${e?.message || e}`); }
}));

/* Reset (danger zone) */
resetBtn?.addEventListener('click', blockWhile(async ()=> {
  try {
    if (!confirm('This will erase ALL local data and also clear the CLOUD database. Continue?')) return;
    muted('Resetting local DB…');

    const db = await getDB(DB_NAME);
    await db.execute(`
      DELETE FROM cities;
      DELETE FROM states;
      DELETE FROM countries;
      DELETE FROM sync_ack;
      DELETE FROM sync_queue;
    `);
    try { await db.execute('VACUUM;'); } catch {}
    await saveWebStore(DB_NAME);

    // ---- NEW: reset cloud ----
    muted('Resetting cloud DB…');
    try {
      const res = await fetch(`${API_BASE}/api/truncate_all.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Reset-Token': RESET_TOKEN
        },
        body: '' // or `token=${encodeURIComponent(RESET_TOKEN)}` if you prefer POST body
      });
      const txt = await res.text().catch(()=> '');
      let ok = false;
      try { ok = (JSON.parse(txt)?.ok === true); } catch {}
      if (!res.ok || !ok) {
        console.error('Cloud reset failed', res.status, txt.slice(0,400));
        bad('Cloud reset failed (see console).');
      } else {
        ok('Cloud DB cleared.');
      }
    } catch (err) {
      console.error('Cloud reset error', err);
      bad('Cloud reset error (see console).');
    }

    // Clear UI state and re-render
    editCountryUuid = editStateUuid = editCityUuid = null;
    if (countryName) countryName.value = '';
    if (stateName)   stateName.value   = '';
    if (cityName)    cityName.value    = '';
    if (stateCountry) stateCountry.value = '';
    if (cityState)    cityState.value   = '';
    await renderAll();
  } catch (e) {
    console.error(e);
    bad(`Reset failed: ${e?.message || e}`);
  }
}));

/* Boot */
(async ()=>{
  try {
    muted('Opening DB…');
    await openAndMigrate();
    ok('DB ready');
    await renderAll();
  } catch (e) {
    console.error(e);
    bad(`DB init failed: ${e?.message || e}`);
  }
})();
