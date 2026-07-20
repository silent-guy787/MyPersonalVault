// ============================================================================
// Strongbox — Firebase Cloud Sync module
// ----------------------------------------------------------------------------
// Loaded from index.html as: <script type="module" src="js/firebase-sync.js">
// Exposes window.FirebaseSync, which script.js calls into. script.js never
// imports Firebase directly — this file is the only place that talks to
// Firebase, and it never handles plaintext vault data: script.js only ever
// hands it records that are ALREADY encrypted (iv/cipher), or public,
// non-secret meta values (salt, flags). See the setup guide for details.
// ============================================================================

import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    deleteDoc,
    getDocs,
    collection,
    enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

/* ====================== 1. FILL IN YOUR FIREBASE CONFIG ======================
   Get this object from: Firebase Console → Project settings → General →
   "Your apps" → SDK setup and configuration → Config.
   These values are NOT secret — they just tell the browser which Firebase
   project to talk to. Real access control happens in Firestore Security
   Rules (step 5 of the guide) and in ALLOWED_UID below.
============================================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyAFUuJzhKrOStoz_piErZnnwybLGt2-wjE",
  authDomain: "strongbox-vault-f5515.firebaseapp.com",
  projectId: "strongbox-vault-f5515",
  storageBucket: "strongbox-vault-f5515.firebasestorage.app",
  messagingSenderId: "634587464925",
  appId: "1:634587464925:web:42b85ef6055691beb6c734"
};

/* ====================== 2. FILL IN YOUR ALLOWED UID =========================
   After you create your ONE user in Firebase Console → Authentication →
   Users → Add user, copy that user's "User UID" value and paste it here.
   This is the second lock (after the Firestore rules) that guarantees only
   that one account can ever read or write vault data, even if someone
   else somehow authenticates against your project.
============================================================================ */
const ALLOWED_UID = "Ez9L3HdP7hemxtROIDG4xsRnY2g1";

const VAULT_ROOT = "strongbox_vaults"; // top-level Firestore collection name

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let ready = false;

function isConfigured() {
    return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_") &&
        ALLOWED_UID && !ALLOWED_UID.startsWith("PASTE_");
}

async function init() {
    if (!isConfigured()) {
        console.warn(
            "[FirebaseSync] firebase-sync.js is not configured yet — cloud sync is disabled. " +
            "Fill in firebaseConfig and ALLOWED_UID (see the setup guide)."
        );
        return;
    }
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        try {
            await enableIndexedDbPersistence(db);
        } catch (e) {
            // Fails silently in multi-tab scenarios or unsupported browsers —
            // sync still works, it just won't cache Firestore reads offline.
            console.warn("[FirebaseSync] offline persistence not enabled:", e.message);
        }
        onAuthStateChanged(auth, (user) => {
            currentUser = user;
            window.dispatchEvent(new CustomEvent("firebase-auth-changed", { detail: { signedIn: !!user } }));
        });
        ready = true;
    } catch (err) {
        console.error("[FirebaseSync] init failed:", err);
    } finally {
        // Fire this even on failure so script.js's waiter doesn't hang forever.
        window.dispatchEvent(new CustomEvent("firebase-sync-ready"));
    }
}

// --- Auth -------------------------------------------------------------------

async function signIn(email, password) {
    if (!ready) throw new Error("Cloud sync is not configured.");
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (cred.user.uid !== ALLOWED_UID) {
        await signOut(auth);
        throw new Error("This account is not authorized for this vault.");
    }
    return cred.user;
}

async function signOutCloud() {
    if (auth) { try { await signOut(auth); } catch (e) {} }
}

function isSignedIn() {
    return ready && !!currentUser && currentUser.uid === ALLOWED_UID;
}

// --- Records (each mirrors one row of the local IndexedDB "records" store) --

async function pushRecord(rec) {
    if (!isSignedIn()) return false;
    try {
        const ref = doc(db, VAULT_ROOT, ALLOWED_UID, "records", String(rec.id));
        await setDoc(ref, rec);
        return true;
    } catch (err) {
        console.warn("[FirebaseSync] pushRecord failed (will stay queued locally):", err.message);
        return false;
    }
}

async function deleteRecordRemote(id) {
    if (!isSignedIn()) return false;
    try {
        await deleteDoc(doc(db, VAULT_ROOT, ALLOWED_UID, "records", String(id)));
        return true;
    } catch (err) {
        console.warn("[FirebaseSync] deleteRecordRemote failed:", err.message);
        return false;
    }
}

async function pullAllRecords() {
    if (!isSignedIn()) return [];
    const snap = await getDocs(collection(db, VAULT_ROOT, ALLOWED_UID, "records"));
    return snap.docs.map((d) => d.data());
}

// --- Meta (salt, lockEnabled, encryptionEnabled, verifier, etc.) ------------

async function pushMeta(key, value, updatedAt) {
    if (!isSignedIn()) {
        console.warn("[FirebaseSync] pushMeta skipped — not signed in:", key);
        return false;
    }
    try {
        const ref = doc(db, VAULT_ROOT, ALLOWED_UID, "meta", String(key));
        await setDoc(ref, { key, value, updatedAt: updatedAt || Date.now() });
        return true;
    } catch (err) {
        console.warn("[FirebaseSync] pushMeta failed:", err.message);
        return false;
    }
}

async function pullAllMeta() {
    if (!isSignedIn()) return [];
    const snap = await getDocs(collection(db, VAULT_ROOT, ALLOWED_UID, "meta"));
    return snap.docs.map((d) => d.data());
}

window.FirebaseSync = {
    isConfigured,
    signIn,
    signOut: signOutCloud,
    isSignedIn,
    pushRecord,
    deleteRecordRemote,
    pullAllRecords,
    pushMeta,
    pullAllMeta
};

init();
