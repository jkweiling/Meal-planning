// Storage layer. Two interchangeable backends with the same interface:
//   watchHousehold(hid, cb) -> unsubscribe      cb(data | null)
//   saveHousehold(hid, partialData) -> Promise
//   watchWeek(hid, weekId, cb) -> unsubscribe   cb({ days: {...} })
//   setEntries(hid, weekId, [{ date, slot, person, value|null }]) -> Promise
import { firebaseConfig } from './config.js';

const FIREBASE_VERSION = '10.12.2';

export async function createStore(onError) {
  if (firebaseConfig && firebaseConfig.apiKey) {
    return createFirebaseStore(firebaseConfig, onError);
  }
  return createLocalStore();
}

async function createFirebaseStore(cfg, onError) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(cfg);
  await authMod.signInAnonymously(authMod.getAuth(app));

  let db;
  try {
    // Offline cache: the app opens instantly and works without signal; syncs when back online.
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }

  const hhRef = (hid) => fs.doc(db, 'households', hid);
  const weekRef = (hid, weekId) => fs.doc(db, 'households', hid, 'weeks', weekId);

  return {
    mode: 'cloud',
    watchHousehold(hid, cb) {
      return fs.onSnapshot(hhRef(hid), (s) => cb(s.exists() ? s.data() : null), onError);
    },
    saveHousehold(hid, data) {
      return fs.setDoc(hhRef(hid), data, { merge: true });
    },
    watchWeek(hid, weekId, cb) {
      return fs.onSnapshot(weekRef(hid, weekId), (s) => cb(s.exists() ? s.data() : {}), onError);
    },
    setEntries(hid, weekId, updates) {
      // Nested merge only touches the fields we pass, so two people editing
      // different slots (or different people's entries) never overwrite each other.
      const days = {};
      for (const { date, slot, person, value } of updates) {
        days[date] ??= {};
        days[date][slot] ??= {};
        days[date][slot][person] = value === null ? fs.deleteField() : value;
      }
      return fs.setDoc(weekRef(hid, weekId), { days }, { merge: true });
    },
  };
}

function createLocalStore() {
  const listeners = new Map();
  const read = (k) => {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  };
  const emit = (k) => (listeners.get(k) || []).forEach((cb) => cb(read(k)));
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
    emit(k);
  };
  const watch = (k, cb) => {
    if (!listeners.has(k)) listeners.set(k, new Set());
    listeners.get(k).add(cb);
    cb(read(k));
    return () => listeners.get(k)?.delete(cb);
  };
  // Keeps other tabs on the same device in sync.
  window.addEventListener('storage', (e) => e.key && emit(e.key));

  const hhKey = (hid) => `mp:hh:${hid}`;
  const wkKey = (hid, w) => `mp:wk:${hid}:${w}`;

  return {
    mode: 'local',
    watchHousehold: (hid, cb) => watch(hhKey(hid), cb),
    async saveHousehold(hid, data) {
      write(hhKey(hid), { ...(read(hhKey(hid)) || {}), ...data });
    },
    watchWeek: (hid, w, cb) => watch(wkKey(hid, w), (d) => cb(d || {})),
    async setEntries(hid, w, updates) {
      const d = read(wkKey(hid, w)) || {};
      d.days ??= {};
      for (const { date, slot, person, value } of updates) {
        d.days[date] ??= {};
        d.days[date][slot] ??= {};
        if (value === null) delete d.days[date][slot][person];
        else d.days[date][slot][person] = value;
      }
      write(wkKey(hid, w), d);
    },
  };
}
