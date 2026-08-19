/**
 * storage.js
 * ---------------------------------------------------------------------
 * Single abstraction layer over IndexedDB. No other file in this app
 * should touch indexedDB directly — everything goes through the
 * functions exported here. This keeps the storage engine swappable
 * and keeps UI code free of persistence details.
 *
 * Object stores:
 *   attempts    - one record per completed (or in-progress-but-saved) quiz attempt
 *   activeQuiz  - at most one record, keyed "current" - the in-progress quiz
 *   settings    - simple key/value app settings (e.g. onboarding flags)
 *
 * Progress and "weak areas" are intentionally NOT stored separately.
 * They are derived from `attempts` on demand (see progress.js) so that
 * we never have two copies of the same fact that can drift out of sync.
 * ---------------------------------------------------------------------
 */

const DB_NAME = "class7PracticeDB";
const DB_VERSION = 1;
const STORE_ATTEMPTS = "attempts";
const STORE_ACTIVE_QUIZ = "activeQuiz";
const STORE_SETTINGS = "settings";

let dbPromise = null;

/** Open (or create/upgrade) the database. Cached as a singleton promise. */
function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not supported in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        const store = db.createObjectStore(STORE_ATTEMPTS, { keyPath: "id" });
        store.createIndex("completedAt", "completedAt", { unique: false });
        store.createIndex("subject", "subject", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_ACTIVE_QUIZ)) {
        db.createObjectStore(STORE_ACTIVE_QUIZ, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => {
      dbPromise = null;
      reject(event.target.error || new Error("Failed to open database."));
    };
  });

  return dbPromise;
}

/** Small promise wrapper around a single IDBRequest. */
function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, storeName, mode = "readonly") {
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

function generateId(prefix = "attempt") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ----------------------------- ATTEMPTS ----------------------------- */

/**
 * Save a completed (or partially completed but explicitly saved) attempt.
 * If `attempt.id` is missing, one is generated. Returns the saved attempt.
 */
async function saveAttempt(attempt) {
  const db = await openDB();
  const record = { ...attempt, id: attempt.id || generateId("attempt") };
  const store = tx(db, STORE_ATTEMPTS, "readwrite");
  await reqToPromise(store.put(record));
  return record;
}

/** Return all attempts, most recent first. */
async function getAttempts() {
  const db = await openDB();
  const store = tx(db, STORE_ATTEMPTS, "readonly");
  const all = await reqToPromise(store.getAll());
  return all.sort((a, b) => {
    const ta = new Date(a.completedAt || a.startedAt || 0).getTime();
    const tb = new Date(b.completedAt || b.startedAt || 0).getTime();
    return tb - ta;
  });
}

/** Fetch a single attempt by id. Returns null if not found. */
async function getAttempt(id) {
  const db = await openDB();
  const store = tx(db, STORE_ATTEMPTS, "readonly");
  const result = await reqToPromise(store.get(id));
  return result || null;
}

/** Delete a single attempt by id (used sparingly; mainly for data hygiene). */
async function deleteAttempt(id) {
  const db = await openDB();
  const store = tx(db, STORE_ATTEMPTS, "readwrite");
  await reqToPromise(store.delete(id));
}

/** Remove every attempt. Used by "Reset progress". */
async function clearAttempts() {
  const db = await openDB();
  const store = tx(db, STORE_ATTEMPTS, "readwrite");
  await reqToPromise(store.clear());
}

/* ---------------------------- ACTIVE QUIZ ---------------------------- */
// Only one quiz can be "in progress" at a time. Stored under a fixed id
// so save/get/clear are trivial and resuming always preserves the exact
// question order and current position that was in play when the student left.

const ACTIVE_QUIZ_KEY = "current";

async function saveActiveQuiz(quizState) {
  const db = await openDB();
  const record = { ...quizState, id: ACTIVE_QUIZ_KEY };
  const store = tx(db, STORE_ACTIVE_QUIZ, "readwrite");
  await reqToPromise(store.put(record));
  return record;
}

async function getActiveQuiz() {
  const db = await openDB();
  const store = tx(db, STORE_ACTIVE_QUIZ, "readonly");
  const result = await reqToPromise(store.get(ACTIVE_QUIZ_KEY));
  return result || null;
}

async function clearActiveQuiz() {
  const db = await openDB();
  const store = tx(db, STORE_ACTIVE_QUIZ, "readwrite");
  await reqToPromise(store.delete(ACTIVE_QUIZ_KEY));
}

/* ----------------------------- SETTINGS ------------------------------ */

async function getSetting(key, defaultValue = null) {
  const db = await openDB();
  const store = tx(db, STORE_SETTINGS, "readonly");
  const result = await reqToPromise(store.get(key));
  return result ? result.value : defaultValue;
}

async function setSetting(key, value) {
  const db = await openDB();
  const store = tx(db, STORE_SETTINGS, "readwrite");
  await reqToPromise(store.put({ key, value }));
}

/* ----------------------------- PROGRESS ------------------------------ */
// Progress is derived from attempts (see progress.js for the calculations).
// saveProgress/getProgress exist as a light cache so screens can render
// instantly on repeat visits, but attempts remain the single source of truth.

async function saveProgress(progressSnapshot) {
  await setSetting("progressCache", progressSnapshot);
}

async function getProgress() {
  return getSetting("progressCache", null);
}

/* ------------------------------ BACKUP -------------------------------- */

/** Build a single JSON-serialisable object containing all student data. */
async function exportData() {
  const [attempts, streak] = await Promise.all([
    getAttempts(),
    getSetting("streak", null),
  ]);
  return {
    appName: "Class 7 Practice",
    exportedAt: new Date().toISOString(),
    version: DB_VERSION,
    attempts,
    streak,
  };
}

/**
 * Restore a previously exported JSON object. Overwrites all existing
 * attempts. Caller is responsible for confirming with the user first.
 */
async function importData(data) {
  if (!data || !Array.isArray(data.attempts)) {
    throw new Error("This backup file doesn't look like a valid Class 7 Practice export.");
  }
  await clearAttempts();
  const db = await openDB();
  const store = tx(db, STORE_ATTEMPTS, "readwrite");
  for (const attempt of data.attempts) {
    await reqToPromise(store.put(attempt));
  }
  if (data.streak) {
    await setSetting("streak", data.streak);
  }
  await clearActiveQuiz();
  await setSetting("progressCache", null);
}

/** Wipe everything: attempts, active quiz, cached progress, streak. */
async function resetAllData() {
  await clearAttempts();
  await clearActiveQuiz();
  await setSetting("progressCache", null);
  await setSetting("streak", null);
}

export const storage = {
  saveAttempt,
  getAttempts,
  getAttempt,
  deleteAttempt,
  clearAttempts,
  saveActiveQuiz,
  getActiveQuiz,
  clearActiveQuiz,
  saveProgress,
  getProgress,
  getSetting,
  setSetting,
  exportData,
  importData,
  resetAllData,
};
