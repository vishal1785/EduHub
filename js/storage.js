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
 *   activeQuiz  - one in-progress quiz PER QUIZ TYPE, keyed "active:<type>",
 *                 so starting a Quick 10 can never discard a half-finished
 *                 Mid-Term Mock. Each record wraps the quiz as { id, quiz }
 *                 rather than being the quiz itself - the store's own key
 *                 must never overwrite the quiz's id (see saveAttempt).
 *   settings    - simple key/value app settings (e.g. onboarding flags)
 *
 * Progress and "weak areas" are intentionally NOT stored separately.
 * They are derived from `attempts` on demand (see progress.js) so that
 * we never have two copies of the same fact that can drift out of sync.
 * ---------------------------------------------------------------------
 */

// Deliberately NOT renamed with the app. The database name is the address
// of everything already saved on a device; changing it would orphan every
// attempt the student has built up and look exactly like data loss.
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
 * Ids that belong to the activeQuiz store and must never be used as an
 * attempt id. An earlier version stamped the active-quiz slot key onto the
 * quiz itself, so every finished quiz saved under the same id and silently
 * overwrote the previous one - the whole history collapsed to one record.
 * The wrapper in saveActiveQuiz stops that happening; this is the backstop.
 */
function isReservedId(id) {
  return !id || id === "current" || String(id).startsWith(ACTIVE_PREFIX);
}

/**
 * Save a completed (or partially completed but explicitly saved) attempt.
 * If `attempt.id` is missing or is a reserved store key, a fresh one is
 * generated. Returns the saved attempt.
 */
async function saveAttempt(attempt) {
  const db = await openDB();
  const record = { ...attempt, id: isReservedId(attempt.id) ? generateId("attempt") : attempt.id };
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
/*
 * One in-progress quiz is kept PER QUIZ TYPE ("practice", "quick10", "mock",
 * "weak"), each under the key "active:<type>". Starting a Quick 10 therefore
 * leaves a half-finished Mid-Term Mock exactly where it was, which is the
 * whole point - a 47-question mock is far too much work to lose to a stray tap.
 *
 * The quiz is stored WRAPPED as { id: slotKey, quizType, savedAt, quiz }.
 * Storing the quiz directly would mean the store's keyPath overwrote the
 * quiz's own id, and that id is what the finished attempt is saved under.
 * Resuming always preserves the exact question order and position the student
 * left off at - the quiz is never rebuilt or re-shuffled.
 */

const ACTIVE_PREFIX = "active:";

function slotKey(quizType) {
  return ACTIVE_PREFIX + (quizType || "practice");
}

/**
 * Unwrap a stored record into the quiz it holds.
 *
 * Records written by the older single-slot version ARE the quiz, and carry
 * the reserved id "current"; those are unwrapped too and given a real id so
 * they cannot poison the attempt they eventually become.
 */
function unwrapActive(record) {
  if (!record) return null;
  if (record.quiz) return record.quiz;
  const legacy = { ...record };
  if (isReservedId(legacy.id)) legacy.id = generateId("quiz");
  return legacy;
}

async function saveActiveQuiz(quizState) {
  const db = await openDB();
  const record = {
    id: slotKey(quizState.quizType),
    quizType: quizState.quizType,
    savedAt: new Date().toISOString(),
    quiz: quizState,
  };
  const store = tx(db, STORE_ACTIVE_QUIZ, "readwrite");
  await reqToPromise(store.put(record));
  return quizState;
}

/**
 * The in-progress quiz of a given type, or - with no type - the most recently
 * saved one of any type. Returns null if there is nothing in progress.
 */
async function getActiveQuiz(quizType = null) {
  const db = await openDB();
  if (quizType) {
    const store = tx(db, STORE_ACTIVE_QUIZ, "readonly");
    return unwrapActive(await reqToPromise(store.get(slotKey(quizType))));
  }
  const all = await getActiveQuizzes();
  return all.length ? all[0] : null;
}

/** Every in-progress quiz, most recently saved first. */
async function getActiveQuizzes() {
  const db = await openDB();
  const store = tx(db, STORE_ACTIVE_QUIZ, "readonly");
  const records = await reqToPromise(store.getAll());
  return records
    .slice()
    .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0))
    .map(unwrapActive)
    .filter((q) => q && q.total > 0);
}

/** Discard one type's in-progress quiz, or every one of them if no type given. */
async function clearActiveQuiz(quizType = null) {
  const db = await openDB();
  const store = tx(db, STORE_ACTIVE_QUIZ, "readwrite");
  if (quizType) {
    // Both deletes go through the same transaction - awaiting in between
    // would let it auto-commit and the second call would then throw.
    const dropSlot = reqToPromise(store.delete(slotKey(quizType)));
    const dropLegacy = reqToPromise(store.delete("current"));
    await Promise.all([dropSlot, dropLegacy]);
    return;
  }
  await reqToPromise(store.clear());
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
    appName: "Learn Splash",
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
    throw new Error("This backup file doesn't look like a valid Learn Splash export.");
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
  getActiveQuizzes,
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
