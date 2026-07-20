(function() {
    "use strict";

    /* ============ START OF CONSTANTS ============ */
    const DB_NAME = 'strongboxSecureDB';
    const DB_VERSION = 1;
    const TRASH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const PBKDF2_ITER = 210000;
    const AUTOLOCK_DEFAULT_MIN = 5;
    /* ============ END OF CONSTANTS ============ */

    /* ============ START OF STATE ============ */
    let db = null;
    let cryptoKey = null;
    // Kept in memory only (never written to disk) so the "Sync now" button in
    // Settings can re-authenticate to Firebase without asking again. Cleared
    // whenever the vault locks.
    let lastUnlockEmail = null;
    let lastUnlockPassword = null;
    let saltB64 = null;
    let lockEnabled = false;
    let syncMode = 'device'; // 'device' = local-only lock, 'cloud' = Firebase-backed lock
    let encryptionEnabled = false;
    let autoLockMinutes = AUTOLOCK_DEFAULT_MIN;
    let isLocked = false;
    let panicLockEnabled = false;

    let vaultItems = [];
    let vaultCategories = getPref('vaultCategories', ['Google Account', 'Social Media', 'Email', 'Banking', 'Work',
        'Personal', 'Shopping', 'Gaming', 'Streaming', 'Developer'
    ]);
    let activeVaultFilter = getPref('vaultFilter', 'all');
    let vaultCardStyle = getPref('vaultCardStyle', 'card'); // 'card' | 'row'

    let goalItems = [];
    let goalCategories = getPref('goalCategories', ['Financial', 'Health', 'Career']);
    let activeGoalFilter = getPref('goalFilter', 'all');

    let folders = [];
    let notes = [];
    let trashItems = [];

    let editingVaultId = null;
    let editingGoalId = null;
    let selectedFolderId = null;
    let selectedNoteId = null;

    let searchIndex = { vault: new Map(), goals: new Map(), notes: new Map(), folders: new Map() };

 let autoLockTimer = null;
    let profileAvatarDataUrl = null;
    let toastTimer = null;
    let clipboardTimer = null;
    /* ============ END OF STATE ============ */

    /* ============ START OF CARD STATE & SCHEMAS ============ */
    let cardItems = [];
    let activeCardFilter = 'all';
    let editingCardId = null;
    let vaultMode = 'passwords'; // 'passwords' | 'cards'

    const CARD_TYPES = [
        'store', 'debit', 'credit', 'gift',
        'insurance', 'medicalAid', 'student', 'drivingLicense',
        'passport', 'id'
    ];

    const CARD_TYPE_LABELS = {
        store: 'Store Card (Retail)',
        debit: 'Debit Card',
        credit: 'Credit Card',
        gift: 'Gift Card',
        insurance: 'Insurance Card',
        medicalAid: 'Medical Aid',
        student: 'Student Card',
        drivingLicense: 'Driving License',
        passport: 'Passport',
        id: 'SA Smart ID Card'
    };

    const CARD_TYPE_ICONS = {
        store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18l-2-5H5l-2 5Z"/><path d="M4 9v11h16V9"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
        debit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>',
        credit: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><rect x="4" y="8" width="4" height="3" rx="0.6" fill="currentColor" stroke="none"/><rect x="10" y="8.5" width="8" height="1.2" rx="0.6"/><rect x="4" y="13.5" width="12" height="1.2" rx="0.6"/></svg>',
        gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="8" x2="12" y2="21"/><path d="M12 8c-2-3-6-3-6 0s4 0 6 0Zm0 0c2-3 6-3 6 0s-4 0-6 0Z"/></svg>',
        insurance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v5c0 5-3 9-7 9s-7-4-7-9V7l7-4Z"/><path d="M9 12l2 2 4-4"/></svg>',
        medicalAid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>',
        student: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10l10-5 10 5-10 5-10-5Z"/><path d="M12 15v5"/><path d="M5 12v5c0 2 3 3 7 3s7-1 7-3v-5"/></svg>',
        drivingLicense: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16V11l2.2-4.4A2 2 0 0 1 7 5.5h10a2 2 0 0 1 1.8 1.1L21 11v5"/><path d="M3 16h18v2a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1H6.5v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2Z"/><circle cx="7.5" cy="16" r="1.6" fill="currentColor" stroke="none"/><circle cx="16.5" cy="16" r="1.6" fill="currentColor" stroke="none"/></svg>',
        passport: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>',
        id: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><line x1="12" y1="10" x2="18" y2="10"/><line x1="12" y1="14" x2="18" y2="14"/></svg>'
    };

    const CARD_SCHEMAS = {
        store: {
            fields: [
                { key: 'storeName', label: 'Store Name', type: 'text', required: true },
                { key: 'cardNumber', label: 'Card Number / Account No.', type: 'text' },
                { key: 'cardholderName', label: 'Cardholder Name', type: 'text' },
                { key: 'expiry', label: 'Expiry (MM/YY)', type: 'text' },
                { key: 'paymentNetwork', label: 'Payment Network', type: 'select', options: ['Visa',
                        'Mastercard', 'No Network'
                    ] },
                { key: 'idNumber', label: 'SA ID Number (Linked)', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'storeName', secondary: 'cardNumber', tertiary: 'expiry', expiry: true },
            color: '#2e7d32'
        },
        debit: {
            fields: [
                { key: 'bankName', label: 'Bank Name', type: 'text', required: true },
                { key: 'cardNumber', label: 'Card Number', type: 'text' },
                { key: 'cardholderName', label: 'Cardholder Name', type: 'text' },
                { key: 'expiry', label: 'Expiry (MM/YY)', type: 'text' },
                { key: 'cvv', label: 'CVV/CVC', type: 'password' },
                { key: 'paymentNetwork', label: 'Card Network', type: 'select', options: ['Visa',
                        'Mastercard', 'American Express'
                    ] },
                { key: 'issuingCountry', label: 'Issuing Country', type: 'text' },
                { key: 'pin', label: 'ATM/PIN (store at your own risk)', type: 'password',
                    maskDefault: true },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'bankName', secondary: 'cardNumber', tertiary: 'expiry', expiry: true },
            color: '#0d47a1'
        },
        credit: {
            fields: [
                { key: 'bankName', label: 'Bank Name', type: 'text', required: true },
                { key: 'cardNumber', label: 'Card Number', type: 'text' },
                { key: 'cardholderName', label: 'Cardholder Name', type: 'text' },
                { key: 'expiry', label: 'Expiry (MM/YY)', type: 'text' },
                { key: 'cvv', label: 'CVV/CVC', type: 'password' },
                { key: 'paymentNetwork', label: 'Card Network', type: 'select', options: ['Visa',
                        'Mastercard', 'American Express'
                    ] },
                { key: 'billingAddress', label: 'Billing Address', type: 'textarea' },
                { key: 'linkedPhone', label: 'Linked Phone (3D Secure OTP)', type: 'text' },
                { key: 'pin', label: 'ATM/PIN (store at your own risk)', type: 'password',
                    maskDefault: true },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'bankName', secondary: 'cardNumber', tertiary: 'expiry', expiry: true },
            color: '#e65100'
        },
        gift: {
            fields: [
                { key: 'storeName', label: 'Store Name', type: 'text', required: true },
                { key: 'voucherNumber', label: 'Voucher / Card Number', type: 'text' },
                { key: 'pinCode', label: 'PIN / Security Code', type: 'password' },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'storeName', secondary: 'voucherNumber', tertiary: null, expiry: false },
            color: '#c2185b'
        },
        insurance: {
            fields: [
                { key: 'provider', label: 'Provider', type: 'text', required: true },
                { key: 'policyNumber', label: 'Policy Number', type: 'text' },
                { key: 'expiry', label: 'Expiry (MM/YY)', type: 'text' },
                { key: 'emergencyNumber', label: 'Emergency / Claim Hotline', type: 'text' },
                { key: 'brokerName', label: 'Broker Name', type: 'text' },
                { key: 'brokerContact', label: 'Broker Contact', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'provider', secondary: 'policyNumber', tertiary: 'expiry', expiry: true },
            color: '#b71c1c'
        },
        medicalAid: {
            fields: [
                { key: 'provider', label: 'Provider', type: 'text', required: true },
                { key: 'mainMemberName', label: 'Main Member Name', type: 'text' },
                { key: 'memberNumber', label: 'Member Number', type: 'text' },
                { key: 'dependentCode', label: 'Dependent Code (e.g., 00, 01, 02)', type: 'text' },
                { key: 'plan', label: 'Plan', type: 'text' },
                { key: 'emergencyNumber', label: 'Emergency / Authorization Number', type: 'text' },
                { key: 'gapCoverProvider', label: 'Gap Cover Provider', type: 'text' },
                { key: 'gapCoverPolicy', label: 'Gap Cover Policy Number', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'provider', secondary: 'memberNumber', tertiary: 'plan', expiry: false },
            color: '#00695c'
        },
        student: {
            fields: [
                { key: 'schoolName', label: 'School / Institution', type: 'text', required: true },
                { key: 'studentNumber', label: 'Student Number', type: 'text' },
                { key: 'campus', label: 'Campus / Branch', type: 'text' },
                { key: 'issueDate', label: 'Issue Date', type: 'text' },
                { key: 'expiry', label: 'Expiry (MM/YY)', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'schoolName', secondary: 'studentNumber', tertiary: 'campus', expiry: true },
            color: '#283593'
        },
        drivingLicense: {
            fields: [
                { key: 'licenseNumber', label: 'License Number', type: 'text', required: true },
                { key: 'cardSerialNumber', label: 'Card Serial Number (back of card)', type: 'text' },
                { key: 'vehicleCodes', label: 'Vehicle Codes (e.g., B, EB, EC1)', type: 'text' },
                { key: 'restrictions', label: 'Restrictions (e.g., 05 = spectacles)', type: 'text' },
                { key: 'expiry', label: 'Expiry (MM/YY)', type: 'text' },
                { key: 'issueDate', label: 'Issue Date', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'licenseNumber', secondary: 'vehicleCodes', tertiary: 'expiry',
                expiry: true },
            color: '#37474f'
        },
        passport: {
            fields: [
                { key: 'passportNumber', label: 'Passport Number', type: 'text', required: true },
                { key: 'nationality', label: 'Nationality', type: 'text' },
                { key: 'dateOfBirth', label: 'Date of Birth', type: 'text' },
                { key: 'gender', label: 'Gender', type: 'text' },
                { key: 'placeOfIssue', label: 'Place of Issue', type: 'text' },
                { key: 'issueDate', label: 'Issue Date', type: 'text' },
                { key: 'expiry', label: 'Expiry (MM/YY)', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'passportNumber', secondary: 'nationality', tertiary: 'expiry',
                expiry: true },
            color: '#33691e'
        },
        id: {
            fields: [
                { key: 'idNumber', label: 'SA ID Number', type: 'text', required: true },
                { key: 'dateOfBirth', label: 'Date of Birth', type: 'text' },
                { key: 'gender', label: 'Gender', type: 'text' },
                { key: 'countryOfBirth', label: 'Country of Birth', type: 'text' },
                { key: 'status', label: 'Status', type: 'select', options: ['Citizen',
                        'Permanent Resident'
                    ] },
                { key: 'expiry', label: 'Expiry (N/A for citizens)', type: 'text', nullable: true },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ],
            preview: { primary: 'idNumber', secondary: 'status', tertiary: null, expiry: false },
            color: '#bf360c'
        }
    };

    const CARD_COLORS = {
        store: '#2e7d32',
        debit: '#0d47a1',
        credit: '#e65100',
        gift: '#c2185b',
        insurance: '#b71c1c',
        medicalAid: '#00695c',
        student: '#283593',
        drivingLicense: '#37474f',
        passport: '#33691e',
        id: '#bf360c'
    };
    /* ============ END OF CARD STATE & SCHEMAS ============ */

    /* ============ START OF SMALL HELPERS ============ */
    function $(id) { return document.getElementById(id); }

    function uid() { return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); }

    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
            "'": '&#39;' }[c]));
    }

    function escapeAttr(s) { return escapeHTML(s).replace(/"/g, '&quot;'); }

    function ab2b64(buf) {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    function b642ab(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
    }

    function isURL(text) {
        if (!text || typeof text !== 'string') return false;
        return /^https?:\/\/[^\s/$.?#].[^\s]*/i.test(text) ||
            /www\.[^\s/$.?#]+\.[^\s]*/i.test(text) ||
            /[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?(?:\/[^\s]*)?/i.test(text);
    }

    function extractURL(text) {
        if (!text || typeof text !== 'string') return null;
        const patterns = [
            /https?:\/\/[^\s/$.?#].[^\s]*/i,
            /www\.[^\s/$.?#]+\.[^\s]*/i,
            /[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?(?:\/[^\s]*)?/i.test(text)
        ];
        for (const p of patterns) {
            const m = text.match(p);
            if (m) {
                let url = m[0];
                if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
                return url;
            }
        }
        return null;
    }
    /* ============ END OF SMALL HELPERS ============ */

    /* ============ START OF CRYPTO ============ */
    async function deriveKey(password, saltBytesB64) {
        const enc = new TextEncoder();
        const saltBuf = b642ab(saltBytesB64);
        const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(saltBuf), iterations: PBKDF2_ITER,
            hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    function randomSaltB64() {
        const s = crypto.getRandomValues(new Uint8Array(16));
        return ab2b64(s.buffer);
    }

    async function encryptString(key, plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
        return { iv: ab2b64(iv.buffer), cipher: ab2b64(cipherBuf) };
    }

    async function decryptString(key, ivB64, cipherB64) {
        const iv = new Uint8Array(b642ab(ivB64));
        const cipherBuf = b642ab(cipherB64);
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
        return new TextDecoder().decode(plainBuf);
    }

    async function encryptJSON(key, obj) { return encryptString(key, JSON.stringify(obj)); }

    async function decryptJSON(key, ivB64, cipherB64) { return JSON.parse(await decryptString(key, ivB64,
        cipherB64)); }
    /* ============ END OF CRYPTO ============ */

    /* ============ START OF INDEXEDDB ============ */
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function(e) {
                const _db = e.target.result;
                if (!_db.objectStoreNames.contains('meta')) {
                    _db.createObjectStore('meta', { keyPath: 'key' });
                }
                if (!_db.objectStoreNames.contains('records')) {
                    const store = _db.createObjectStore('records', { keyPath: 'id' });
                    store.createIndex('byStore', 'store', { unique: false });
                }
            };
            req.onsuccess = function(e) { resolve(e.target.result); };
            req.onerror = function(e) { reject(e.target.error || new Error('Failed to open database')); };
        });
    }

    function tx(storeName, mode) {
        return db.transaction(storeName, mode).objectStore(storeName);
    }

    function idbGet(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const req = tx(storeName, 'readonly').get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            } catch (err) { reject(err); }
        });
    }

    function idbPut(storeName, value) {
        return new Promise((resolve, reject) => {
            try {
                const req = tx(storeName, 'readwrite').put(value);
                req.onsuccess = () => resolve(true);
                req.onerror = () => reject(req.error);
            } catch (err) { reject(err); }
        });
    }

    function idbDelete(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const req = tx(storeName, 'readwrite').delete(key);
                req.onsuccess = () => resolve(true);
                req.onerror = () => reject(req.error);
            } catch (err) { reject(err); }
        });
    }

    function idbGetAllByStore(storeType) {
        return new Promise((resolve, reject) => {
            try {
                const idx = tx('records', 'readonly').index('byStore');
                const req = idx.getAll(IDBKeyRange.only(storeType));
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            } catch (err) { reject(err); }
        });
    }

    function idbGetAllMeta() {
        return new Promise((resolve, reject) => {
            try {
                const req = tx('meta', 'readonly').getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            } catch (err) { reject(err); }
        });
    }

    function idbGetAllRecordsRaw() {
        return new Promise((resolve, reject) => {
            try {
                const req = tx('records', 'readonly').getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            } catch (err) { reject(err); }
        });
    }
    /* ============ END OF INDEXEDDB ============ */

    /* ============ START OF CLOUD SYNC ============ */
    // script.js never talks to Firebase directly — it only calls the methods
    // exposed on window.FirebaseSync by js/firebase-sync.js, and only ever
    // hands it already-encrypted records (iv/cipher) or non-secret meta.
    let cloudSyncing = false;

    function waitForFirebaseSyncReady(timeoutMs) {
        return new Promise((resolve) => {
            if (window.FirebaseSync) return resolve(true);
            let done = false;
            const finish = (ok) => { if (done) return;
                done = true;
                window.removeEventListener('firebase-sync-ready', onReady);
                resolve(ok); };
            const onReady = () => finish(!!window.FirebaseSync);
            window.addEventListener('firebase-sync-ready', onReady);
            setTimeout(() => finish(!!window.FirebaseSync), timeoutMs || 4000);
        });
    }

    function updateCloudSyncStatusUI(state, detail) {
        const pill = document.getElementById('cloudSyncStatusPill');
        if (!pill) return;
        if (state === 'synced') {
            pill.className = 'status-pill on';
            pill.textContent = 'Synced';
        } else if (state === 'error') {
            pill.className = 'status-pill off';
            pill.textContent = detail || 'Sync unavailable';
        } else if (state === 'syncing') {
            pill.className = 'status-pill';
            pill.textContent = 'Syncing…';
        } else {
            pill.className = 'status-pill off';
            pill.textContent = 'Not signed in';
        }
    }

    async function syncPushRecord(rec) {
        try { if (window.FirebaseSync) await window.FirebaseSync.pushRecord(rec); } catch (e) {
            console.warn('Cloud push failed', e); }
    }

    async function syncDeleteRecord(id) {
        try { if (window.FirebaseSync) await window.FirebaseSync.deleteRecordRemote(id); } catch (e) {
            console.warn('Cloud delete failed', e); }
    }

    async function syncPushMeta(key, value, updatedAt) {
        try {
            if (!window.FirebaseSync) return false;
            return await window.FirebaseSync.pushMeta(key, value, updatedAt);
        } catch (e) {
            console.warn('Cloud meta push failed', e);
            return false;
        }
    }

    async function deleteRecordEverywhere(id) {
        await idbDelete('records', id);
        syncDeleteRecord(id);
    }

    // Pulls remote records/meta, merges with local by updatedAt (last write
    // wins), pushes anything local-only or newer back up, then reloads the
    // in-memory vault from IndexedDB so the UI reflects the merged result.
    async function mergeCloudData() {
    if (!window.FirebaseSync || !window.FirebaseSync.isSignedIn()) return;

    // --- 1. Sync META bidirectionally ---
    const remoteMetaList = await window.FirebaseSync.pullAllMeta();
    const remoteMetaMap = new Map(remoteMetaList.map(m => [m.key, m]));

    const localMetaList = await idbGetAllMeta();
    const localMetaMap = new Map(localMetaList.map(m => [m.key, m]));

    // Pull remote meta -> local (if remote is newer or local missing)
    for (const [key, remote] of remoteMetaMap) {
        const local = localMetaMap.get(key);
        if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
            await idbPut('meta', { key: remote.key, value: remote.value, updatedAt: remote.updatedAt || Date.now() });
        }
    }

    // Push local meta -> remote (if local is newer, skip critical password keys)
    const META_SYNC_BLOCKLIST = ['salt', 'verifierIv', 'verifierCipher'];
    for (const [key, local] of localMetaMap) {
        if (META_SYNC_BLOCKLIST.includes(key)) continue;
        const remote = remoteMetaMap.get(key);
        if (!remote || (local.updatedAt || 0) > (remote.updatedAt || 0)) {
            try {
                await window.FirebaseSync.pushMeta(key, local.value);
            } catch (e) {
                console.warn('Failed to push meta', key, e);
            }
        }
    }

    // --- 2. Sync RECORDS (existing logic, unchanged) ---
    const remoteRecords = await window.FirebaseSync.pullAllRecords();
    const remoteById = new Map(remoteRecords.map(r => [String(r.id), r]));
    const localRecords = await idbGetAllRecordsRaw();
    const localById = new Map(localRecords.map(r => [String(r.id), r]));

    for (const rr of remoteRecords) {
        const lr = localById.get(String(rr.id));
        if (!lr || (rr.updatedAt || 0) > (lr.updatedAt || 0)) {
            await idbPut('records', rr);
        }
    }
    for (const lr of localRecords) {
        const rr = remoteById.get(String(lr.id));
        if (!rr || (lr.updatedAt || 0) > (rr.updatedAt || 0)) {
            syncPushRecord(lr);
        }
    }
}

    // Called after a successful local unlock. Signs in to Firebase with the
    // same email/password used to unlock the vault, merges cloud data in,
    // and reloads the UI. Any failure (offline, misconfigured, wrong cloud
    // account) is swallowed — the local vault keeps working regardless.
    async function performCloudSync(email, password) {
        if (cloudSyncing) return;
        cloudSyncing = true;
        updateCloudSyncStatusUI('syncing');
        try {
            const fbReady = await waitForFirebaseSyncReady();
            if (!fbReady || !window.FirebaseSync.isConfigured()) {
                updateCloudSyncStatusUI('idle');
                return;
            }
            await window.FirebaseSync.signIn(email, password);
            await mergeCloudData();
            await loadAllData();
            initGenUsedFromVault();
            renderEverything();
            updateCloudSyncStatusUI('synced');
        } catch (err) {
            console.warn('Cloud sync skipped:', err.message);
            updateCloudSyncStatusUI('error', err.message);
        } finally {
            cloudSyncing = false;
        }
    }
    /* ============ END OF CLOUD SYNC ============ */

    /* ============ START OF RECORD SAVE/LOAD ============ */
    async function writeRecord(storeType, item, extra) {
        const rec = Object.assign({ id: item.id, store: storeType }, extra || {});
        if (encryptionEnabled && cryptoKey) {
            const { iv, cipher } = await encryptJSON(cryptoKey, item);
            rec.iv = iv;
            rec.cipher = cipher;
            rec.plain = false;
        } else {
            rec.data = item;
            rec.plain = true;
        }
        rec.updatedAt = Date.now();
        await idbPut('records', rec);
        syncPushRecord(rec);
        return rec;
    }

    async function readRecordData(rec) {
        if (rec.plain) return rec.data;
        if (!cryptoKey) throw new Error('Locked');
        return decryptJSON(cryptoKey, rec.iv, rec.cipher);
    }

    async function loadStore(storeType) {
        const recs = await idbGetAllByStore(storeType);
        const out = [];
        for (const r of recs) {
            try { out.push(await readRecordData(r)); } catch (e) { console.warn('Skipping unreadable record', r.id,
                    e); }
        }
        return out;
    }

async function loadProfileSettings() {
        const profile = await getMeta('userProfile', null);
        profileAvatarDataUrl = (profile && profile.avatar) ? profile.avatar : null;
        $('profileName').value = profile && profile.name ? profile.name : '';
        $('profileEmail').value = profile && profile.email ? profile.email : '';
        $('profileGender').value = profile && profile.gender ? profile.gender : '';
        $('profileBio').value = profile && profile.bio ? profile.bio : '';
        renderProfileAvatarPreview();
    }

    function renderProfileAvatarPreview() {
        const img = $('profileAvatarImg');
        const initialSpan = $('profileAvatarInitial');
        if (profileAvatarDataUrl) {
            img.src = profileAvatarDataUrl;
            img.style.display = 'block';
            initialSpan.style.display = 'none';
        } else {
            img.style.display = 'none';
            initialSpan.style.display = 'block';
            const name = $('profileName').value.trim();
            initialSpan.textContent = name ? name.charAt(0).toUpperCase() : '?';
        }
    }

    async function saveProfileSettings() {
        const profile = {
            name: $('profileName').value.trim(),
            email: $('profileEmail').value.trim(),
            gender: $('profileGender').value,
            bio: $('profileBio').value.trim(),
            avatar: profileAvatarDataUrl
        };
        await setMeta('userProfile', profile);
        renderProfileAvatarPreview();
        showToast('Profile saved');
    }

    async function getMeta(key, fallback) {
        const rec = await idbGet('meta', key);
        return rec ? rec.value : fallback;
    }

async function setMeta(key, value) {
    const now = Date.now();
    await idbPut('meta', { key, value, updatedAt: now });
    const pushed = await syncPushMeta(key, value, now);
    if (!pushed && window.FirebaseSync && window.FirebaseSync.isConfigured()) {
        updateCloudSyncStatusUI('error', 'Change not synced yet');
    }
    return true;
}

    function readImageAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function getPref(key, fallback) {
        try { const v = localStorage.getItem('sb_' + key); return v === null ? fallback : JSON.parse(v); } catch (
            e) { return fallback; }
    }

    function setPref(key, value) {
        try { localStorage.setItem('sb_' + key, JSON.stringify(value)); } catch (e) {}
    }
    /* ============ END OF RECORD SAVE/LOAD ============ */

    /* ============ START OF THEME ============ */
    function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    setPref('theme', theme);
    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === theme);
    });
}
    /* ============ END OF THEME ============ */

    /* ============ START OF SIDEBAR ============ */
    function applySidebarCollapsed(collapsed) {
        const sb = $('sidebar');
        sb.classList.toggle('collapsed', collapsed);
        $('sidebarCollapseBtn').setAttribute('data-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        setPref('sidebarCollapsed', collapsed);
    }

    function initSidebarCollapse() {
        applySidebarCollapsed(getPref('sidebarCollapsed', false));
        $('sidebarCollapseBtn').addEventListener('click', function() {
            const now = !$('sidebar').classList.contains('collapsed');
            applySidebarCollapsed(now);
            hideTooltip();
        });
        const tooltip = $('sbTooltip');

        function showTip(el) {
            if (!$('sidebar').classList.contains('collapsed')) return;
            const label = el.getAttribute('data-label') || el.querySelector('span')?.textContent || '';
            if (!label) return;
            const rect = el.getBoundingClientRect();
            tooltip.textContent = label;
            tooltip.style.left = (rect.right + 10) + 'px';
            tooltip.style.top = (rect.top + rect.height / 2) + 'px';
            tooltip.classList.add('show');
        }

        function hideTooltip() { tooltip.classList.remove('show'); }
        window.hideTooltip = hideTooltip;
        document.querySelectorAll('.sidebar .nav-item, .sidebar-collapse-btn, .brand-btn').forEach(el => {
            el.addEventListener('mouseenter', () => showTip(el));
            el.addEventListener('mouseleave', hideTooltip);
        });
    }
    /* ============ END OF SIDEBAR ============ */

    /* ============ START OF MOBILE NOTEPAD TABS ============ */
    function showMobileNotepadPanel(name) {
        document.querySelectorAll('.mobile-note-tabs .mnt-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.panel === name));
        $('notepadView').querySelectorAll('.notepad-panel').forEach(p => p.classList.remove('mobile-active'));
        const map = { folders: '.panel-folders', notes: '.panel-notes', editor: '.panel-editor' };
        const panel = $('notepadView').querySelector(map[name]);
        if (panel) panel.classList.add('mobile-active');
    }
    function initMobileNotepadTabs() {
        document.querySelectorAll('.mobile-note-tabs .mnt-btn').forEach(btn => {
            btn.addEventListener('click', () => showMobileNotepadPanel(btn.dataset.panel));
        });
    }
    const isMobileWidth = () => window.matchMedia('(max-width: 820px)').matches;
    /* ============ END OF MOBILE NOTEPAD TABS ============ */

    /* ============ START OF MOBILE SIDEBAR ============ */
    function openMobileSidebar() {
        $('sidebar').classList.add('mobile-open');
        $('mobileSidebarBackdrop').classList.add('show');
    }
    function closeMobileSidebar() {
        $('sidebar').classList.remove('mobile-open');
        $('mobileSidebarBackdrop').classList.remove('show');
    }
    function initMobileSidebar() {
        $('mobileMenuBtn').addEventListener('click', openMobileSidebar);
        $('mobileSidebarBackdrop').addEventListener('click', closeMobileSidebar);
    }
    /* ============ END OF MOBILE SIDEBAR ============ */

    /* ============ START OF TABS ============ */
    function switchTab(tab) {
        closeMobileSidebar();
        document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const view = $(tab + 'View');
        if (view) view.classList.add('active');
        if (tab === 'settings') refreshSettingsView();
        if (tab === 'notepad') { renderFolders();
            renderNotes(); }
        if (tab === 'vault') { renderVaultMode(); }
    }
    /* ============ END OF TABS ============ */

    /* ============ START OF TOAST ============ */

    function promptUpdate(registration) {
        // Simple version — replace with your own UI (toast/banner) if you like
        const wantsUpdate = confirm('A new version of Strongbox is available. Reload now?');
        if (wantsUpdate) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            // Reload once the new SW takes control
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            });
        }
    }

       function showToast(msg, isError) {
        const t = $('toast');
        clearTimeout(toastTimer);
        // Check if this is an update notification (starts with "A new version")
        const isUpdate = typeof msg === 'string' && msg.startsWith('A new version');
        const iconOk = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        const iconErr = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        const iconUpdate = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
        let icon = isError ? iconErr : (isUpdate ? iconUpdate : iconOk);
        t.innerHTML = icon + '<span>' + escapeHTML(msg) + '</span>';
        t.classList.toggle('err', !!isError);
        if (isUpdate) {
            t.classList.add('update-toast');
        } else {
            t.classList.remove('update-toast');
        }
        t.classList.add('show');
        toastTimer = setTimeout(() => t.classList.remove('show'), isUpdate ? 6000 : 3200);
    }
    /* ============ END OF TOAST ============ */

    /* ============ START OF EYE TOGGLES ============ */
    function wireEyeToggles(root) {
        (root || document).querySelectorAll('.eye-toggle').forEach(btn => {
            if (btn._wired) return;
            btn._wired = true;
            btn.addEventListener('click', function() {
                const input = $(btn.dataset.target);
                if (!input) return;
                input.type = input.type === 'password' ? 'text' : 'password';
            });
        });
        const lockEye = $('lockToggleVis');
        if (lockEye && !lockEye._wired) {
            lockEye._wired = true;
            lockEye.addEventListener('click', function() {
                const input = $('lockPasswordInput');
                input.type = input.type === 'password' ? 'text' : 'password';
            });
        }
    }
    /* ============ END OF EYE TOGGLES ============ */

    /* ============ START OF SEARCH INDEX ============ */
    function tokenize(str) {
        if (!str) return [];
        return String(str).toLowerCase().normalize('NFKD').replace(/[^\w\s@.-]/g, ' ').split(/\s+/).filter(Boolean);
    }

    function addToIndex(map, id, text) {
        const tokens = new Set(tokenize(text));
        tokens.forEach(tok => {
            for (let len = 2; len <= tok.length; len++) {
                const prefix = tok.slice(0, len);
                if (!map.has(prefix)) map.set(prefix, new Set());
                map.get(prefix).add(id);
            }
            if (!map.has(tok)) map.set(tok, new Set());
            map.get(tok).add(id);
        });
    }

    function buildSearchIndex() {
        searchIndex = { vault: new Map(), goals: new Map(), notes: new Map(), folders: new Map() };
        vaultItems.forEach(it => addToIndex(searchIndex.vault, it.id, [it.name, it.username, it.description].join(
            ' ')));
        goalItems.forEach(it => addToIndex(searchIndex.goals, it.id, [it.name, it.description].join(' ')));
        notes.forEach(it => addToIndex(searchIndex.notes, it.id, [it.title, stripHTML(it.contentHTML)].join(
            ' ')));
        folders.forEach(it => addToIndex(searchIndex.folders, it.id, it.name));
        saveSearchIndexEncrypted().catch(() => {});
    }

    function stripHTML(html) {
        const d = document.createElement('div');
        d.innerHTML = html || '';
        return d.textContent || '';
    }

    async function saveSearchIndexEncrypted() {
        if (!encryptionEnabled || !cryptoKey) return;
        const plain = {};
        Object.keys(searchIndex).forEach(k => {
            plain[k] = Array.from(searchIndex[k].entries()).map(([tok, ids]) => [tok, Array.from(ids)]);
        });
        const { iv, cipher } = await encryptJSON(cryptoKey, plain);
        await setMeta('searchIndexIv', iv);
        await setMeta('searchIndexCipher', cipher);
    }

    function searchByIndex(map, query) {
        const q = tokenize(query).join(' ').trim();
        if (!q) return null;
        const parts = q.split(/\s+/);
        let resultSets = [];
        for (const part of parts) {
            const set = map.get(part);
            resultSets.push(set ? set : new Set());
        }
        if (resultSets.length === 0) return new Set();
        let intersection = resultSets[0];
        for (let i = 1; i < resultSets.length; i++) {
            intersection = new Set(Array.from(intersection).filter(id => resultSets[i].has(id)));
        }
        return intersection;
    }
    /* ============ END OF SEARCH INDEX ============ */

    /* ============ START OF VAULT RENDER ============ */
    function renderVault() {
        const list = $('vaultList');
        const query = $('vaultSearch').value.trim();
        let items = vaultItems;

        if (activeVaultFilter !== 'all') {
            items = items.filter(it => it.category === activeVaultFilter);
        }
        if (query) {
            const matchIds = searchByIndex(searchIndex.vault, query);
            items = items.filter(it => matchIds.has(it.id));
        }
        items = items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        $('vaultCount').textContent = vaultItems.length + (vaultItems.length === 1 ? ' entry' : ' entries') + (query ?
            ' · ' + items.length + ' shown' : '');

        if (items.length === 0) {
            list.innerHTML = emptyStateHTML(
                '<rect x="3" y="10" width="18" height="10" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
                vaultItems.length === 0 ? 'No entries yet' : 'No matches',
                vaultItems.length === 0 ? 'Add your first credential, PIN, or secure note.' :
                'Try a different search term.'
            );
            return;
        }

        list.classList.toggle('vault-list-row', vaultCardStyle === 'row');

        list.innerHTML = items.map(item => {
            const secretId = 'sec_' + item.id;
            if (vaultCardStyle === 'row') return renderVaultRowHTML(item, secretId);
            return '<div class="entry-card" data-id="' + item.id + '">' +
                '<div class="entry-tab">VAULT</div>' +
                '<div class="entry-top">' +
                '<div><div class="entry-name">' + escapeHTML(item.name) +
                (isURL(item.name) ? ' <button class="open-link-btn" title="Open link" data-url="' + escapeAttr(
                    extractURL(item.name)) +
                '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>' :
                    '') +
                '</div>' +
                (item.description ? '<div class="entry-desc">' + escapeHTML(item.description) + '</div>' :
                    '') +
                (item.category ? '<span class="goal-category-tag">' + escapeHTML(item.category) +
                    '</span>' : '') +
                '</div>' +
                '<div class="entry-menu">' +
                '<button class="icon-btn edit-vault" title="Edit">' + iconEdit() + '</button>' +
                '<button class="icon-btn danger delete-vault" title="Move to trash">' + iconTrash() +
                '</button>' +
                '</div>' +
                '</div>' +
                '<div class="field-row">' +
                (item.username ? '<div class="field"><span class="field-label">Username / Email</span><div class="field-value">' +
                    '<span>' + escapeHTML(item.username) + '</span>' +
                    '<button class="mini-icon-btn copy-btn" data-copy="' + escapeAttr(item.username) +
                    '" title="Copy">' + iconCopy() + '</button>' +
                    '</div></div>' : '') +
                '<div class="field"><span class="field-label">Password / PIN</span><div class="field-value secret">' +
                '<span id="' + secretId + '" data-secret="' + escapeAttr(item.password || '') + '">' + '•'.repeat(
                    Math.min(item.password ? item.password.length : 8, 14)) + '</span>' +
                '<button class="mini-icon-btn reveal-btn" data-target="' + secretId +
                '" title="Show/hide">' + iconEye() + '</button>' +
                '<button class="mini-icon-btn copy-btn" data-copy="' + escapeAttr(item.password || '') +
                '" title="Copy">' + iconCopy() + '</button>' +
                '</div></div>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    function setVaultCardStyle(style) {
        vaultCardStyle = style;
        setPref('vaultCardStyle', style);
        $('vaultViewToggleLabel').textContent = style === 'row' ? 'View: Compact' : 'View: Cards';
        renderVault();
    }


    function getVaultHostname(item) {
        const raw = (item.logoUrl && item.logoUrl.trim()) ? item.logoUrl.trim() :
            (isURL(item.name) ? item.name : null);
        if (!raw) return null;
        let url = extractURL(raw) || raw;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        try {
            const hostname = new URL(url).hostname.replace(/^www\./i, '');
            return hostname || null;
        } catch (e) {
            return null;
        }
    }
    
    function renderVaultRowHTML(item, secretId) {
    const initial = (item.name || '?').trim().charAt(0).toUpperCase() || '?';
    const hostname = getVaultHostname(item);
    const iconHTML = hostname ?
        '<img src="https://icons.duckduckgo.com/ip3/' + escapeAttr(hostname) + '.ico" alt="" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
        '<span class="entry-row-icon-fallback" style="display:none;">' + escapeHTML(initial) + '</span>' :
        '<span class="entry-row-icon-fallback" style="display:flex;">' + escapeHTML(initial) + '</span>';
    return '<div class="entry-card entry-row" data-id="' + item.id + '">' +
        '<div class="entry-row-icon">' + iconHTML + '</div>' +
        '<div class="entry-row-main">' +
        '<div class="entry-row-name">' + escapeHTML(item.name) +
        (isURL(item.name) ? ' <button class="open-link-btn" title="Open link" data-url="' + escapeAttr(
            extractURL(item.name)) +
        '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>' :
            '') +
        (item.category ? ' <span class="goal-category-tag">' + escapeHTML(item.category) + '</span>' : '') +
        '</div>' +
        (item.username ? '<div class="entry-row-user">' + escapeHTML(item.username) + '</div>' : '') +
        '</div>' +
        '<div class="entry-row-side">' +
        '<div class="field-value secret entry-row-secret">' +
        '<span id="' + secretId + '" data-secret="' + escapeAttr(item.password || '') + '">' + '•'.repeat(
            Math.min(item.password ? item.password.length : 8, 14)) + '</span>' +
        '<button class="mini-icon-btn reveal-btn" data-target="' + secretId +
        '" title="Show/hide">' + iconEye() + '</button>' +
        '<button class="mini-icon-btn copy-btn" data-copy="' + escapeAttr(item.password || '') +
        '" title="Copy">' + iconCopy() + '</button>' +
        '</div>' +
        '</div>' +
        '<div class="entry-menu entry-row-actions">' +
        '<button class="icon-btn edit-vault" title="Edit">' + iconEdit() + '</button>' +
        '<button class="icon-btn danger delete-vault" title="Move to trash">' + iconTrash() +
        '</button>' +
        '</div>' +
        '</div>';
}

    function iconEdit() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    }

    function iconTrash() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    }

    function iconCopy() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }

    function iconEye() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
    }

    function iconRestore() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    }

    function emptyStateHTML(iconPath, title, sub) {
        return '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            iconPath + '</svg><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(sub) + '</p></div>';
    }

    function cardEmptyStateHTML(iconPath, title, sub, btnText, btnAction) {
        return '<div class="card-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            iconPath + '</svg><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(sub) +
            '</p><button class="btn btn-primary" id="cardEmptyCreateBtn">' + escapeHTML(btnText) +
            '</button></div>';
    }
    /* ============ END OF VAULT RENDER ============ */

    /* ============ START OF GOALS RENDER ============ */
    function renderGoals() {
        const list = $('goalsList');
        const query = $('goalsSearch').value.trim();
        let items = goalItems;
        if (activeGoalFilter !== 'all') {
            items = items.filter(it => it.category === activeGoalFilter);
        }
        if (query) {
            const matchIds = searchByIndex(searchIndex.goals, query);
            items = items.filter(it => matchIds.has(it.id));
        }
        items = items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        $('goalsCount').textContent = goalItems.length + (goalItems.length === 1 ? ' goal' : ' goals') + (query ?
            ' · ' + items.length + ' shown' : '');

        if (items.length === 0) {
            list.innerHTML = emptyStateHTML(
                '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.4"/>',
                goalItems.length === 0 ? 'No goals yet' : 'No matches',
                goalItems.length === 0 ? 'Set a goal to track your progress.' :
                'Try a different search term.'
            );
            return;
        }

        list.innerHTML = items.map(item => {
            return '<div class="entry-card ' + (item.done ? 'done' : '') + '" data-id="' + item.id + '">' +
                '<div class="entry-tab">GOAL</div>' +
                '<div class="goal-top">' +
                '<div class="goal-check ' + (item.done ? 'done' : '') + '" data-id="' + item.id + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
                '</div>' +
                '<div style="flex:1;">' +
                '<div class="entry-top"><div class="entry-name">' + escapeHTML(item.name) + '</div>' +
                '<div class="entry-menu">' +
                '<button class="icon-btn edit-goal" title="Edit">' + iconEdit() + '</button>' +
                '<button class="icon-btn danger delete-goal" title="Move to trash">' + iconTrash() +
                '</button>' +
                '</div>' +
                '</div>' +
                (item.description ? '<div class="entry-desc">' + escapeHTML(item.description) +
                    '</div>' : '') +
                (item.category ? '<span class="goal-category-tag">' + escapeHTML(item.category) +
                    '</span>' : '') +
                '</div>' +
                '</div></div>';
        }).join('');
    }
    /* ============ END OF GOALS RENDER ============ */

    /* ============ START OF TRASH ============ */
    function typeLabel(t) {
        return { vault: 'VAULT', goals: 'GOAL', folders: 'FOLDER', notes: 'NOTE', cards: 'CARD' }[t] || t
            .toUpperCase();
    }

    function itemDisplayName(type, data) {
        if (type === 'vault') return data.name;
        if (type === 'goals') return data.name;
        if (type === 'folders') return data.name;
        if (type === 'notes') return data.title || '(untitled note)';
        if (type === 'cards') return data.name || data.type || 'Card';
        return 'Item';
    }

    function renderTrash() {
        const list = $('trashList');
        const items = trashItems.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
        $('trashCount').textContent = items.length + (items.length === 1 ? ' item' : ' items');

        if (items.length === 0) {
            list.innerHTML = emptyStateHTML(
                '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
                'Trash is empty',
                'Deleted items will appear here for 30 days.'
            );
            return;
        }
        const now = Date.now();
        list.innerHTML = items.map(t => {
            const daysLeft = Math.max(0, Math.ceil((t.expiresAt - now) / (24 * 60 * 60 * 1000)));
            const urgent = daysLeft <= 3;
            return '<div class="entry-card" data-id="' + t.id + '">' +
                '<div class="entry-tab trash-tab">' + typeLabel(t.type) + '</div>' +
                '<div class="entry-top">' +
                '<div><div class="entry-name">' + escapeHTML(itemDisplayName(t.type, t.data)) +
                '</div>' +
                '<div class="trash-expiry ' + (urgent ? 'urgent' : '') + '">Deletes permanently in ' +
                daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + '</div>' +
                '</div>' +
                '<div class="entry-menu">' +
                '<button class="icon-btn good restore-trash" title="Restore">' + iconRestore() +
                '</button>' +
                '<button class="icon-btn danger delete-trash-perm" title="Delete permanently">' +
                iconTrash() + '</button>' +
                '</div>' +
                '</div></div>';
        }).join('');
    }

    async function clearExpiredTrash() {
        const now = Date.now();
        const expired = trashItems.filter(t => t.expiresAt && t.expiresAt < now);
        if (expired.length === 0) return;
        trashItems = trashItems.filter(t => !t.expiresAt || t.expiresAt >= now);
        await Promise.all(expired.map(t => deleteRecordEverywhere(t.id)));
    }

    async function moveToTrash(item, type) {
        const trashEntry = {
            id: item.id,
            type: type,
            data: JSON.parse(JSON.stringify(item)),
            deletedAt: Date.now(),
            expiresAt: Date.now() + TRASH_EXPIRY_MS
        };
        trashItems.push(trashEntry);
        await deleteRecordEverywhere(item.id);
        await writeRecord('trash', trashEntry, { expiresAt: trashEntry.expiresAt, deletedAt: trashEntry
                .deletedAt });
    }

    async function restoreFromTrash(id) {
        const idx = trashItems.findIndex(t => t.id === id);
        if (idx === -1) throw new Error('Not in trash');
        const entry = trashItems[idx];
        trashItems.splice(idx, 1);
        await deleteRecordEverywhere(entry.id);
        const data = entry.data;
        if (entry.type === 'vault') { vaultItems.push(data);
            await writeRecord('vault', data); } else if (entry.type === 'goals') { goalItems.push(data);
            await writeRecord('goals', data); } else if (entry.type === 'folders') { folders.push(data);
            await writeRecord('folders', data); } else if (entry.type === 'notes') { notes.push(data);
            await writeRecord('notes', data); } else if (entry.type === 'cards') { cardItems.push(data);
            await writeRecord('cards', data); }
    }

    async function permanentlyDeleteTrash(id) {
        trashItems = trashItems.filter(t => t.id !== id);
        await deleteRecordEverywhere(id);
    }

    async function emptyTrash() {
        const ids = trashItems.map(t => t.id);
        trashItems = [];
        await Promise.all(ids.map(id => deleteRecordEverywhere(id)));
    }
    /* ============ END OF TRASH ============ */

    /* ============ START OF NOTEPAD ============ */
    function renderFolders() {
        const list = $('folderList');
        if (folders.length === 0) {
            list.innerHTML = '<div class="empty-panel">No folders yet.<br>Add one above.</div>';
            return;
        }
        list.innerHTML = folders.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(f => {
            return '<div class="folder-item ' + (f.id === selectedFolderId ? 'active' : '') + '" data-id="' +
                f.id + '">' +
                '<span class="item-label">' + escapeHTML(f.name) + '</span>' +
                '<div class="item-actions">' +
                '<button class="rename-folder" title="Rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
                '<button class="del delete-folder" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                '</div></div>';
        }).join('');
    }

    function renderNotes() {
        const list = $('noteList');
        const inFolder = notes.filter(n => n.folderId === selectedFolderId);
        $('notepadCount').textContent = notes.length + (notes.length === 1 ? ' note' : ' notes');
        if (!selectedFolderId) {
            list.innerHTML = '<div class="empty-panel">Select or create a folder to see its notes.</div>';
            return;
        }
        if (inFolder.length === 0) {
            list.innerHTML = '<div class="empty-panel">No notes in this folder yet.<br>Add one above.</div>';
            return;
        }
        list.innerHTML = inFolder.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(n => {
            return '<div class="note-item ' + (n.id === selectedNoteId ? 'active' : '') + '" data-id="' + n
                .id + '">' +
                '<span class="item-label">' + escapeHTML(n.title || '(untitled)') + '</span>' +
                '<div class="item-actions">' +
                '<button class="rename-note" title="Rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>' +
                '<button class="del delete-note" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                '</div></div>';
        }).join('');
    }

    function currentNote() { return notes.find(n => n.id === selectedNoteId) || null; }

    function loadNoteIntoEditor() {
        const n = currentNote();
        const editor = $('noteEditor');
        const titleInput = $('noteTitleInput');
        if (!n) {
            titleInput.value = '';
            titleInput.disabled = true;
            editor.contentEditable = 'false';
            editor.innerHTML = '';
            editor.dataset.empty = 'true';
            return;
        }
        titleInput.disabled = false;
        titleInput.value = n.title || '';
        editor.contentEditable = 'true';
        editor.innerHTML = n.contentHTML || '';
        editor.dataset.empty = (editor.innerHTML.trim() === '') ? 'true' : 'false';
    }

    let noteSaveDebounce = null;

    function scheduleNoteSave() {
        clearTimeout(noteSaveDebounce);
        noteSaveDebounce = setTimeout(saveCurrentNote, 400);
    }

    async function saveCurrentNote() {
        const n = currentNote();
        if (!n) return;
        n.title = $('noteTitleInput').value.trim() || '(untitled)';
        n.contentHTML = $('noteEditor').innerHTML;
        n.updatedAt = Date.now();
        await writeRecord('notes', n);
        addToIndex(searchIndex.notes, n.id, [n.title, stripHTML(n.contentHTML)].join(' '));
        renderNotes();
    }

    async function addFolder(name) {
        name = name.trim();
        if (!name) return;
        const f = { id: uid(), name, createdAt: Date.now() };
        folders.push(f);
        await writeRecord('folders', f);
        addToIndex(searchIndex.folders, f.id, f.name);
        selectedFolderId = f.id;
        renderFolders();
        renderNotes();
        loadNoteIntoEditor();
        showToast('Folder created');
    }

    async function renameFolder(id, newName) {
        const f = folders.find(x => x.id === id);
        if (!f || !newName.trim()) return;
        f.name = newName.trim();
        await writeRecord('folders', f);
        renderFolders();
    }

    async function deleteFolderCascade(id) {
        const f = folders.find(x => x.id === id);
        if (!f) return;
        const childNotes = notes.filter(n => n.folderId === id);
        folders = folders.filter(x => x.id !== id);
        await moveToTrash(f, 'folders');
        for (const n of childNotes) {
            notes = notes.filter(x => x.id !== n.id);
            await moveToTrash(n, 'notes');
        }
        if (selectedFolderId === id) {
            selectedFolderId = folders.length ? folders[0].id : null;
            selectedNoteId = null;
        }
        renderFolders();
        renderNotes();
        loadNoteIntoEditor();
        renderTrash();
        showToast(childNotes.length ? ('Folder and ' + childNotes.length + ' note(s) moved to trash') :
            'Folder moved to trash');
    }

    async function addNote(title) {
        title = title.trim();
        if (!title) return;
        if (!selectedFolderId) { showToast('Select a folder first', true); return; }
        const n = { id: uid(), folderId: selectedFolderId, title, contentHTML: '', createdAt: Date.now(),
            updatedAt: Date.now() };
        notes.push(n);
        await writeRecord('notes', n);
        addToIndex(searchIndex.notes, n.id, n.title);
        selectedNoteId = n.id;
        renderNotes();
        loadNoteIntoEditor();
        showToast('Note created');
    }

    async function renameNote(id, newTitle) {
        const n = notes.find(x => x.id === id);
        if (!n || !newTitle.trim()) return;
        n.title = newTitle.trim();
        n.updatedAt = Date.now();
        await writeRecord('notes', n);
        renderNotes();
        if (selectedNoteId === id) $('noteTitleInput').value = n.title;
    }

    async function deleteNoteSingle(id) {
        const n = notes.find(x => x.id === id);
        if (!n) return;
        notes = notes.filter(x => x.id !== id);
        await moveToTrash(n, 'notes');
        if (selectedNoteId === id) { selectedNoteId = null;
            loadNoteIntoEditor(); }
        renderNotes();
        renderTrash();
        showToast('Note moved to trash');
    }

    function beginInlineRename(itemEl, currentName, onSave) {
        const labelEl = itemEl.querySelector('.item-label');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'item-rename-input';
        input.value = currentName;
        labelEl.replaceWith(input);
        input.focus();
        input.select();
        let done = false;

        function finish(save) {
            if (done) return;
            done = true;
            if (save && input.value.trim() && input.value.trim() !== currentName) onSave(input.value.trim());
        }
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { finish(true); }
            if (e.key === 'Escape') { finish(false);
                renderFolders();
                renderNotes(); }
        });
        input.addEventListener('blur', () => finish(true));
    }
    /* ============ END OF NOTEPAD ============ */

    /* ============ START OF EDITOR TOOLBAR ============ */
    function execCmd(cmd, val) {
        document.execCommand(cmd, false, val || null);
        $('noteEditor').focus();
        scheduleNoteSave();
    }

    function changeFontSize(delta) {
        const editor = $('noteEditor');
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) { showToast(
                'Click into the note and select text first', true); return; }
        if (sel.isCollapsed) { showToast('Select some text first', true); return; }
        const range = sel.getRangeAt(0);
        let baseSize = 14;
        const anchorEl = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
        if (anchorEl) {
            const cs = window.getComputedStyle(anchorEl);
            if (cs && cs.fontSize) baseSize = parseFloat(cs.fontSize) || 14;
        }
        const newSize = Math.max(8, Math.min(72, baseSize + delta));
        const span = document.createElement('span');
        span.style.fontSize = newSize + 'px';
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        sel.addRange(newRange);
        scheduleNoteSave();
    }

        function insertChecklistItem() {
        const editor = $('noteEditor');
        editor.focus();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
        const range = sel.getRangeAt(0);
        range.deleteContents();
        
        // Check if we're inside an existing checklist line
        let currentLine = null;
        let currentCheck = null;
        let currentNode = sel.anchorNode;
        
        // Find the closest checklist line
        while (currentNode && currentNode !== editor) {
            if (currentNode.nodeType === 1 && currentNode.classList && currentNode.classList.contains('note-check-line')) {
                currentLine = currentNode;
                break;
            }
            currentNode = currentNode.parentNode;
        }
        
        // If we're in a checklist line, check if the text is empty or at the end
        if (currentLine) {
            const textSpan = currentLine.querySelector('.note-check-text');
            const cb = currentLine.querySelector('.note-check');
            if (textSpan && textSpan.textContent.trim() === '') {
                // Empty line - remove it and insert a new one at the same level
                const parent = currentLine.parentNode;
                const newLine = document.createElement('div');
                newLine.className = 'note-check-line';
                const newCb = document.createElement('input');
                newCb.type = 'checkbox';
                newCb.className = 'note-check';
                const newTextSpan = document.createElement('span');
                newTextSpan.className = 'note-check-text';
                newTextSpan.innerHTML = '&nbsp;';
                newLine.appendChild(newCb);
                newLine.appendChild(newTextSpan);
                
                // Insert after current line
                if (parent) {
                    parent.insertBefore(newLine, currentLine.nextSibling);
                    currentLine.remove();
                    
                    // Focus on the new line's text
                    const newRange = document.createRange();
                    newRange.selectNodeContents(newTextSpan);
                    newRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(newRange);
                    
                    editor.dataset.empty = editor.textContent.trim() === '' ? 'true' : 'false';
                    scheduleNoteSave();
                    return;
                }
            }
        }
        
        // Create a new checklist line at the current cursor position
        const line = document.createElement('div');
        line.className = 'note-check-line';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'note-check';
        const textSpan = document.createElement('span');
        textSpan.className = 'note-check-text';
        textSpan.innerHTML = '&nbsp;';
        line.appendChild(cb);
        line.appendChild(textSpan);
        
        // Insert at current position
        range.insertNode(line);
        
        // Position cursor inside the text span
        const newRange = document.createRange();
        newRange.selectNodeContents(textSpan);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        
        editor.dataset.empty = editor.textContent.trim() === '' ? 'true' : 'false';
        scheduleNoteSave();
    }

    function initEditorToolbar() {
        document.querySelectorAll('#editorToolbar .tb-btn[data-cmd]').forEach(btn => {
            btn.addEventListener('mousedown', e => e.preventDefault());
            btn.addEventListener('click', () => {
                const cmd = btn.dataset.cmd;
                if (cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') {
                    execListCommand(cmd);
                } else {
                    execCmd(cmd);
                }
            });
        });
        $('tbSizeUp').addEventListener('mousedown', e => e.preventDefault());
        $('tbSizeUp').addEventListener('click', () => changeFontSize(2));
        $('tbSizeDown').addEventListener('mousedown', e => e.preventDefault());
        $('tbSizeDown').addEventListener('click', () => changeFontSize(-2));
        $('tbTextColor').addEventListener('input', () => execCmd('foreColor', $('tbTextColor').value));
        $('tbHighlight').addEventListener('input', () => execCmd('hiliteColor', $('tbHighlight').value));
        $('tbClear').addEventListener('mousedown', e => e.preventDefault());
        $('tbClear').addEventListener('click', () => execCmd('removeFormat'));
        $('tbCheckbox').addEventListener('mousedown', e => e.preventDefault());
        $('tbCheckbox').addEventListener('click', () => insertChecklistItem());

        const editor = $('noteEditor');
        editor.addEventListener('click', (e) => {
            if (e.target && e.target.matches('input[type="checkbox"].note-check')) {
                const line = e.target.closest('.note-check-line');
                if (line) line.classList.toggle('checked', e.target.checked);
                scheduleNoteSave();
            }
        });
                editor.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const sel = window.getSelection();
                if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
                    // Check if we're in a checklist line
                    let currentNode = sel.anchorNode;
                    let line = null;
                    while (currentNode && currentNode !== editor) {
                        if (currentNode.nodeType === 1 && currentNode.classList && currentNode.classList.contains('note-check-line')) {
                            line = currentNode;
                            break;
                        }
                        currentNode = currentNode.parentNode;
                    }
                    
                    if (line) {
                        e.preventDefault();
                        const textSpan = line.querySelector('.note-check-text');
                        const cb = line.querySelector('.note-check');
                        
                        // If the current line is empty, remove it and create a new one
                        if (textSpan && textSpan.textContent.trim() === '') {
                            const parent = line.parentNode;
                            const newLine = document.createElement('div');
                            newLine.className = 'note-check-line';
                            const newCb = document.createElement('input');
                            newCb.type = 'checkbox';
                            newCb.className = 'note-check';
                            const newTextSpan = document.createElement('span');
                            newTextSpan.className = 'note-check-text';
                            newTextSpan.innerHTML = '&nbsp;';
                            newLine.appendChild(newCb);
                            newLine.appendChild(newTextSpan);
                            
                            if (parent) {
                                parent.insertBefore(newLine, line.nextSibling);
                                line.remove();
                                
                                // Focus on the new line
                                const newRange = document.createRange();
                                newRange.selectNodeContents(newTextSpan);
                                newRange.collapse(true);
                                sel.removeAllRanges();
                                sel.addRange(newRange);
                                
                                editor.dataset.empty = editor.textContent.trim() === '' ? 'true' : 'false';
                                scheduleNoteSave();
                                return;
                            }
                        }
                        
                        // Insert a new checklist item at the same level
                        insertChecklistItem();
                    }
                }
            }
        });
                editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                const sel = window.getSelection();
                if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
                    const node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement :
                        sel.anchorNode;
                    
                    // Check if we're in a checklist line - prevent tab indentation
                    let currentNode = node;
                    while (currentNode && currentNode !== editor) {
                        if (currentNode.nodeType === 1 && currentNode.classList && currentNode.classList.contains('note-check-line')) {
                            e.preventDefault();
                            return;
                        }
                        currentNode = currentNode.parentNode;
                    }
                    
                    const li = node.closest ? node.closest('li') : null;
                    if (li) {
                        e.preventDefault();
                        if (e.shiftKey) {
                            document.execCommand('outdent', false, null);
                        } else {
                            document.execCommand('indent', false, null);
                        }
                        scheduleNoteSave();
                    }
                }
            }
        }, true);
        editor.addEventListener('input', () => {
            editor.dataset.empty = editor.textContent.trim() === '' ? 'true' : 'false';
            scheduleNoteSave();
        });
        editor.addEventListener('focus', () => { editor.dataset.empty = 'false'; });
        editor.addEventListener('blur', () => {
            editor.dataset.empty = editor.textContent.trim() === '' ? 'true' : 'false';
        });
        $('noteTitleInput').addEventListener('input', scheduleNoteSave);
    }

    function execListCommand(cmd) {
        const editor = $('noteEditor');
        editor.focus();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) {
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
        document.execCommand(cmd, false, null);
        const paragraphs = editor.querySelectorAll('p:empty, div:empty');
        paragraphs.forEach(p => {
            if (!p.textContent.trim() && !p.querySelector('*')) {
                p.remove();
            }
        });
        editor.dataset.empty = editor.textContent.trim() === '' ? 'true' : 'false';
        scheduleNoteSave();
    }
    /* ============ END OF EDITOR TOOLBAR ============ */

/* ============ START OF PASSWORD SUGGESTIONS ============ */
const PASSWORD_SUGGESTIONS = {
    low: [
        'BlueSky2026', 'CoffeeMug42', 'HappyDaisy77', 'SunsetVibe12', 'GreenTurtle9',
        'RainyDay23', 'StarLight55', 'OceanWave31', 'MountainAir88', 'PurpleRain19',
        'SilverMoon44', 'GoldenSun72', 'FreshBreeze56', 'AutumnLeaf81', 'WinterSnow63',
        'SpringBloom27', 'SummerHeat49', 'NightOwl15', 'EarlyBird38', 'LuckyClover66',
        'RedApple53', 'BlueOcean11', 'WhiteCloud97', 'DarkNight82', 'BrightStar34',
        'SweetCandy29', 'CoolBreeze73', 'WarmFireplace48', 'CozyBlanket61', 'GentleRain25',
        'QuietForest37', 'CalmRiver84', 'PeacefulLake59', 'SunnyGarden76', 'WildFlower42',
        'SoftPillow18', 'FuzzySocks93', 'WarmHug67', 'SweetDream85', 'HappyPlace52',
        'MagicKey70', 'SecretDoor33', 'HiddenPath99', 'SafeHaven28', 'CozyCorner46',
        'PeaceCorner14', 'JoyfulHeart80', 'KindSoul57', 'BraveSpirit21', 'WiseMind90',
        'CrystalLake12', 'AmberSky44', 'RubyRed88', 'JadeGreen33', 'PearlWhite55',
        'CoralReef71', 'DiamondDust29', 'SapphireSea83', 'EmeraldBay17', 'TopazSun45',
        'OpalMoon62', 'GarnetStar39', 'QuartzHill81', 'TurquoiseWave26', 'AmethystSky53',
        'SunnySmile15', 'HappyFeet43', 'DancingBear77', 'LaughingFox91', 'SmilingCat38',
        'PlayfulPup64', 'CheerfulBird82', 'MerryMouse57', 'JollyDeer29', 'BouncyBunny46',
        'FluffyCloud73', 'CottonCandy81', 'Marshmallow19', 'JellyBean55', 'Lollipop62',
        'BubbleGum34', 'SugarPlum87', 'CandyCane43', 'Chocolate99', 'ButterCup76',
        'SummerBreeze13', 'AutumnGold58', 'WinterFrost42', 'SpringRain29', 'MorningDew65',
        'EveningStar88', 'TwilightSky31', 'DawnLight46', 'DuskShadow71', 'MidnightBlue84',
        'RoseGarden25', 'LilyPad37', 'DaisyChain93', 'Sunflower18', 'LavenderField54',
        'JasmineBloom69', 'TulipGarden41', 'OrchidMist83', 'MagnoliaTree27', 'IrisRainbow62',
        'MapleLeaf45', 'OakTree78', 'PineForest31', 'WillowCreek56', 'BirchGrove88',
        'CedarWood43', 'ElmStreet67', 'AshTree29', 'FirTrail51', 'RedwoodPark84'
    ],
    medium: [
        'Tr@velB0y2026', 'G@m3rLif3!88', 'P!zzaLover42', 'Mu$icFan99', 'B00kW0rm21',
        'C0d3Mast3r76', 'D@nceStar55', 'F1tness_Guru', 'Ch3fSpec!al', 'Art1st_Dream',
        'PhotoSn@p33', 'Mov!eBuff44', 'Sport_Fan88', 'N@tureH1ker', 'Cycl!st_Ride',
        'Gard3n_Grow', 'P3tLover007', 'Y0gaMast3r', 'Z3nMaster20', 'M3ditationOm',
        'Runn3r_Fast', 'Sw1mmerPro', 'T3nnis_Ace', 'Golfer_Bird', 'Sk8erBoi99',
        'Surf3rWave', 'Sn0wboarder', 'Sk!Mountain', 'Cl1mbHigh', 'D!veDeep',
        'Tr@ilRunn3r', 'B1keRide44', 'CampF!re22', 'F1shingRod', 'Sa!lBoat88',
        'KayaKing77', 'R0ckCl1mber', 'Par@glider', 'Skyd!vePro', 'Bung3eJump',
        'P@rk0urKing', 'Fr33Runner', 'Danc3Flo0r', 'Dj_Mixer88', 'Gu!tarHero',
        'Drumm3rBeat', 'Sing3rSong', 'P!an0Keys', 'V!0linPlay', 'Sax0phon3',
        'C0ff33Addict', 'T3a_L0ver', 'Sush!Chef42', 'T@coTuesd@y', 'BurgerK!ng99',
        'P@staLov3r', 'S@l@dD@ys55', 'Smooth!eT1me', 'Ju!ceBox44', 'Cupc@keQueen',
        'C00k!eJar33', 'Br0wn!eBite', 'DonutL0ver', 'W@ffleHouse', 'P@ncakeSt@ck',
        'St@rG@zer88', 'M00nWalk3r', 'C0metChas3r', 'Astr0N0va', 'G@l@xyQu3st',
        'NebulaDr3am', 'S0larFl@re', 'Ecl!pseView', 'Orb!tPilot', 'R0cketM@n',
        'B3@chBum55', 'P@lmTreeLif3', 'C0c0nutW@ter', 'TideP00l', 'S@ndC@stle',
        'Sh3llC0llect', 'C0r@lDiver', 'W@veJumper', 'SunsetCh@ser', 'H@mm0ckLife',
        'W1nt3rFrost', 'Sn0wFl@ke77', 'Ic3Qu33n', 'Fr0stByte', 'Bl!zz@rdKing',
        'Aur0raB0real', 'Gl@ci3rWalk', 'Fr0zenTundr@', 'P0larV0rtex', 'Alp!nePeak',
        'D3s3rtR0se', 'C@ctusBl00m', 'S@ndDun3', 'O@s!sDr3am', 'Mirag3V!ew',
        'S@guar0King', 'C@ny0nW@ll', 'M3saV!sta', 'Arroy0Rush', 'B@dl@ndsHik3'
    ],
    high: [
        'K9#mPx2$vL7@nQw', 'Tr8^bN4&yH6*mZc', 'Wp3$jK9!dR5%xFv', 'Qm7@tY2#sL8^nBw',
        'Xc4%gH6&kM1*pVr', 'Jn5!dF3@wQ9$zCt', 'Lb8^rT6#yU2*mPx', 'Gh3$sW7&xC1%nQv',
        'Vf9@kE4!pR8^bNt', 'Ds2#mA6*hJ5%yZw', 'Zu7!cX3$vL9&kQr', 'Bn4^wP8@tM2#gFx',
        'Hj6%rY1!dS5*nCv', 'Mk9&bE3$kQ7^wPt', 'Pw2#tH8@yJ4!mRx', 'Rd5^nC1&gV6$zLb',
        'Sv8!kM4*xW2@qFj', 'Ty3%pB7#rN9^dHk', 'Ux6$wL1!cV5&tMg', 'Zp9@jF4*mR8#nYb',
        'Aw2^bQ7$kH3!xPt', 'Cd5&tN8@yM1%vRz', 'Ef9!pW4#gX6^cLj', 'Gh3$rY7*kD2@nQb',
        'Jk6^mF1!xV5&wPt', 'Lm8%tB4$jR9#zHc', 'Np2@wK7&cL3!yQv', 'Qr5#xM9^nT1$bFj',
        'St7!dG4*pW6@kRv', 'Uv9&hN2%yB8#mZc', 'Wx3$vJ5!kQ7^tLp', 'Yz6@cF1*wR4&nMb',
        'Ab8#tK9%pX2$gHj', 'Cd1^yW5!mQ3@vRt', 'Ef4&bN7*nJ6#zXc', 'Gh2$rY8@kM1%wLv',
        'Ij5!tQ3^pF9&dHb', 'Kl7#xV4*mC6$nJz', 'Mn9@wB2!gR8%yTk', 'Op1&kH5^dL3#qWc',
        'Qr4$vN7*tY2@jFm', 'St6!bM9%pX5&zRg', 'Uv8#cK1^wJ3$nQb', 'Wx2@rF4!tY7*mdP',
        'Yz5&gH9%dN6#kLv', 'Bc3$wT8^pJ1@xRm', 'De7!mQ2*nV5#yFg', 'Fh9%bK4&cR6$tWz',
        'Hj1@xP5^dL8!nMv', 'Kl3#yT7*mF2$gBc', 'Np9^qW4&jR6!xKz', 'Rr2$vC8@tB5#mHn',
        'Tt7!pL1*wG3^dFj', 'Vv5&nB9%yM4#kQx', 'Xx8@cH2^tR6!wPz', 'Zz3$vK7*pN1&mLb',
        'Bb6!gT4#dF9^nJw', 'Dd1^yM5&cW8@qRt', 'Ff4*kB7$hP2!xNv', 'Hh9@pW3%rL6#zTb',
        'Jj2&xQ8^mF5!nCd', 'Ll7#tY1$vK4@gBj', 'Nn5!cM9*wR3&pXn', 'Pp8@nJ2^dH6#qWz',
        'Rr3$sG7&vB1!kTm', 'Tt6%wL4#yF9@cXp', 'Vv1^bQ8*nM5$jHd', 'Xx9!dT3&pW7#gRk',
        'Zz4@fK2^tY6!mLv', 'Bb7$rN8*wC1%xPj', 'Dd5&hQ3#vB9@yMt', 'Ff2!jW6^nL4$kXz',
        'Hh8^cR1*tG7#mPd', 'Jj4@yM9&wF3!nKb', 'Ll6%vT2$kH8^qWx', 'Nn1#pC5!dR7@xJv',
        'Pp3&bN8*mY4^tLz', 'Rr9!nW2#gQ6$cFj', 'Tt5@xK1*vP7&mHd', 'Vv7^rY4%tB9!nWc',
        'Xx2$jC8&wM3#qFp', 'Zz6!hT9^kL1@pRg', 'Bb3*mN5$vX7&cJw', 'Dd8#yQ4!tG2^nMb',
        'Ff1@pR6^wK9%zHd', 'Hh5&bV3$nJ8!qXc', 'Jj9!mT2*tY4#gLp', 'Ll4^cW7&pB1@kRv',
        'Nn7$rF8!wM5^dHz', 'Pp2#kJ3*vQ9%nTx', 'Rr6@yG1&tB4!cWb', 'Tt8^nX5$pK2#mJv',
        'Vv3!dM7*wR9^qFc', 'Xx1&bT4#vL6@hPj', 'Zz5@kJ8!nQ2$yWx', 'Bb9^pF3&cM7*tRz'
    ],
    pins: {
        simple: [
            '1234', '1111', '0000', '2580', '5555', '0852', '2222', '1212', '1998', '2000',
            '1379', '2468', '1357', '1122', '3344', '5566', '7788', '9900', '1010', '2020',
            '3030', '4040', '5050', '6060', '7070', '8080', '9090', '0101', '1313', '1515',
            '1717', '1919', '2121', '2323', '2525', '2727', '2929', '3131', '3333', '3535',
            '3737', '3939', '4141', '4343', '4545', '4747', '4949', '5151', '5353', '5556',
            '5757', '5959', '6161', '6363', '6565', '6767', '6969', '7171', '7373', '7575',
            '7777', '7979', '8181', '8383', '8585', '8787', '8989', '9191', '9393', '9595',
            '9797', '9999', '1221', '1331', '1441', '1551', '1661', '1771', '1881', '1991',
            '2112', '2332', '2442', '2552', '2662', '2772', '2882', '2992', '3113', '3223',
            '3443', '3553', '3663', '3773', '3883', '3993', '4114', '4224', '4334', '4554'
        ],
        medium: [
            '2748', '3915', '4830', '5193', '6372', '7046', '8264', '9501', '1470', '3681',
            '5927', '7184', '8409', '9752', '1039', '2164', '3507', '4628', '6893', '8041',
            '1529', '2647', '3785', '4910', '5273', '6398', '7421', '8564', '9687', '1753',
            '2846', '3962', '4187', '5309', '6424', '7548', '8671', '9783', '1850', '2975',
            '3158', '4280', '5394', '6416', '7539', '8652', '9774', '1891', '2914', '4037',
            '5150', '6273', '7396', '8418', '9531', '1654', '2776', '3899', '4922', '5145',
            '6268', '7381', '8404', '9527', '1649', '2762', '3885', '4908', '5131', '6254',
            '7377', '8490', '9513', '1636', '2759', '3872', '4995', '5128', '6241', '7364',
            '8487', '9500', '1623', '2746', '3869', '4982', '5105', '6228', '7341', '8464',
            '9587', '1610', '2733', '3856', '4979', '5092', '6215', '7338', '8451', '9574'
        ],
        high: [
            '4917', '5832', '6194', '7258', '8370', '9425', '1583', '2049', '3167', '4702',
            '5286', '6459', '7531', '8694', '9148', '1376', '2590', '3482', '4761', '5028',
            '6153', '7289', '8340', '9471', '1527', '2648', '3719', '4862', '5934', '6185',
            '7246', '8397', '9428', '1579', '2630', '3781', '4892', '5943', '6104', '7255',
            '8376', '9487', '1598', '2619', '3730', '4851', '5972', '6193', '7214', '8335',
            '9456', '1577', '2688', '3799', '4810', '5931', '6152', '7273', '8394', '9415',
            '1536', '2647', '3758', '4869', '5980', '6101', '7222', '8343', '9464', '1585',
            '2696', '3707', '4818', '5929', '6140', '7261', '8382', '9403', '1524', '2635',
            '3746', '4857', '5968', '6179', '7280', '8391', '9412', '1533', '2644', '3755',
            '4866', '5977', '6188', '7299', '8300', '9411', '1522', '2633', '3744', '4855'
        ]
    }
};

    let usedPasswords = new Set();

    function markPasswordAsUsed(password) {
        if (password && password.trim()) {
            usedPasswords.add(password.trim());
        }
    }

    function isPasswordUsed(password) {
        return password && usedPasswords.has(password.trim());
    }

    function renderPasswordSuggestions() {
        const grid = $('passwordSuggestGrid');
        vaultItems.forEach(item => {
            if (item.password && item.password.trim()) {
                usedPasswords.add(item.password.trim());
            }
        });
        let html = '';
        html += '<div class="suggest-col">';
        html += '<div class="suggest-col-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M7 10V8a5 5 0 0 1 9-3"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg> Low Security</div>';
        PASSWORD_SUGGESTIONS.low.forEach(pwd => {
            const used = isPasswordUsed(pwd);
            html += renderSuggestItem(pwd, used);
        });
        html += '<div class="suggest-col-title" style="margin-top:12px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none"/></svg> Medium Security</div>';
        PASSWORD_SUGGESTIONS.medium.forEach(pwd => {
            const used = isPasswordUsed(pwd);
            html += renderSuggestItem(pwd, used);
        });
        html += '<div class="suggest-col-title" style="margin-top:12px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/><path d="M4 13.5h16"/><path d="M12 13.6v3" stroke-width="2"/><circle cx="12" cy="15.1" r="1.7" fill="currentColor" stroke="none"/></svg> High Security</div>';
        PASSWORD_SUGGESTIONS.high.forEach(pwd => {
            const used = isPasswordUsed(pwd);
            html += renderSuggestItem(pwd, used);
        });
        html += '</div>';
        html += '<div class="suggest-col">';
        html += '<div class="suggest-col-title">🔢 Simple PINs</div>';
        PASSWORD_SUGGESTIONS.pins.simple.forEach(pin => {
            const used = isPasswordUsed(pin);
            html += renderSuggestItem(pin, used);
        });
        html += '<div class="suggest-col-title" style="margin-top:12px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><path d="M8 15h8"/></svg> Medium PINs</div>';
        PASSWORD_SUGGESTIONS.pins.medium.forEach(pin => {
            const used = isPasswordUsed(pin);
            html += renderSuggestItem(pin, used);
        });
        html += '<div class="suggest-col-title" style="margin-top:12px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><path d="M8 15h8"/></svg> High Security PINs</div>';
        PASSWORD_SUGGESTIONS.pins.high.forEach(pin => {
            const used = isPasswordUsed(pin);
            html += renderSuggestItem(pin, used);
        });
        html += '</div>';
        grid.innerHTML = html;
    }

    function renderSuggestItem(value, used) {
        const usedClass = used ? ' used' : '';
        const badge = used ? '<span class="used-badge">✓ Used</span>' : '';
        const infoBtn = used ?
            '<span class="used-info" title="This password has been used before. You can still use it again if you want."><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></span>' :
            '';
        return '<div class="suggest-item' + usedClass + '" data-value="' + escapeAttr(value) + '">' +
            '<span class="suggest-text">' + escapeHTML(value) + '</span>' +
            badge +
            infoBtn +
            '</div>';
    }
    /* ============ END OF PASSWORD SUGGESTIONS ============ */

    /* ============ START OF QR CODE ENGINE ============ */
    const QR = (function() {

        // ---- Galois Field GF(2^8) with primitive polynomial x^8+x^4+x^3+x^2+1 (0x11d) ----
        const EXP = new Array(512);
        const LOG = new Array(256);
        (function initGF() {
            let x = 1;
            for (let i = 0; i < 255; i++) {
                EXP[i] = x;
                LOG[x] = i;
                x <<= 1;
                if (x & 0x100) x ^= 0x11d;
            }
            for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
        })();

        function gfMul(a, b) {
            if (a === 0 || b === 0) return 0;
            return EXP[LOG[a] + LOG[b]];
        }

        // Generator polynomial for Reed-Solomon with `degree` EC codewords
        function rsGeneratorPoly(degree) {
            let poly = [1];
            for (let i = 0; i < degree; i++) {
                const next = new Array(poly.length + 1).fill(0);
                for (let j = 0; j < poly.length; j++) {
                    next[j] ^= gfMul(poly[j], EXP[i]);
                    next[j + 1] ^= poly[j];
                }
                poly = next;
            }
            return poly.reverse(); // highest degree term first
        }

        function rsEncode(dataCodewords, ecCount) {
            const gen = rsGeneratorPoly(ecCount);
            const res = new Array(ecCount).fill(0);
            for (let i = 0; i < dataCodewords.length; i++) {
                const factor = dataCodewords[i] ^ res[0];
                res.shift();
                res.push(0);
                if (factor !== 0) {
                    for (let j = 0; j < gen.length - 1; j++) {
                        res[j] ^= gfMul(gen[j + 1], factor);
                    }
                }
            }
            return res;
        }

        // ---- Version capacity tables (ISO/IEC 18004) ----
        // Total codewords (data + EC) per version, 1..40.
        const CODEWORDS_COUNT = [0,
            26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
            404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
            1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
            2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706
        ];
        // Number of EC blocks per version, columns [L,M,Q,H].
        const EC_BLOCKS_TABLE = [
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 4, 1, 2, 4, 4,
            2, 4, 4, 4, 2, 4, 6, 5, 2, 4, 6, 6, 2, 5, 8, 8, 4, 5, 8, 8,
            4, 5, 8, 11, 4, 8, 10, 11, 4, 9, 12, 16, 4, 9, 16, 16, 6, 10, 12, 18,
            6, 10, 17, 16, 6, 11, 16, 19, 6, 13, 18, 21, 7, 14, 21, 25, 8, 16, 20, 25,
            8, 17, 23, 25, 9, 17, 23, 34, 9, 18, 25, 30, 10, 20, 27, 32, 12, 21, 29, 35,
            12, 23, 34, 37, 12, 25, 34, 40, 13, 26, 35, 42, 14, 28, 38, 45, 15, 29, 40, 48,
            16, 31, 43, 51, 17, 33, 45, 54, 18, 35, 48, 57, 19, 37, 51, 60, 19, 38, 53, 63,
            20, 40, 56, 66, 21, 43, 59, 70, 22, 45, 62, 74, 24, 47, 65, 77, 25, 49, 68, 81
        ];
        // Total EC codewords per version, columns [L,M,Q,H].
        const EC_CODEWORDS_TABLE = [
            7, 10, 13, 17, 10, 16, 22, 28, 15, 26, 36, 44, 20, 36, 52, 64, 26, 48, 72, 88,
            36, 64, 96, 112, 40, 72, 108, 130, 48, 88, 132, 156, 60, 110, 160, 192, 72, 130, 192, 224,
            80, 150, 224, 264, 96, 176, 260, 308, 104, 198, 288, 352, 120, 216, 320, 384, 132, 240, 360, 432,
            144, 280, 408, 480, 168, 308, 448, 532, 180, 338, 504, 588, 196, 364, 546, 650, 224, 416, 600, 700,
            224, 442, 644, 750, 252, 476, 690, 816, 270, 504, 750, 900, 300, 560, 810, 960, 312, 588, 870, 1050,
            336, 644, 952, 1110, 360, 700, 1020, 1200, 390, 728, 1050, 1260, 420, 784, 1140, 1350, 450, 812, 1200, 1440,
            480, 868, 1290, 1530, 510, 924, 1350, 1620, 540, 980, 1440, 1710, 570, 1036, 1530, 1800, 570, 1064, 1590, 1890,
            600, 1120, 1680, 1980, 630, 1204, 1770, 2100, 660, 1260, 1860, 2220, 720, 1316, 1950, 2310, 750, 1372, 2040, 2430
        ];
        const EC_LEVEL_COL = { L: 0, M: 1, Q: 2, H: 3 };

        function ecBlocksCount(version, level) {
            return EC_BLOCKS_TABLE[(version - 1) * 4 + EC_LEVEL_COL[level]];
        }

        function ecCodewordsCount(version, level) {
            return EC_CODEWORDS_TABLE[(version - 1) * 4 + EC_LEVEL_COL[level]];
        }

        // Total data codewords available per version/level, derived from the tables above.
        const DATA_CODEWORDS = { L: [0], M: [0], Q: [0], H: [0] };
        for (let v = 1; v <= 40; v++) {
            for (const lvl of ['L', 'M', 'Q', 'H']) {
                DATA_CODEWORDS[lvl][v] = CODEWORDS_COUNT[v] - ecCodewordsCount(v, lvl);
            }
        }

        // Compute [group1Count, group1Len, group2Count, group2Len, ecPerBlock] for a version/level.
        function blockLayout(version, level) {
            const totalCodewords = CODEWORDS_COUNT[version];
            const ecTotal = ecCodewordsCount(version, level);
            const dataTotal = totalCodewords - ecTotal;
            const numBlocks = ecBlocksCount(version, level);
            const blocksInGroup2 = totalCodewords % numBlocks;
            const blocksInGroup1 = numBlocks - blocksInGroup2;
            const dataCodewordsGroup1 = Math.floor(dataTotal / numBlocks);
            const dataCodewordsGroup2 = dataCodewordsGroup1 + 1;
            const ecPerBlock = Math.floor(totalCodewords / numBlocks) - dataCodewordsGroup1;
            return [blocksInGroup1, dataCodewordsGroup1, blocksInGroup2, dataCodewordsGroup2, ecPerBlock];
        }

        // Alignment pattern center coordinates per version (index 1..40)
        const ALIGN_COORDS = [null,
            [],
            [6, 18],
            [6, 22],
            [6, 26],
            [6, 30],
            [6, 34],
            [6, 22, 38],
            [6, 24, 42],
            [6, 26, 46],
            [6, 28, 50],
            [6, 30, 54],
            [6, 32, 58],
            [6, 34, 62],
            [6, 26, 46, 66],
            [6, 26, 48, 70],
            [6, 26, 50, 74],
            [6, 30, 54, 78],
            [6, 30, 56, 82],
            [6, 30, 58, 86],
            [6, 34, 62, 90],
            [6, 28, 50, 72, 94],
            [6, 26, 50, 74, 98],
            [6, 30, 54, 78, 102],
            [6, 28, 54, 80, 106],
            [6, 32, 58, 84, 110],
            [6, 30, 58, 86, 114],
            [6, 34, 62, 90, 118],
            [6, 26, 50, 74, 98, 122],
            [6, 30, 54, 78, 102, 126],
            [6, 26, 52, 78, 104, 130],
            [6, 30, 56, 82, 108, 134],
            [6, 34, 60, 86, 112, 138],
            [6, 30, 58, 86, 114, 142],
            [6, 34, 62, 90, 118, 146],
            [6, 30, 54, 78, 102, 126, 150],
            [6, 24, 50, 76, 102, 128, 154],
            [6, 28, 54, 80, 106, 132, 158],
            [6, 32, 58, 84, 110, 136, 162],
            [6, 26, 54, 82, 110, 138, 166],
            [6, 30, 58, 86, 114, 142, 170]
        ];

        // Version info bits for versions 7-40 (18-bit BCH codes), precomputed via poly.
        function bchVersionInfo(version) {
            let d = version << 12;
            const G = 0x1F25; // generator poly for version info (18,6) BCH, degree 12
            let temp = d;
            while (bitLength(temp) - bitLength(G) >= 0) {
                temp ^= G << (bitLength(temp) - bitLength(G));
            }
            return (version << 12) | temp;
        }

        function bitLength(n) {
            let l = 0;
            while (n > 0) { n >>>= 1;
                l++; }
            return l;
        }

        function bchFormatInfo(formatBits) {
            // formatBits: 5-bit value (EC level 2 bits + mask 3 bits)
            let d = formatBits << 10;
            const G = 0x537; // generator poly for format info (15,5) BCH, degree 10
            let temp = d;
            while (bitLength(temp) - bitLength(G) >= 0) {
                temp ^= G << (bitLength(temp) - bitLength(G));
            }
            let bits = (formatBits << 10) | temp;
            bits ^= 0x5412; // mask XOR pattern per spec
            return bits;
        }

        const EC_INDICATOR = { L: 1, M: 0, Q: 3, H: 2 }; // 2-bit format info EC indicator values per spec

        // ---- Bit buffer helper ----
        class BitBuffer {
            constructor() { this.bits = []; }
            put(val, len) {
                for (let i = len - 1; i >= 0; i--) {
                    this.bits.push((val >>> i) & 1);
                }
            }
            get length() { return this.bits.length; }
            toBytes() {
                const bytes = [];
                for (let i = 0; i < this.bits.length; i += 8) {
                    let b = 0;
                    for (let j = 0; j < 8; j++) {
                        b = (b << 1) | (this.bits[i + j] || 0);
                    }
                    bytes.push(b);
                }
                return bytes;
            }
        }

        // UTF-8 encode a JS string into byte array
        function utf8Bytes(str) {
            const bytes = [];
            for (let i = 0; i < str.length; i++) {
                let code = str.codePointAt(i);
                if (code > 0xFFFF) i++; // surrogate pair consumed
                if (code < 0x80) {
                    bytes.push(code);
                } else if (code < 0x800) {
                    bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
                } else if (code < 0x10000) {
                    bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
                } else {
                    bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
                }
            }
            return bytes;
        }

        // Determine smallest version that fits the data for a given EC level (byte mode)
        function charCountBits(version) {
            if (version < 10) return 8;
            return 16;
        }

        function chooseVersion(dataByteLen, ecLevel) {
            for (let v = 1; v <= 40; v++) {
                const ccBits = charCountBits(v);
                const headerBits = 4 + ccBits;
                const capacityBits = DATA_CODEWORDS[ecLevel][v] * 8;
                const neededBits = headerBits + dataByteLen * 8;
                if (neededBits <= capacityBits) return v;
            }
            return null; // too much data
        }

        function buildDataCodewords(text, version, ecLevel) {
            const dataBytes = utf8Bytes(text);
            const bb = new BitBuffer();
            bb.put(0b0100, 4); // byte mode indicator
            const ccBits = charCountBits(version);
            bb.put(dataBytes.length, ccBits);
            for (const byte of dataBytes) bb.put(byte, 8);

            const capacityBits = DATA_CODEWORDS[ecLevel][version] * 8;
            // terminator
            const termLen = Math.min(4, capacityBits - bb.length);
            if (termLen > 0) bb.put(0, termLen);
            // pad to byte boundary
            while (bb.length % 8 !== 0) bb.bits.push(0);
            // pad with alternating bytes
            const padBytes = [0xEC, 0x11];
            let pi = 0;
            while (bb.length < capacityBits) {
                bb.put(padBytes[pi % 2], 8);
                pi++;
            }
            return bb.toBytes();
        }

        function interleaveWithEC(dataCodewords, version, ecLevel) {
            const table = blockLayout(version, ecLevel);
            const [b1count, b1len, b2count, b2len, ecLen] = table;
            const blocks = [];
            let offset = 0;
            for (let i = 0; i < b1count; i++) {
                blocks.push(dataCodewords.slice(offset, offset + b1len));
                offset += b1len;
            }
            for (let i = 0; i < b2count; i++) {
                blocks.push(dataCodewords.slice(offset, offset + b2len));
                offset += b2len;
            }
            const ecBlocks = blocks.map(b => rsEncode(b, ecLen));

            // interleave data
            const result = [];
            const maxDataLen = Math.max(b1len, b2len > 0 ? b2len : 0);
            for (let i = 0; i < maxDataLen; i++) {
                for (const block of blocks) {
                    if (i < block.length) result.push(block[i]);
                }
            }
            // interleave EC
            for (let i = 0; i < ecLen; i++) {
                for (const ecBlock of ecBlocks) {
                    result.push(ecBlock[i]);
                }
            }
            return result;
        }

        // ---- Matrix construction ----
        function createMatrix(version) {
            const size = version * 4 + 17;
            const m = [];
            for (let i = 0; i < size; i++) m.push(new Array(size).fill(null));
            return m;
        }

        function placeFinderPattern(m, row, col) {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const rr = row + r,
                        cc = col + c;
                    if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
                    let dark;
                    if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
                        dark = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
                    } else {
                        dark = false; // separator (white border)
                    }
                    m[rr][cc] = dark ? 1 : 0;
                }
            }
        }

        function placeAlignmentPattern(m, row, col) {
            if (m[row][col] !== null) return; // skip if overlapping finder area
            for (let r = -2; r <= 2; r++) {
                for (let c = -2; c <= 2; c++) {
                    const dark = (Math.max(Math.abs(r), Math.abs(c)) !== 1);
                    m[row + r][col + c] = dark ? 1 : 0;
                }
            }
        }

        function placeTimingPatterns(m) {
            const size = m.length;
            for (let i = 8; i < size - 8; i++) {
                if (m[6][i] === null) m[6][i] = (i % 2 === 0) ? 1 : 0;
                if (m[i][6] === null) m[i][6] = (i % 2 === 0) ? 1 : 0;
            }
        }

        function reserveFormatAreas(m) {
            const size = m.length;
            // around top-left finder
            for (let i = 0; i < 9; i++) {
                if (m[8][i] === null) m[8][i] = 0;
                if (m[i][8] === null) m[i][8] = 0;
            }
            // top-right and bottom-left strips
            for (let i = 0; i < 8; i++) {
                if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
                if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
            }
            // dark module
            m[size - 8][8] = 1;
        }

        function reserveVersionAreas(m, version) {
            if (version < 7) return;
            const size = m.length;
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 3; j++) {
                    if (m[i][size - 11 + j] === null) m[i][size - 11 + j] = 0;
                    if (m[size - 11 + j][i] === null) m[size - 11 + j][i] = 0;
                }
            }
        }

        function placeDataBits(m, dataBytes) {
            const size = m.length;
            const bits = [];
            for (const byte of dataBytes) {
                for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
            }
            let bitIndex = 0;
            let dir = -1; // upward
            let col = size - 1;
            while (col > 0) {
                if (col === 6) col--; // skip timing column
                for (let i = 0; i < size; i++) {
                    const row = dir === -1 ? size - 1 - i : i;
                    for (const c of [col, col - 1]) {
                        if (m[row][c] === null) {
                            const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
                            m[row][c] = bit;
                            bitIndex++;
                        }
                    }
                }
                dir = -dir;
                col -= 2;
            }
        }

        function isFunctionModule(funcMask, r, c) {
            return funcMask[r][c] === 1;
        }

        function applyMask(matrix, maskId, funcMask) {
            const size = matrix.length;
            const masked = matrix.map(row => row.slice());
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (funcMask[r][c]) continue;
                    let invert;
                    switch (maskId) {
                        case 0:
                            invert = (r + c) % 2 === 0;
                            break;
                        case 1:
                            invert = r % 2 === 0;
                            break;
                        case 2:
                            invert = c % 3 === 0;
                            break;
                        case 3:
                            invert = (r + c) % 3 === 0;
                            break;
                        case 4:
                            invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
                            break;
                        case 5:
                            invert = ((r * c) % 2) + ((r * c) % 3) === 0;
                            break;
                        case 6:
                            invert = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
                            break;
                        case 7:
                            invert = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
                            break;
                    }
                    if (invert) masked[r][c] ^= 1;
                }
            }
            return masked;
        }

        function penaltyScore(m) {
            const size = m.length;
            let score = 0;
            // Rule 1: consecutive same-color in row/col
            for (let r = 0; r < size; r++) {
                let runColor = m[r][0],
                    runLen = 1;
                for (let c = 1; c < size; c++) {
                    if (m[r][c] === runColor) { runLen++; } else { if (runLen >= 5) score += 3 + (runLen - 5);
                        runColor = m[r][c];
                        runLen = 1; }
                }
                if (runLen >= 5) score += 3 + (runLen - 5);
            }
            for (let c = 0; c < size; c++) {
                let runColor = m[0][c],
                    runLen = 1;
                for (let r = 1; r < size; r++) {
                    if (m[r][c] === runColor) { runLen++; } else { if (runLen >= 5) score += 3 + (runLen - 5);
                        runColor = m[r][c];
                        runLen = 1; }
                }
                if (runLen >= 5) score += 3 + (runLen - 5);
            }
            // Rule 2: 2x2 blocks same color
            for (let r = 0; r < size - 1; r++) {
                for (let c = 0; c < size - 1; c++) {
                    const v = m[r][c];
                    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
                }
            }
            // Rule 3: finder-like patterns 1:1:3:1:1 with 4 light either side
            const pattern1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
            const pattern2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

            function matchPattern(arr, pat, start) {
                for (let i = 0; i < pat.length; i++) {
                    if (arr[start + i] !== pat[i]) return false;
                }
                return true;
            }
            for (let r = 0; r < size; r++) {
                const row = m[r];
                for (let c = 0; c <= size - 11; c++) {
                    if (matchPattern(row, pattern1, c) || matchPattern(row, pattern2, c)) score += 40;
                }
            }
            for (let c = 0; c < size; c++) {
                const col = [];
                for (let r = 0; r < size; r++) col.push(m[r][c]);
                for (let r = 0; r <= size - 11; r++) {
                    if (matchPattern(col, pattern1, r) || matchPattern(col, pattern2, r)) score += 40;
                }
            }
            // Rule 4: dark module ratio
            let dark = 0;
            for (let r = 0; r < size; r++)
                for (let c = 0; c < size; c++)
                    if (m[r][c]) dark++;
            const percent = (dark * 100) / (size * size);
            const prev5 = Math.floor(percent / 5) * 5;
            const diff1 = Math.abs(prev5 - 50) / 5;
            const diff2 = Math.abs(prev5 + 5 - 50) / 5;
            score += Math.min(diff1, diff2) * 10;
            return score;
        }

        function buildFunctionMask(version) {
            const size = version * 4 + 17;
            const fm = [];
            for (let i = 0; i < size; i++) fm.push(new Array(size).fill(0));

            function markFinder(row, col) {
                for (let r = -1; r <= 7; r++)
                    for (let c = -1; c <= 7; c++) {
                        const rr = row + r,
                            cc = col + c;
                        if (rr >= 0 && cc >= 0 && rr < size && cc < size) fm[rr][cc] = 1;
                    }
            }
            markFinder(0, 0);
            markFinder(0, size - 7);
            markFinder(size - 7, 0);
            for (let i = 8; i < size - 8; i++) { fm[6][i] = 1;
                fm[i][6] = 1; }
            const coords = ALIGN_COORDS[version] || [];
            for (const row of coords) {
                for (const col of coords) {
                    if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6))
                        continue;
                    for (let r = -2; r <= 2; r++)
                        for (let c = -2; c <= 2; c++) fm[row + r][col + c] = 1;
                }
            }
            for (let i = 0; i < 9; i++) { fm[8][i] = 1;
                fm[i][8] = 1; }
            for (let i = 0; i < 8; i++) { fm[8][size - 1 - i] = 1;
                fm[size - 1 - i][8] = 1; }
            fm[size - 8][8] = 1;
            if (version >= 7) {
                for (let i = 0; i < 6; i++)
                    for (let j = 0; j < 3; j++) {
                        fm[i][size - 11 + j] = 1;
                        fm[size - 11 + j][i] = 1;
                    }
            }
            return fm;
        }

        function generate(text, ecLevel) {
            if (!text) text = " ";
            const dataByteLen = utf8Bytes(text).length;
            const version = chooseVersion(dataByteLen, ecLevel);
            if (version === null) throw new Error("Data too long to encode, even at the lowest error-correction level.");

            const dataCodewords = buildDataCodewords(text, version, ecLevel);
            const finalCodewords = interleaveWithEC(dataCodewords, version, ecLevel);

            // remainder bits for certain versions
            const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 3, 3,
                3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3
            ];
            let bitStream = [];
            for (const byte of finalCodewords)
                for (let i = 7; i >= 0; i--) bitStream.push((byte >> i) & 1);
            for (let i = 0; i < REMAINDER_BITS[version]; i++) bitStream.push(0);
            const fullBytes = [];
            for (let i = 0; i < bitStream.length; i += 8) {
                let b = 0;
                for (let j = 0; j < 8; j++) b = (b << 1) | (bitStream[i + j] || 0);
                fullBytes.push(b);
            }

            const size = version * 4 + 17;
            let matrix = createMatrix(version);
            placeFinderPattern(matrix, 0, 0);
            placeFinderPattern(matrix, 0, size - 7);
            placeFinderPattern(matrix, size - 7, 0);
            const coords = ALIGN_COORDS[version] || [];
            for (const row of coords) {
                for (const col of coords) {
                    if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6))
                        continue;
                    placeAlignmentPattern(matrix, row, col);
                }
            }
            placeTimingPatterns(matrix);
            reserveFormatAreas(matrix);
            reserveVersionAreas(matrix, version);

            // fill remaining nulls with data bits (careful: placeDataBits treats any null as available)
            placeDataBits(matrix, fullBytes);

            const funcMask = buildFunctionMask(version);

            // try all 8 masks, pick lowest penalty
            let bestMask = 0,
                bestScore = Infinity,
                bestMatrix = null;
            for (let mid = 0; mid < 8; mid++) {
                const masked = applyMask(matrix, mid, funcMask);
                applyFormatInfo(masked, ecLevel, mid, version);
                const score = penaltyScore(masked);
                if (score < bestScore) { bestScore = score;
                    bestMask = mid;
                    bestMatrix = masked; }
            }

            return { matrix: bestMatrix, size, version, ecLevel, mask: bestMask };
        }

        function applyFormatInfo(m, ecLevel, maskId, version) {
            const size = m.length;
            const formatVal = (EC_INDICATOR[ecLevel] << 3) | maskId;
            const bits = bchFormatInfo(formatVal); // 15 bits
            const bitArr = [];
            for (let i = 14; i >= 0; i--) bitArr.push((bits >> i) & 1);
            // place around top-left finder
            const col_positions = [0, 1, 2, 3, 4, 5, 7, 8, size - 8, size - 7, size - 6, size - 5, size - 4, size - 3,
                size - 2, size - 1
            ];
            // Standard placement per spec:
            for (let i = 0; i <= 5; i++) m[8][i] = bitArr[i];
            m[8][7] = bitArr[6];
            m[8][8] = bitArr[7];
            m[7][8] = bitArr[8];
            for (let i = 9; i < 15; i++) m[14 - i][8] = bitArr[i];

            for (let i = 0; i < 7; i++) m[size - 1 - i][8] = bitArr[i];
            m[size - 8][8] = 1; // dark module (already set, ensure)
            for (let i = 7; i < 15; i++) m[8][size - 15 + i] = bitArr[i];

            if (version >= 7) {
                const vbits = bchVersionInfo(version); // 18 bits
                for (let i = 0; i < 18; i++) {
                    const bit = (vbits >> i) & 1; // LSB-first
                    const a = i % 3;
                    const b = Math.floor(i / 3);
                    m[b][size - 11 + a] = bit; // 6 rows x 3 cols block (top-right)
                    m[size - 11 + a][b] = bit; // 3 rows x 6 cols block (bottom-left)
                }
            }
        }

        return { generate };
    })();
    /* ============ END OF QR CODE ENGINE ============ */

    /* ============ START OF QR UI ============ */
    let qrLogoData = null;
    let qrFgColor = '#000000';
    let qrBgColor = '#ffffff';
    let qrSize = 300;
    let qrErrorCorrection = 'M';
    let lastQrResult = null; // stores the last generated QR data (matrix, size, version, etc.)

    function getQRContent() {
        return $('qrTextInput').value.trim() || null;
    }

    function generateQRCode() {
        const canvas = $('qrCanvas');
        const ctx = canvas.getContext('2d');
        const size = parseInt($('qrSize').value) || 300;
        qrSize = size;
        const content = getQRContent();
        if (!content) {
            ctx.fillStyle = qrBgColor;
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = qrFgColor;
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Enter content to generate QR code', size / 2, size / 2);
            lastQrResult = null;
            return;
        }

        try {
            const result = QR.generate(content, qrErrorCorrection);
            lastQrResult = result;
            const matrix = result.matrix;
            const moduleSize = result.size;
            const marginModules = parseInt($('qrMargin')?.value) || 4;
            const totalModules = moduleSize + marginModules * 2;
            const modulePixelSize = Math.max(1, Math.floor(size / totalModules));
            const canvasSize = modulePixelSize * totalModules;
            canvas.width = canvasSize;
            canvas.height = canvasSize;

            ctx.fillStyle = qrBgColor;
            ctx.fillRect(0, 0, canvasSize, canvasSize);
            ctx.fillStyle = qrFgColor;
            for (let row = 0; row < moduleSize; row++) {
                for (let col = 0; col < moduleSize; col++) {
                    if (matrix[row][col]) {
                        const x = (col + marginModules) * modulePixelSize;
                        const y = (row + marginModules) * modulePixelSize;
                        ctx.fillRect(x, y, modulePixelSize, modulePixelSize);
                    }
                }
            }
            if (qrLogoData) {
                drawLogo(ctx, canvasSize);
            }
            // optionally update metadata display
        } catch (e) {
            ctx.fillStyle = qrBgColor;
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = qrFgColor;
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Error: ' + e.message, size / 2, size / 2);
            lastQrResult = null;
        }
    }

    function drawLogo(ctx, size) {
        const logoSize = Math.floor(size * 0.18);
        const x = (size - logoSize) / 2;
        const y = (size - logoSize) / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, logoSize / 2 + 4, 0, Math.PI * 2);
        ctx.fillStyle = qrBgColor;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = qrBgColor;
        ctx.fillRect(x - 2, y - 2, logoSize + 4, logoSize + 4);
        ctx.restore();
        const img = new Image();
        img.onload = function() {
            ctx.save();
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, logoSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, x, y, logoSize, logoSize);
            ctx.restore();
        };
        img.src = qrLogoData;
        if (img.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, logoSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, x, y, logoSize, logoSize);
            ctx.restore();
        }
    }

    function updateQRSize() {
        const size = $('qrSize').value;
        $('qrSizeLabel').textContent = size;
        qrSize = parseInt(size);
        generateQRCode();
    }

    function downloadQR(format) {
        if (!lastQrResult) {
            showToast('Generate a QR code first', true);
            return;
        }
        const canvas = $('qrCanvas');
        const size = parseInt($('qrSize').value) || 300;
        const marginModules = parseInt($('qrMargin')?.value) || 4;
        const matrix = lastQrResult.matrix;
        const moduleSize = lastQrResult.size;
        const totalModules = moduleSize + marginModules * 2;
        const modulePixelSize = Math.max(1, Math.floor(size / totalModules));

        if (format === 'svg') {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            svg.setAttribute('width', size);
            svg.setAttribute('height', size);
            svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('width', size);
            bg.setAttribute('height', size);
            bg.setAttribute('fill', qrBgColor);
            svg.appendChild(bg);
            for (let row = 0; row < moduleSize; row++) {
                for (let col = 0; col < moduleSize; col++) {
                    if (matrix[row][col]) {
                        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        const x = (col + marginModules) * modulePixelSize;
                        const y = (row + marginModules) * modulePixelSize;
                        rect.setAttribute('x', x);
                        rect.setAttribute('y', y);
                        rect.setAttribute('width', modulePixelSize);
                        rect.setAttribute('height', modulePixelSize);
                        rect.setAttribute('fill', qrFgColor);
                        svg.appendChild(rect);
                    }
                }
            }
            // optionally add logo here if needed
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(svg);
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            downloadFile(url, 'qrcode.svg');
        } else {
            const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
            const dataUrl = canvas.toDataURL(mimeType, 1.0);
            const ext = format === 'jpg' ? 'jpg' : 'png';
            downloadFile(dataUrl, `qrcode.${ext}`);
        }
    }

    function downloadFile(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    /* ============ END OF QR UI ============ */

/* ============ START OF PASSWORD GENERATOR ============ */
const GEN_STORAGE_KEY = 'strongbox_gen_used';

// Reuse the existing password lists from PASSWORD_SUGGESTIONS
const PASSWORD_LISTS = {
    low: PASSWORD_SUGGESTIONS.low,
    medium: PASSWORD_SUGGESTIONS.medium,
    high: PASSWORD_SUGGESTIONS.high
};

const PIN_LISTS = {
    low: PASSWORD_SUGGESTIONS.pins.simple,
    medium: PASSWORD_SUGGESTIONS.pins.medium,
    high: PASSWORD_SUGGESTIONS.pins.high
};

let genState = {
    type: 'password',
    level: 'low',
    currentValue: null,
    used: {
        password: { low: new Set(), medium: new Set(), high: new Set() },
        pin: { low: new Set(), medium: new Set(), high: new Set() }
    }
};

function loadGenUsed() {
    try {
        const data = JSON.parse(localStorage.getItem(GEN_STORAGE_KEY));
        if (data) {
            for (const type of ['password', 'pin']) {
                for (const level of ['low', 'medium', 'high']) {
                    if (data[type] && data[type][level]) {
                        genState.used[type][level] = new Set(data[type][level]);
                    }
                }
            }
        }
    } catch (_) {}
}

function saveGenUsed() {
    const data = {
        password: {
            low: [...genState.used.password.low],
            medium: [...genState.used.password.medium],
            high: [...genState.used.password.high]
        },
        pin: {
            low: [...genState.used.pin.low],
            medium: [...genState.used.pin.medium],
            high: [...genState.used.pin.high]
        }
    };
    localStorage.setItem(GEN_STORAGE_KEY, JSON.stringify(data));
}

function initGenUsedFromVault() {
    for (const item of vaultItems) {
        const pwd = item.password;
        if (pwd) {
            for (const level of ['low', 'medium', 'high']) {
                if (PASSWORD_LISTS[level].includes(pwd)) {
                    genState.used.password[level].add(pwd);
                }
                if (PIN_LISTS[level].includes(pwd)) {
                    genState.used.pin[level].add(pwd);
                }
            }
        }
    }
    saveGenUsed();
}

function getGenList() {
    if (genState.type === 'password') {
        return PASSWORD_LISTS[genState.level] || [];
    } else {
        return PIN_LISTS[genState.level] || [];
    }
}

function getUsedSet() {
    return genState.used[genState.type][genState.level];
}

function getAvailableList() {
    const all = getGenList();
    const used = getUsedSet();
    return all.filter(item => !used.has(item));
}

function resetGenCategory() {
    const used = getUsedSet();
    used.clear();
    saveGenUsed();
}

function generateValue() {
    let available = getAvailableList();
    if (available.length === 0) {
        resetGenCategory();
        available = getAvailableList();
        if (available.length === 0) {
            const all = getGenList();
            genState.currentValue = all[0] || 'No options';
            updateGenUI();
            return;
        }
    }
    const randomIndex = Math.floor(Math.random() * available.length);
    genState.currentValue = available[randomIndex];
    updateGenUI();
}

function updateGenUI() {
    const resultEl = document.getElementById('genResult');
    const usedCountEl = document.getElementById('genUsedCount');
    const totalCountEl = document.getElementById('genTotalCount');
    if (!resultEl) return;
    const used = getUsedSet();
    const all = getGenList();
    const available = all.filter(item => !used.has(item));
    const usedCount = used.size;
    const totalCount = all.length;
    resultEl.textContent = genState.currentValue || 'Click Generate';
    usedCountEl.textContent = usedCount + ' used';
    totalCountEl.textContent = 'of ' + totalCount + ' available';
    if (available.length === 0 && totalCount > 0) {
        totalCountEl.textContent = 'all used — resetting...';
    }
}

function takeValue() {
    const value = genState.currentValue;
    if (!value) {
        showToast('Generate a value first', true);
        return;
    }
    const used = getUsedSet();
    if (used.has(value)) {
        showToast('This value is already used', true);
        return;
    }
    used.add(value);
    saveGenUsed();
    const modal = document.getElementById('vaultModalOverlay');
    const secretInput = document.getElementById('fSecret');
    if (modal && modal.classList.contains('open') && secretInput) {
        secretInput.value = value;
        showToast('Value inserted into password field');
    } else {
        copyToClipboard(value, 'Value copied to clipboard and marked as used');
    }
    generateValue();
}

function redoValue() {
    generateValue();
}

function initPasswordGenerator() {
    loadGenUsed();
    initGenUsedFromVault();

    document.querySelectorAll('.gen-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.gen-type-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            genState.type = this.dataset.type;
            genState.currentValue = null;
            updateGenUI();
        });
    });

    document.querySelectorAll('.gen-level-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.gen-level-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            genState.level = this.dataset.level;
            genState.currentValue = null;
            updateGenUI();
        });
    });

    document.getElementById('genGenerateBtn').addEventListener('click', generateValue);
    document.getElementById('genRedoBtn').addEventListener('click', redoValue);
    document.getElementById('genTakeBtn').addEventListener('click', takeValue);

    updateGenUI();
}
/* ============ END OF PASSWORD GENERATOR ============ */

    /* ============ START OF MODALS ============ */
    function openModal(overlayId) { $(overlayId).classList.add('open');
        $(overlayId).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

    function closeModal(overlayId) { $(overlayId).classList.remove('open'); }

    function openVaultModal(item) {
        editingVaultId = item ? item.id : null;
        $('vaultModalTitle').textContent = item ? 'Edit entry' : 'New entry';
        $('fName').value = item ? item.name : '';
        const urlHint = document.getElementById('urlDetectionHint');
        if (urlHint) {
            const url = extractURL($('fName').value);
            urlHint.textContent = url ? '✓ URL detected: ' + url : '';
            urlHint.style.color = url ? 'var(--good)' : 'var(--muted)';
        }
        $('fLogoUrl').value = item ? (item.logoUrl || '') : '';
        $('fUsername').value = item ? (item.username || '') : '';
        $('fSecret').value = item ? (item.password || '') : '';
        $('fSecret').type = 'password';
        if (item && item.password && item.password.trim()) {
            usedPasswords.add(item.password.trim());
        }
        $('fDesc').value = item ? (item.description || '') : '';
        populateVaultCategorySelect(item && item.category ? item.category : vaultCategories[0]);
        openModal('vaultModalOverlay');
        setTimeout(() => $('fName').focus(), 150);
    }

    async function saveVaultModal() {
        const name = $('fName').value.trim();
        if (!name) { showToast('Please enter a name', true);
            $('fName').focus(); return; }
        const now = Date.now();
        let item;
        if (editingVaultId) {
            item = vaultItems.find(i => i.id === editingVaultId);
            if (!item) return;
        } else {
            item = { id: uid(), createdAt: now };
            vaultItems.push(item);
        }
        let category = $('vCategory').value;
        if (category === '__new__') {
            const newName = $('vNewCategoryInput').value.trim();
            if (!newName) { showToast('Please enter a category name', true);
                $('vNewCategoryInput').focus(); return; }
            if (!vaultCategories.includes(newName)) { vaultCategories.push(newName);
                setPref('vaultCategories', vaultCategories); }
            category = newName;
        }
        item.name = name;
        item.logoUrl = $('fLogoUrl').value.trim();
        item.username = $('fUsername').value.trim();
        item.password = $('fSecret').value;
        if (item.password && item.password.trim()) {
            usedPasswords.add(item.password.trim());
        }
        item.category = category;
        item.description = $('fDesc').value.trim();
        item.updatedAt = now;
        try {
            await writeRecord('vault', item);
            addToIndex(searchIndex.vault, item.id, [item.name, item.username, item.description].join(' '));
            closeModal('vaultModalOverlay');
            renderVault();
            showToast(editingVaultId ? 'Entry updated' : 'Entry saved');
        } catch (err) {
            console.error(err);
            showToast('Could not save entry: ' + (err && err.message ? err.message : 'unknown error'), true);
        }
    }
    /* ============ END OF MODALS (VAULT) ============ */

    /* ============ START OF CSV EXPORT/IMPORT ============ */
    function csvEscape(val) {
        const s = (val === undefined || val === null) ? '' : String(val);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function csvParse(text) {
        const rows = [];
        let row = [],
            field = '',
            inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"';
                        i++; } else { inQuotes = false; }
                } else { field += c; }
            } else {
                if (c === '"') { inQuotes = true; } else if (c === ',') { row.push(field);
                    field = ''; } else if (c === '\n') { row.push(field);
                    rows.push(row);
                    row = [];
                    field = ''; } else if (c === '\r') {} else { field += c; }
            }
        }
        if (field.length || row.length) { row.push(field);
            rows.push(row); }
        return rows.filter(r => !(r.length === 1 && r[0] === ''));
    }

    function exportVaultCSV() {
        if (!vaultItems.length) { showToast('No entries to export', true); return; }
        const header = ['name', 'username', 'password', 'description', 'category'];
        const lines = [header.map(csvEscape).join(',')];
        vaultItems.forEach(item => {
            lines.push([
                csvEscape(item.name),
                csvEscape(item.username || ''),
                csvEscape(item.password || ''),
                csvEscape(item.description || ''),
                csvEscape(item.category || '')
            ].join(','));
        });
        const csvContent = lines.join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ts = new Date().toISOString().slice(0, 10);
        a.download = 'strongbox-vault-' + ts + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Exported ' + vaultItems.length + ' entries');
    }

    async function importVaultCSVFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            const rows = csvParse(text);
            if (!rows.length) { showToast('CSV file is empty', true); return; }
            let startIdx = 0;
            const headerLower = rows[0].map(h => h.trim().toLowerCase());
            const looksLikeHeader = headerLower.includes('name') && headerLower.includes('password');
            let colMap = { name: 0, username: 1, password: 2, description: 3, category: 4 };
            if (looksLikeHeader) {
                startIdx = 1;
                colMap = {
                    name: headerLower.indexOf('name'),
                    username: headerLower.indexOf('username'),
                    password: headerLower.indexOf('password'),
                    description: headerLower.indexOf('description'),
                    category: headerLower.indexOf('category')
                };
            }
            let imported = 0,
                skipped = 0;
            for (let i = startIdx; i < rows.length; i++) {
                const r = rows[i];
                const name = (r[colMap.name] || '').trim();
                if (!name) { skipped++; continue; }
                const now = Date.now();
                const category = colMap.category > -1 ? (r[colMap.category] || '').trim() : '';
                const item = {
                    id: uid(),
                    name: name,
                    username: colMap.username > -1 ? (r[colMap.username] || '').trim() : '',
                    password: colMap.password > -1 ? (r[colMap.password] || '') : '',
                    description: colMap.description > -1 ? (r[colMap.description] || '').trim() : '',
                    category: category,
                    createdAt: now,
                    updatedAt: now
                };
                if (category && !vaultCategories.includes(category)) {
                    vaultCategories.push(category);
                    setPref('vaultCategories', vaultCategories);
                }
                vaultItems.push(item);
                await writeRecord('vault', item);
                addToIndex(searchIndex.vault, item.id, [item.name, item.username, item.description].join(
                ' '));
                imported++;
            }
            renderVault();
            renderVaultFilterMenu();
            showToast('Imported ' + imported + ' entries' + (skipped ? (', skipped ' + skipped) : ''));
        } catch (err) {
            console.error(err);
            showToast('Could not import CSV: ' + (err && err.message ? err.message : 'unknown error'), true);
        }
    }

    async function deleteVaultEntry(id) {
        const item = vaultItems.find(i => i.id === id);
        if (!item) return;
        vaultItems = vaultItems.filter(i => i.id !== id);
        await moveToTrash(item, 'vault');
        renderVault();
        renderTrash();
        showToast('Entry moved to trash');
    }
    /* ============ END OF CSV EXPORT/IMPORT ============ */

    /* ============ START OF GOAL HELPERS ============ */
    function populateGoalCategorySelect(selected) {
        const sel = $('gCategory');
        sel.innerHTML = goalCategories.map(c =>
            '<option value="' + escapeAttr(c) + '"' + (c === selected ? ' selected' : '') + '>' + escapeHTML(c) +
            '</option>'
        ).join('') + '<option value="__new__">+ Create new category</option>';
        $('newCategoryRow').style.display = 'none';
        $('gNewCategoryInput').value = '';
    }

    function confirmNewGoalCategory() {
        const name = $('gNewCategoryInput').value.trim();
        if (!name) { $('gNewCategoryInput').focus(); return; }
        if (!goalCategories.includes(name)) {
            goalCategories.push(name);
            setPref('goalCategories', goalCategories);
        }
        populateGoalCategorySelect(name);
        renderGoalFilterMenu();
    }

    function renderGoalFilterMenu() {
        const menu = $('goalsFilterMenu');
        const options = ['all', ...goalCategories];
        menu.innerHTML = options.map(opt => {
            const label = opt === 'all' ? 'All' : opt;
            const active = activeGoalFilter === opt ? ' active' : '';
            return '<button type="button" class="filter-menu-item' + active + '" data-filter="' + escapeAttr(
                opt) + '">' + escapeHTML(label) + '</button>';
        }).join('');
        $('goalsFilterLabel').textContent = activeGoalFilter === 'all' ? 'All' : activeGoalFilter;
    }

    function openGoalModal(item) {
        editingGoalId = item ? item.id : null;
        $('goalModalTitle').textContent = item ? 'Edit goal' : 'New goal';
        $('gName').value = item ? item.name : '';
        $('gDesc').value = item ? (item.description || '') : '';
        populateGoalCategorySelect(item && item.category ? item.category : goalCategories[0]);
        openModal('goalModalOverlay');
        setTimeout(() => $('gName').focus(), 150);
    }

    async function saveGoalModal() {
        const name = $('gName').value.trim();
        if (!name) { showToast('Please enter a name', true);
            $('gName').focus(); return; }
        const now = Date.now();
        let item;
        if (editingGoalId) {
            item = goalItems.find(i => i.id === editingGoalId);
            if (!item) return;
        } else {
            item = { id: uid(), createdAt: now, done: false };
            goalItems.push(item);
        }
        let category = $('gCategory').value;
        if (category === '__new__') {
            const newName = $('gNewCategoryInput').value.trim();
            if (!newName) { showToast('Please enter a category name', true);
                $('gNewCategoryInput').focus(); return; }
            if (!goalCategories.includes(newName)) { goalCategories.push(newName);
                setPref('goalCategories', goalCategories); }
            category = newName;
        }
        item.name = name;
        item.category = category;
        item.description = $('gDesc').value.trim();
        item.updatedAt = now;
        try {
            await writeRecord('goals', item);
            addToIndex(searchIndex.goals, item.id, [item.name, item.description].join(' '));
            closeModal('goalModalOverlay');
            renderGoals();
            showToast(editingGoalId ? 'Goal updated' : 'Goal saved');
        } catch (err) {
            console.error(err);
            showToast('Could not save goal: ' + (err && err.message ? err.message : 'unknown error'), true);
        }
    }

    async function toggleGoalDone(id) {
        const item = goalItems.find(i => i.id === id);
        if (!item) return;
        item.done = !item.done;
        item.updatedAt = Date.now();
        await writeRecord('goals', item);
        renderGoals();
    }

    async function deleteGoalEntry(id) {
        const item = goalItems.find(i => i.id === id);
        if (!item) return;
        goalItems = goalItems.filter(i => i.id !== id);
        await moveToTrash(item, 'goals');
        renderGoals();
        renderTrash();
        showToast('Goal moved to trash');
    }
    /* ============ END OF GOAL HELPERS ============ */

    /* ============ START OF VAULT CATEGORY HELPERS ============ */
    function populateVaultCategorySelect(selected) {
        const sel = $('vCategory');
        sel.innerHTML = vaultCategories.map(c =>
            '<option value="' + escapeAttr(c) + '"' + (c === selected ? ' selected' : '') + '>' + escapeHTML(c) +
            '</option>'
        ).join('') + '<option value="__new__">+ Create new category</option>';
        $('newVaultCategoryRow').style.display = 'none';
        $('vNewCategoryInput').value = '';
    }

    function confirmNewVaultCategory() {
        const name = $('vNewCategoryInput').value.trim();
        if (!name) { $('vNewCategoryInput').focus(); return; }
        if (!vaultCategories.includes(name)) {
            vaultCategories.push(name);
            setPref('vaultCategories', vaultCategories);
        }
        populateVaultCategorySelect(name);
        renderVaultFilterMenu();
    }

    function renderVaultFilterMenu() {
        const menu = $('vaultFilterMenu');
        const options = ['all', ...vaultCategories];
        menu.innerHTML = options.map(opt => {
            const label = opt === 'all' ? 'All' : opt;
            const active = activeVaultFilter === opt ? ' active' : '';
            return '<button type="button" class="filter-menu-item' + active + '" data-filter="' + escapeAttr(
                opt) + '">' + escapeHTML(label) + '</button>';
        }).join('');
        $('vaultFilterLabel').textContent = activeVaultFilter === 'all' ? 'All' : activeVaultFilter;
    }
    /* ============ END OF VAULT CATEGORY HELPERS ============ */

    /* ============ START OF CLIPBOARD ============ */
    function copyToClipboard(text, msg) {
        if (!text) { showToast('Nothing to copy', true); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showToast(msg || 'Copied to clipboard');
                if (clipboardTimer) clearTimeout(clipboardTimer);
                clipboardTimer = setTimeout(() => {
                    navigator.clipboard.writeText('').catch(() => {});
                }, 20000);
            }).catch(() => showToast(msg || 'Copied to clipboard'));
        } else {
            showToast(msg || 'Copied to clipboard');
        }
    }
    /* ============ END OF CLIPBOARD ============ */

    /* ============ START OF VERIFIER ============ */
    async function makeVerifier(key) {
        return encryptJSON(key, { check: 'strongbox-verify-v1', ts: Date.now() });
    }

    async function checkVerifier(key, iv, cipher) {
        try {
            const v = await decryptJSON(key, iv, cipher);
            return !!(v && v.check === 'strongbox-verify-v1');
        } catch (e) { return false; }
    }

    async function reencryptAllData() {
        for (const it of vaultItems) await writeRecord('vault', it);
        for (const it of goalItems) await writeRecord('goals', it);
        for (const it of folders) await writeRecord('folders', it);
        for (const it of notes) await writeRecord('notes', it);
        for (const it of cardItems) await writeRecord('cards', it);
        for (const t of trashItems) await writeRecord('trash', t, { expiresAt: t.expiresAt, deletedAt: t
                .deletedAt });
        await saveSearchIndexEncrypted();
    }
    /* ============ END OF VERIFIER ============ */

    /* ============ START OF LOAD ALL DATA ============ */
    async function loadAllData() {
        vaultItems = await loadStore('vault');
        goalItems = await loadStore('goals');
        folders = await loadStore('folders');
        notes = await loadStore('notes');
        cardItems = await loadStore('cards');
        trashItems = await loadStore('trash');
        await clearExpiredTrash();
        if (folders.length > 0 && !folders.some(f => f.id === selectedFolderId)) selectedFolderId = folders[0].id;
        if (folders.length === 0) selectedFolderId = null;
        buildSearchIndex();
    }

    function renderEverything() {
        renderVaultMode();
        renderGoals();
        renderFolders();
        renderNotes();
        loadNoteIntoEditor();
        renderTrash();
    }
    /* ============ END OF LOAD ALL DATA ============ */

    /* ============ START OF VAULT MODE SWITCHING ============ */
    function setVaultMode(mode) {
        vaultMode = mode;
        document.querySelectorAll('.vault-mode-toggle .mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        const list = $('vaultList');
        const cardContainer = document.getElementById('cardListContainer');
        const filterWrap = document.getElementById('vaultFilterWrap');
        const newBtnLabel = $('newVaultBtnLabel');
        const exportBtn = $('exportVaultBtn');
        const importBtn = $('importVaultBtn');

        if (mode === 'passwords') {
            list.style.display = 'flex';
            if (cardContainer) cardContainer.style.display = 'none';
            if (filterWrap) filterWrap.style.display = 'flex';
            newBtnLabel.textContent = 'New entry';
            exportBtn.style.display = 'inline-flex';
            importBtn.style.display = 'inline-flex';
            renderVault();
            renderVaultFilterMenu();
        } else {
            list.style.display = 'none';
            if (cardContainer) cardContainer.style.display = 'block';
            if (filterWrap) filterWrap.style.display = 'flex';
            newBtnLabel.textContent = 'New card';
            exportBtn.style.display = 'none';
            importBtn.style.display = 'none';
            renderCards();
            renderCardFilterMenu();
        }
        if (mode === 'passwords') {
            $('vaultFilterLabel').textContent = activeVaultFilter === 'all' ? 'All' : activeVaultFilter;
        } else {
            $('vaultFilterLabel').textContent = activeCardFilter === 'all' ? 'All' : CARD_TYPE_LABELS[
                activeCardFilter] || activeCardFilter;
        }
        updateVaultCount();
        setPref('vaultMode', mode);
    }

    function updateVaultCount() {
        if (vaultMode === 'passwords') {
            const query = $('vaultSearch').value.trim();
            let count = vaultItems.length;
            let shown = vaultItems.length;
            if (activeVaultFilter !== 'all') {
                shown = vaultItems.filter(it => it.category === activeVaultFilter).length;
            }
            if (query) {
                const matchIds = searchByIndex(searchIndex.vault, query);
                shown = vaultItems.filter(it => matchIds.has(it.id)).length;
            }
            $('vaultCount').textContent = count + (count === 1 ? ' entry' : ' entries') + (query ? ' · ' + shown +
                ' shown' : '');
        } else {
            const query = $('vaultSearch').value.trim();
            let count = cardItems.length;
            let shown = cardItems.length;
            if (activeCardFilter !== 'all') {
                shown = cardItems.filter(it => it.type === activeCardFilter).length;
            }
            if (query) {
                shown = cardItems.filter(it => {
                    const searchStr = [it.name, it.type, ...Object.values(it.data || {})].join(' ')
                        .toLowerCase();
                    return searchStr.includes(query.toLowerCase());
                }).length;
            }
            $('vaultCount').textContent = count + (count === 1 ? ' card' : ' cards') + (query ? ' · ' + shown +
                ' shown' : '');
        }
    }
    /* ============ END OF VAULT MODE SWITCHING ============ */

    /* ============ START OF CARDS ============ */
    function getCardDisplayName(card) {
        if (card.name) return card.name;
        const schema = CARD_SCHEMAS[card.type];
        if (!schema) return CARD_TYPE_LABELS[card.type] || 'Card';
        const primaryKey = schema.preview.primary;
        if (primaryKey && card.data && card.data[primaryKey]) {
            return card.data[primaryKey];
        }
        return CARD_TYPE_LABELS[card.type] || 'Card';
    }

    function getCardSecondary(card) {
        const schema = CARD_SCHEMAS[card.type];
        if (!schema) return null;
        const secondaryKey = schema.preview.secondary;
        if (secondaryKey && card.data && card.data[secondaryKey]) {
            return card.data[secondaryKey];
        }
        return null;
    }

    function getCardTertiary(card) {
        const schema = CARD_SCHEMAS[card.type];
        if (!schema) return null;
        const tertiaryKey = schema.preview.tertiary;
        if (tertiaryKey && card.data && card.data[tertiaryKey]) {
            return card.data[tertiaryKey];
        }
        return null;
    }

    function maskCardNumber(num) {
        if (!num) return '•••• •••• •••• ••••';
        const s = String(num).replace(/\s/g, '');
        if (s.length <= 4) return s;
        const visible = s.slice(-4);
        const masked = '•••• •••• •••• ';
        return masked + visible;
    }

    function renderCards() {
        const container = document.getElementById('cardListContainer');
        if (!container) return;
        const query = $('vaultSearch').value.trim();
        let items = cardItems;
        if (activeCardFilter !== 'all') {
            items = items.filter(it => it.type === activeCardFilter);
        }
        if (query) {
            items = items.filter(it => {
                const searchStr = [it.name, it.type, ...Object.values(it.data || {})].join(' ').toLowerCase();
                return searchStr.includes(query.toLowerCase());
            });
        }
        items = items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        if (items.length === 0) {
            container.innerHTML = cardEmptyStateHTML(
                '<rect x="3" y="10" width="18" height="10" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
                cardItems.length === 0 ? 'No cards yet' : 'No matches',
                cardItems.length === 0 ? 'Add your first card to get started.' :
                'Try a different search term.',
                'Add card',
                'newCard'
            );
            const createBtn = document.getElementById('cardEmptyCreateBtn');
            if (createBtn) {
                createBtn.onclick = () => openCardModal(null);
            }
            return;
        }

        container.innerHTML = items.map(card => {
            const displayName = getCardDisplayName(card);
            const secondary = getCardSecondary(card);
            const tertiary = getCardTertiary(card);
            const typeLabel = CARD_TYPE_LABELS[card.type] || card.type;
            const color = CARD_COLORS[card.type] || '#666';

            let secondaryHTML = '';
            if (secondary) {
                const masked = maskCardNumber(secondary);
                secondaryHTML =
                    '<div class="card-detail"><span class="label">' + (card.type === 'store' ? 'Account No.' : card.type === 'gift' ? 'Voucher No.' : '') +
                    ' </span>' + escapeHTML(masked) + '</div>';
            }
            let tertiaryHTML = '';
            if (tertiary) {
                const label = card.type === 'store' ? 'Expiry' :
                    card.type === 'gift' ? '' :
                    card.type === 'insurance' ? 'Expiry' :
                    card.type === 'student' ? 'Campus' :
                    card.type === 'drivingLicense' ? 'Codes' :
                    card.type === 'passport' ? 'Nationality' :
                    card.type === 'id' ? 'Status' :
                    card.type === 'medicalAid' ? 'Plan' :
                    'Expiry';
                if (label) {
                    tertiaryHTML = '<div class="card-detail"><span class="label">' + label + ' </span>' + escapeHTML(tertiary) + '</div>';
                }
            }

            return '<div class="card-item" data-id="' + card.id + '">' +
                renderCardMiniPreview(card) +
                '<div class="card-info">' +
                '<div class="card-name">' + escapeHTML(displayName) + '</div>' +
                secondaryHTML +
                tertiaryHTML +
                '<span class="card-tag">' + escapeHTML(typeLabel) + '</span>' +
                '</div>' +
                '<div class="entry-menu">' +
                '<button class="icon-btn edit-card" title="Edit">' + iconEdit() + '</button>' +
                '<button class="icon-btn danger delete-card" title="Move to trash">' + iconTrash() +
                '</button>' +
                '</div>' +
                '</div>';
        }).join('');
    }

    function renderCardMiniPreview(card) {
        const type = card.type;
        const icon = CARD_TYPE_ICONS[type] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
        const label = CARD_TYPE_LABELS[type] || type;
        return '<div class="card-mini-preview type-' + type + '">' + icon + '<span style="font-size:7px;letter-spacing:.06em;opacity:.85;text-align:center;line-height:1.3;display:block;margin-top:2px;">' + label + '</span></div>';
    }

    function openCardModal(card) {
        editingCardId = card ? card.id : null;
        $('cardModalTitle').textContent = card ? 'Edit Card' : 'New Card';
        const selector = document.getElementById('cardTypeSelector');
        const currentType = card ? card.type : 'store';
        selector.innerHTML = CARD_TYPES.map(t => {
            const label = CARD_TYPE_LABELS[t] || t;
            const icon = CARD_TYPE_ICONS[t] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
            return '<button type="button" class="type-opt ' + (t === currentType ? 'active' : '') +
                '" data-type="' + t + '">' + icon + ' <span style="vertical-align:middle;">' + label + '</span></button>';
        }).join('');

        selector.querySelectorAll('.type-opt').forEach(btn => {
            btn.addEventListener('click', function() {
                selector.querySelectorAll('.type-opt').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                const type = this.dataset.type;
                buildCardFields(type, card);
                updateCardPreview(type, card);
                const preview = document.getElementById('cardPreview');
                preview.classList.remove('flip');
                void preview.offsetWidth;
                preview.classList.add('flip');
            });
        });

        buildCardFields(currentType, card);
        updateCardPreview(currentType, card);
        openModal('cardModalOverlay');
        setTimeout(() => {
            const firstInput = document.querySelector('#cardFieldsContainer input');
            if (firstInput) firstInput.focus();
        }, 200);
    }

    function buildCardFields(type, card) {
        const container = document.getElementById('cardFieldsContainer');
        const schema = CARD_SCHEMAS[type];
        if (!schema) {
            container.innerHTML = '<p>No fields defined for this card type.</p>';
            return;
        }
        const data = card ? card.data || {} : {};
        const nameValue = card ? card.name || '' : '';
        let html = '';
        html += '<div class="form-group full-width">' +
            '<label>Card Name <span style="text-transform:none;font-weight:400;">(optional)</span></label>' +
            '<input type="text" id="cardNameInput" placeholder="e.g. My ' + (CARD_TYPE_LABELS[type] || 'Card') +
            '" value="' + escapeAttr(nameValue) + '">' +
            '</div>';
        schema.fields.forEach(f => {
            const val = data[f.key] !== undefined && data[f.key] !== null ? data[f.key] : '';
            const isPassword = f.type === 'password';
            const isTextarea = f.type === 'textarea';
            const isSelect = f.type === 'select';
            const isNullable = f.nullable === true;
            const rows = isTextarea ? ' rows="2"' : '';

            html += '<div class="form-group">' +
                '<label>' + f.label + (f.required ? ' <span style="color:var(--bad)">*</span>' : '') +
                (isNullable ? ' <span style="color:var(--muted);font-weight:400;text-transform:none;">(can be N/A)</span>' :
                    '') +
                '</label>';

            if (isSelect) {
                html += '<select id="cardField_' + f.key + '">';
                (f.options || []).forEach(opt => {
                    const selected = val === opt ? ' selected' : '';
                    html += '<option value="' + escapeAttr(opt) + '"' + selected + '>' + escapeHTML(opt) +
                        '</option>';
                });
                html += '</select>';
            } else if (isTextarea) {
                html += '<textarea id="cardField_' + f.key + '" placeholder="Enter ' + f.label.toLowerCase() +
                    '"' + rows + '>' + escapeHTML(val) + '</textarea>';
            } else {
                const inputType = isPassword ? 'password' : 'text';
                html += '<input type="' + inputType + '" id="cardField_' + f.key + '" placeholder="Enter ' + f
                    .label.toLowerCase() + '" value="' + escapeAttr(val) + '">';
                if (isPassword && f.maskDefault) {
                    html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:middle;margin-right:3px;"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none"/></svg> Masked by default for security</div>';
                }
            }
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('input, textarea, select').forEach(el => {
            el.addEventListener('input', function() {
                const type2 = document.querySelector('#cardTypeSelector .type-opt.active')
                    ?.dataset?.type || type;
                updateCardPreviewFromFields(type2);
            });
            el.addEventListener('change', function() {
                const type2 = document.querySelector('#cardTypeSelector .type-opt.active')
                    ?.dataset?.type || type;
                updateCardPreviewFromFields(type2);
            });
        });
        const nameInput = document.getElementById('cardNameInput');
        if (nameInput) {
            nameInput.addEventListener('input', function() {
                const type2 = document.querySelector('#cardTypeSelector .type-opt.active')
                    ?.dataset?.type || type;
                updateCardPreviewFromFields(type2);
            });
        }
    }

    function collectCardFields(type) {
        const schema = CARD_SCHEMAS[type];
        if (!schema) return {};
        const data = {};
        schema.fields.forEach(f => {
            const el = document.getElementById('cardField_' + f.key);
            if (el) {
                data[f.key] = el.value;
            }
        });
        return data;
    }

    function updateCardPreviewFromFields(type) {
        const data = collectCardFields(type);
        const name = document.getElementById('cardNameInput')?.value || '';
        const schema = CARD_SCHEMAS[type];
        const preview = document.getElementById('cardPreview');
        const badge = document.getElementById('cardPreviewBadge');
        badge.textContent = CARD_TYPE_LABELS[type] || type.toUpperCase();

        const numEl = document.getElementById('cardPreviewNumber');
        const secondaryKey = schema?.preview?.secondary;
        let secondaryVal = secondaryKey && data[secondaryKey] ? data[secondaryKey] : '';
        if (type === 'gift' && !secondaryVal) {
            secondaryVal = data['voucherNumber'] || '';
        }
        if (secondaryVal) {
            const masked = maskCardNumber(secondaryVal);
            const parts = masked.split(' ');
            numEl.innerHTML = parts.map((p, i) => {
                if (i === parts.length - 1) {
                    return '<span class="visible">' + escapeHTML(p) + '</span>';
                }
                return '<span class="masked">' + escapeHTML(p) + '</span>';
            }).join(' ');
        } else {
            numEl.innerHTML =
                '<span class="masked">••••</span> <span class="masked">••••</span> <span class="masked">••••</span> <span class="visible">0000</span>';
        }

        const nameDisplay = document.getElementById('cardPreviewName');
        nameDisplay.textContent = name || 'Cardholder';

        const expiryEl = document.getElementById('cardPreviewExpiry');
        const tertiaryKey = schema?.preview?.tertiary;
        let tertiaryVal = tertiaryKey && data[tertiaryKey] ? data[tertiaryKey] : '';
        if (type === 'id' && (tertiaryVal === 'N/A' || tertiaryVal === 'Indefinite' || tertiaryVal === '')) {
            expiryEl.textContent = 'N/A';
        } else if (schema?.preview?.expiry && tertiaryVal) {
            expiryEl.textContent = tertiaryVal;
        } else if (schema?.preview?.expiry) {
            expiryEl.textContent = 'MM/YY';
        } else {
            expiryEl.textContent = '—';
        }

        preview.className = 'card-preview type-' + type;
        preview.classList.remove('flip');
        void preview.offsetWidth;
        preview.classList.add('flip');
    }

    function updateCardPreview(type, card) {
        const preview = document.getElementById('cardPreview');
        const badge = document.getElementById('cardPreviewBadge');
        badge.textContent = CARD_TYPE_LABELS[type] || type.toUpperCase();

        const data = card ? card.data || {} : {};
        const name = card ? card.name || '' : '';
        const schema = CARD_SCHEMAS[type];

        const numEl = document.getElementById('cardPreviewNumber');
        const secondaryKey = schema?.preview?.secondary;
        let secondaryVal = secondaryKey && data[secondaryKey] ? data[secondaryKey] : '';
        if (type === 'gift' && !secondaryVal) {
            secondaryVal = data['voucherNumber'] || '';
        }
        if (secondaryVal) {
            const masked = maskCardNumber(secondaryVal);
            const parts = masked.split(' ');
            numEl.innerHTML = parts.map((p, i) => {
                if (i === parts.length - 1) {
                    return '<span class="visible">' + escapeHTML(p) + '</span>';
                }
                return '<span class="masked">' + escapeHTML(p) + '</span>';
            }).join(' ');
        } else {
            numEl.innerHTML =
                '<span class="masked">••••</span> <span class="masked">••••</span> <span class="masked">••••</span> <span class="visible">0000</span>';
        }

        const nameDisplay = document.getElementById('cardPreviewName');
        nameDisplay.textContent = name || 'Cardholder';

        const expiryEl = document.getElementById('cardPreviewExpiry');
        const tertiaryKey = schema?.preview?.tertiary;
        let tertiaryVal = tertiaryKey && data[tertiaryKey] ? data[tertiaryKey] : '';
        if (type === 'id' && (tertiaryVal === 'N/A' || tertiaryVal === 'Indefinite' || tertiaryVal === '')) {
            expiryEl.textContent = 'N/A';
        } else if (schema?.preview?.expiry && tertiaryVal) {
            expiryEl.textContent = tertiaryVal;
        } else if (schema?.preview?.expiry) {
            expiryEl.textContent = 'MM/YY';
        } else {
            expiryEl.textContent = '—';
        }

        preview.className = 'card-preview type-' + type;
        preview.classList.remove('flip');
        void preview.offsetWidth;
        preview.classList.add('flip');
    }

    async function saveCardModal() {
        const activeTypeBtn = document.querySelector('#cardTypeSelector .type-opt.active');
        if (!activeTypeBtn) { showToast('Please select a card type', true); return; }
        const type = activeTypeBtn.dataset.type;
        const schema = CARD_SCHEMAS[type];
        if (!schema) { showToast('Invalid card type', true); return; }

        const data = collectCardFields(type);
        let missing = false;
        schema.fields.forEach(f => {
            if (f.required && !data[f.key]?.trim()) {
                missing = true;
                const el = document.getElementById('cardField_' + f.key);
                if (el) {
                    el.style.borderColor = 'var(--bad)';
                    setTimeout(() => { el.style.borderColor = ''; }, 1500);
                }
            }
        });
        if (missing) { showToast('Please fill in all required fields', true); return; }

        if (type === 'id' && data['expiry'] !== undefined) {
            if (!data['expiry'] || data['expiry'].toUpperCase() === 'N/A' || data['expiry'].toUpperCase() ===
                'INDEFINITE') {
                data['expiry'] = 'N/A';
            }
        }

        const name = document.getElementById('cardNameInput')?.value?.trim() || '';
        const now = Date.now();
        let card;
        if (editingCardId) {
            card = cardItems.find(c => c.id === editingCardId);
            if (!card) return;
        } else {
            card = { id: uid(), createdAt: now };
            cardItems.push(card);
        }
        card.type = type;
        card.name = name || getCardDisplayNameFromData(type, data);
        card.data = data;
        card.updatedAt = now;

        try {
            await writeRecord('cards', card);
            closeModal('cardModalOverlay');
            renderCards();
            updateVaultCount();
            showToast(editingCardId ? 'Card updated' : 'Card saved');
        } catch (err) {
            console.error(err);
            showToast('Could not save card: ' + (err && err.message ? err.message : 'unknown error'), true);
        }
    }

    function getCardDisplayNameFromData(type, data) {
        const schema = CARD_SCHEMAS[type];
        if (!schema) return CARD_TYPE_LABELS[type] || 'Card';
        const primaryKey = schema.preview.primary;
        if (primaryKey && data[primaryKey]) {
            return data[primaryKey];
        }
        return CARD_TYPE_LABELS[type] || 'Card';
    }

    async function deleteCardEntry(id) {
        const card = cardItems.find(c => c.id === id);
        if (!card) return;
        cardItems = cardItems.filter(c => c.id !== id);
        await moveToTrash(card, 'cards');
        renderCards();
        renderTrash();
        updateVaultCount();
        showToast('Card moved to trash');
    }

    function renderCardFilterMenu() {
        const menu = $('vaultFilterMenu');
        const options = ['all', ...CARD_TYPES];
        menu.innerHTML = options.map(opt => {
            const label = opt === 'all' ? 'All' : (CARD_TYPE_LABELS[opt] || opt);
            const active = activeCardFilter === opt ? ' active' : '';
            return '<button type="button" class="filter-menu-item' + active + '" data-filter="' + escapeAttr(
                opt) + '">' + escapeHTML(label) + '</button>';
        }).join('');
        $('vaultFilterLabel').textContent = activeCardFilter === 'all' ? 'All' : (CARD_TYPE_LABELS[
            activeCardFilter] || activeCardFilter);
    }
    /* ============ END OF CARDS ============ */

    /* ============ START OF VAULT MODE RENDER ============ */
    function renderVaultMode() {
        setVaultMode(vaultMode);
    }
    /* ============ END OF VAULT MODE RENDER ============ */

    /* ============ START OF LOCK SCREEN ============ */
    function applyLockScreenMode() {
        const wrap = document.getElementById('lockEmailWrap');
        if (!wrap) return;
        if (syncMode === 'cloud') {
            wrap.style.display = '';
            $('lockScreenLabel').textContent = 'Sign in to your vault';
        } else {
            wrap.style.display = 'none';
            $('lockEmailInput').value = '';
            $('lockScreenLabel').textContent = 'Enter your password';
        }
    }

    function showLockScreen(forInitialSetup) {
        applyLockScreenMode();
        isLocked = true;
        lastUnlockEmail = null;
        lastUnlockPassword = null;
        if (window.FirebaseSync) window.FirebaseSync.signOut();
        $('app').classList.remove('unlocked');
        $('app').classList.add('locked');
        $('lockScreen').classList.add('visible');
        $('lockScreenLabel').textContent = 'Sign in to your vault';
        $('lockPasswordInput').value = '';
        $('lockPasswordInput').type = 'password';
        $('lockEmailInput').value = '';
        $('lockError').textContent = '';
        clearAutoLockTimer();
        setTimeout(() => $('lockEmailInput').focus(), 200);
    }

    function hideLockScreen() {
        isLocked = false;
        $('lockScreen').classList.remove('visible');
        $('app').classList.remove('locked');
        $('app').classList.add('unlocked');
        startAutoLockTimer();
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

   async function attemptUnlock() {
        const btn = $('lockUnlockBtn');
        const pass = $('lockPasswordInput').value;
        const email = syncMode === 'cloud' ? $('lockEmailInput').value.trim() : '';
        const errEl = $('lockError');
        errEl.textContent = '';

        if (syncMode === 'cloud') {
            if (!email) {
                errEl.textContent = 'Please enter your email address.';
                $('lockEmailInput').focus();
                return;
            }
            if (!isValidEmail(email)) {
                errEl.textContent = 'Please enter a valid email address (e.g., name@example.com).';
                $('lockEmailInput').focus();
                $('lockEmailInput').select();
                return;
            }
        }

        if (!pass) {
            errEl.textContent = 'Please enter your password.';
            $('lockPasswordInput').focus();
            return;
        }
        if (!saltB64) {
            errEl.textContent = 'No lock is configured. Please set a password in Settings.';
            return;
        }
        btn.disabled = true;
        const origText = btn.textContent;
        btn.textContent = 'Unlocking…';
        try {
            const key = await deriveKey(pass, saltB64);
            const verifierIv = await getMeta('verifierIv', null);
            const verifierCipher = await getMeta('verifierCipher', null);
            const ok = verifierIv && verifierCipher ? await checkVerifier(key, verifierIv, verifierCipher) :
                false;
            if (!ok) {
                errEl.textContent = 'Incorrect password or PIN. Try again.';
                btn.disabled = false;
                btn.textContent = origText;
                $('lockPasswordInput').focus();
                $('lockPasswordInput').select();
                return;
            }
            cryptoKey = key;
            lastUnlockEmail = email;
            lastUnlockPassword = pass;
            await loadAllData();
            initGenUsedFromVault();
            renderEverything();
           hideLockScreen();
            showToast('Unlocked');
            if (syncMode === 'cloud') performCloudSync(email, pass);
        } catch (err) {
            console.error(err);
            errEl.textContent = 'Something went wrong while unlocking. Please try again.';
        } finally {
            btn.disabled = false;
            btn.textContent = origText;
        }
    }

    function clearAutoLockTimer() { if (autoLockTimer) { clearTimeout(autoLockTimer);
            autoLockTimer = null; } }

    function startAutoLockTimer() {
        clearAutoLockTimer();
        if (!lockEnabled) return;
        autoLockTimer = setTimeout(() => {
            if (!isLocked && lockEnabled) showLockScreen();
        }, autoLockMinutes * 60 * 1000);
    }

    function resetAutoLockTimer() {
        if (isLocked || !lockEnabled) return;
        startAutoLockTimer();
    }

    function initAutoLockActivity() {
        ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, resetAutoLockTimer, { passive: true });
        });
    }
    /* ============ END OF LOCK SCREEN ============ */

    /* ============ START OF SETTINGS ============ */
    function refreshSettingsView() {
        const dormant = !lockEnabled && !!saltB64;
        $('lockToggle').checked = lockEnabled;
        $('lockStateWord').textContent = lockEnabled ? 'on' : (dormant ? 'off (password saved)' : 'off');
       // Show the "set password" form only when the toggle is switched on and no lock exists
$('lockSetSection').style.display = (lockEnabled || saltB64) ? 'none' : ($('lockToggle').dataset.pendingOn === '1' ? 'flex' : 'none');

// Always show the Cloud Restore section when no lock is set (regardless of toggle state)
if ($('cloudRestoreSection')) {
    $('cloudRestoreSection').style.display = (lockEnabled || saltB64) ? 'none' : 'block';
}
        $('lockManageSection').style.display = (lockEnabled || dormant) ? 'block' : 'none';
        $('openChangePassBtn').style.display = lockEnabled ? 'inline-flex' : 'none';
        $('openResetLockBtn').style.display = (lockEnabled || dormant) ? 'inline-flex' : 'none';
        $('openResetLockBtnLabel').textContent = dormant ? 'Forget saved password' : 'Reset lock screen';
        $('changePassForm').style.display = 'none';
        $('resetLockForm').style.display = 'none';
        $('lockOffForm').style.display = 'none';
        $('lockReenableForm').style.display = 'none';
        $('autoLockSelect').value = String(autoLockMinutes);

        const panicToggle = $('panicLockToggle');
        if (panicToggle) {
            panicToggle.checked = getPref('panicLockEnabled', false);
            panicLockEnabled = panicToggle.checked;
        }

        const pill = $('encryptionStatusPill');
        if (encryptionEnabled) {
            pill.className = 'status-pill on';
            pill.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Encrypted (AES-256-GCM)';
        } else {
            pill.className = 'status-pill off';
            pill.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Not encrypted — set a lock PIN to enable';
        }

        const totalCards = cardItems.length;
        $('sessionInfo').innerHTML =
            '<div><span>Session started</span><strong>' + new Date(sessionStart).toLocaleString() +
            '</strong></div>' +
            '<div><span>Vault entries</span><strong>' + vaultItems.length + '</strong></div>' +
            '<div><span>Cards</span><strong>' + totalCards + '</strong></div>' +
            '<div><span>Goals</span><strong>' + goalItems.length + '</strong></div>' +
            '<div><span>Notes</span><strong>' + notes.length + '</strong></div>' +
            '<div><span>Items in trash</span><strong>' + trashItems.length + '</strong></div>';
    }

    function feedback(el, ok, msg) {
        if (ok === null) {
            el.innerHTML = '<div class="lock-pending"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
                escapeHTML(msg) + '</div>';
            return;
        }
        const icon = ok ?
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' :
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        el.innerHTML = '<div class="' + (ok ? 'lock-success' : 'lock-warning') + '">' + icon + escapeHTML(msg) +
            '</div>';
    }

    function initLockSettingsUI() {
        $('lockToggle').addEventListener('change', function() {
            if (lockEnabled) {
                this.checked = true;
                $('lockOffForm').style.display = 'flex';
                $('lockOffCurrentPassword').value = '';
                $('lockOffFeedback').innerHTML = '';
                setTimeout(() => $('lockOffCurrentPassword').focus(), 80);
                return;
            }
            if (this.checked) {
                if (saltB64) {
                    this.checked = false;
                    $('lockReenableForm').style.display = 'flex';
                    $('lockReenablePassword').value = '';
                    $('lockReenableFeedback').innerHTML = '';
                    setTimeout(() => $('lockReenablePassword').focus(), 80);
                } else {
                    this.dataset.pendingOn = '1';
                    $('lockSetSection').style.display = 'flex';
                    $('lockSetPassword').value = '';
                    $('lockConfirmPassword').value = '';
                    $('lockPasswordFeedback').innerHTML = '';
                    setTimeout(() => $('lockSetPassword').focus(), 100);
                }
            } else {
                this.dataset.pendingOn = '0';
                $('lockSetSection').style.display = 'none';
            }
        });

        $('cancelLockOffBtn').addEventListener('click', () => { $('lockOffForm').style.display = 'none';
            refreshSettingsView(); });
        $('submitLockOffBtn').addEventListener('click', async function() {
            const pass = $('lockOffCurrentPassword').value;
            const fb = $('lockOffFeedback');
            if (!pass) { feedback(fb, false, 'Please enter your current password.'); return; }
            this.disabled = true;
            try {
                const key = await deriveKey(pass, saltB64);
                const verifierIv = await getMeta('verifierIv', null);
                const verifierCipher = await getMeta('verifierCipher', null);
                const ok = await checkVerifier(key, verifierIv, verifierCipher);
                if (!ok) { feedback(fb, false, 'Current password is incorrect.');
                    this.disabled = false; return; }
                cryptoKey = key;
                encryptionEnabled = false;
                lockEnabled = false;
                await reencryptAllData();
                cryptoKey = null;
                await setMeta('lockEnabled', false);
                await setMeta('encryptionEnabled', false);
                clearAutoLockTimer();
                feedback(fb, true, 'Lock screen turned off. Your password is still saved for next time.');
                showToast('Lock screen turned off');
                $('lockOffForm').style.display = 'none';
                refreshSettingsView();
            } catch (err) {
                console.error(err);
                feedback(fb, false, 'Something went wrong: ' + (err && err.message ? err.message :
                    'unknown error'));
            }
            this.disabled = false;
        });

        $('cancelLockReenableBtn').addEventListener('click', () => { $('lockReenableForm').style.display =
                'none';
            refreshSettingsView(); });
        $('submitLockReenableBtn').addEventListener('click', async function() {
            const pass = $('lockReenablePassword').value;
            const fb = $('lockReenableFeedback');
            if (!pass) { feedback(fb, false, 'Please enter your password.'); return; }
            this.disabled = true;
            try {
                const key = await deriveKey(pass, saltB64);
                const verifierIv = await getMeta('verifierIv', null);
                const verifierCipher = await getMeta('verifierCipher', null);
                const ok = await checkVerifier(key, verifierIv, verifierCipher);
                if (!ok) { feedback(fb, false, 'Incorrect password.');
                    this.disabled = false; return; }
                cryptoKey = key;
                encryptionEnabled = true;
                lockEnabled = true;
                await reencryptAllData();
                await setMeta('lockEnabled', true);
                await setMeta('encryptionEnabled', true);
                feedback(fb, true, 'Lock screen turned back on.');
                showToast('Lock screen turned on');
                $('lockReenableForm').style.display = 'none';
                refreshSettingsView();
            } catch (err) {
                console.error(err);
                feedback(fb, false, 'Something went wrong: ' + (err && err.message ? err.message :
                    'unknown error'));
            }
            this.disabled = false;
        });

        $('lockSavePasswordBtn').addEventListener('click', async function() {
            const pass = $('lockSetPassword').value;
            const confirmPass = $('lockConfirmPassword').value;
            const fb = $('lockPasswordFeedback');
            if (!pass) { feedback(fb, false, 'Please enter a password.'); return; }
            if (pass.length < 4) { feedback(fb, false, 'Password must be at least 4 characters.'); return; }
            if (pass !== confirmPass) { feedback(fb, false, 'Passwords do not match.'); return; }
            this.disabled = true;
            try {
                const newSalt = randomSaltB64();
                const newKey = await deriveKey(pass, newSalt);
                const { iv, cipher } = await makeVerifier(newKey);
                cryptoKey = newKey;
                saltB64 = newSalt;
                encryptionEnabled = true;
                lockEnabled = true;
                syncMode = 'device';
                await reencryptAllData();
                await setMeta('salt', newSalt);
                await setMeta('verifierIv', iv);
                await setMeta('verifierCipher', cipher);
                await setMeta('lockEnabled', true);
                await setMeta('encryptionEnabled', true);
                await setMeta('syncMode', 'device');
                feedback(fb, true, 'Lock screen enabled and your data has been encrypted.');
                showToast('Lock screen enabled');
                $('lockToggle').dataset.pendingOn = '0';
                refreshSettingsView();
                setTimeout(() => showLockScreen(), 500);
            } catch (err) {
                console.error(err);
                feedback(fb, false, 'Could not save settings: ' + (err && err.message ? err.message :
                    'unknown error'));
            } finally {
                this.disabled = false;
            }
        });

        $('cloudRestoreBtn').addEventListener('click', async function() {
            const email = $('cloudRestoreEmail').value.trim();
            const pass = $('cloudRestorePassword').value;
            const fb = $('cloudRestoreFeedback');
            if (!email || !isValidEmail(email)) {
                feedback(fb, false, 'Please enter a valid email address.');
                return;
            }
            if (!pass) { feedback(fb, false, 'Please enter your password.'); return; }
            if (saltB64 || lockEnabled) {
                feedback(fb, false, 'A lock is already set up on this device.');
                return;
            }
            this.disabled = true;
            feedback(fb, null, 'Connecting…');
            try {
                const fbReady = await waitForFirebaseSyncReady();
                if (!fbReady || !window.FirebaseSync.isConfigured()) {
                    feedback(fb, false, 'Cloud sync is not configured yet.');
                    this.disabled = false;
                    return;
                }
                await window.FirebaseSync.signIn(email, pass);

                const remoteMeta = await window.FirebaseSync.pullAllMeta();
                if (!remoteMeta.some(m => m.key === 'salt')) {
    // No existing vault – ask if user wants to create one
    const create = confirm(
        'No existing vault found for this account.\n\n' +
        'Would you like to create a new cloud vault on this device?\n' +
        'If you choose "Cancel", you can still use the app locally without cloud sync.'
    );
    if (!create) {
        feedback(fb, false, 'Cloud sync not enabled.');
        await window.FirebaseSync.signOut();
        this.disabled = false;
        return;
    }
    // Generate a brand new salt and verifier for this account
    const newSalt = randomSaltB64();
    const newKey = await deriveKey(pass, newSalt);
    const { iv, cipher } = await makeVerifier(newKey);
    cryptoKey = newKey;
    saltB64 = newSalt;
    encryptionEnabled = true;
    lockEnabled = true;
    syncMode = 'cloud';
    // Push the new meta to Firebase
    await window.FirebaseSync.pushMeta('salt', newSalt);
    await window.FirebaseSync.pushMeta('verifierIv', iv);
    await window.FirebaseSync.pushMeta('verifierCipher', cipher);
    await window.FirebaseSync.pushMeta('lockEnabled', true);
    await window.FirebaseSync.pushMeta('encryptionEnabled', true);
    await window.FirebaseSync.pushMeta('syncMode', 'cloud');
    // Also re‑encrypt any existing local records (they will be empty)
    await reencryptAllData();
    feedback(fb, true, 'New cloud vault created! Reloading…');
    showToast('Cloud vault created – sign in to continue');
    setTimeout(() => location.reload(), 900);
    return;
}
                // Write remote meta down exactly as-is — no new salt/verifier
                // is generated locally, so the derived key matches the
                // account's original device.
                for (const m of remoteMeta) {
                    await idbPut('meta', { key: m.key, value: m.value });
                }
                await idbPut('meta', { key: 'syncMode', value: 'cloud' });

                const remoteRecords = await window.FirebaseSync.pullAllRecords();
                for (const r of remoteRecords) {
                    await idbPut('records', r);
                }

                feedback(fb, true, 'Vault restored. Reloading…');
                showToast('Cloud data restored — sign in to continue');
                setTimeout(() => location.reload(), 900);
            } catch (err) {
                console.error(err);
                feedback(fb, false, 'Restore failed: ' + (err && err.message ? err.message :
                    'Check your email and password.'));
                this.disabled = false;
            }
        });

        $('openChangePassBtn').addEventListener('click', () => {
            $('changePassForm').style.display = 'flex';
            $('resetLockForm').style.display = 'none';
            $('changeOldPassword').value = '';
            $('changeNewPassword').value = '';
            $('changeConfirmPassword').value = '';
            $('changePassFeedback').innerHTML = '';
            setTimeout(() => $('changeOldPassword').focus(), 80);
        });
        $('cancelChangePassBtn').addEventListener('click', () => { $('changePassForm').style.display =
                'none'; });

        $('submitChangePassBtn').addEventListener('click', async function() {
            const oldPass = $('changeOldPassword').value;
            const newPass = $('changeNewPassword').value;
            const confirmPass = $('changeConfirmPassword').value;
            const fb = $('changePassFeedback');
            if (!oldPass || !newPass) { feedback(fb, false, 'Please fill in all fields.'); return; }
            if (newPass.length < 4) { feedback(fb, false,
                    'New password must be at least 4 characters.'); return; }
            if (newPass !== confirmPass) { feedback(fb, false, 'New passwords do not match.'); return; }
            this.disabled = true;
            try {
                const oldKey = await deriveKey(oldPass, saltB64);
                const verifierIv = await getMeta('verifierIv', null);
                const verifierCipher = await getMeta('verifierCipher', null);
                const ok = await checkVerifier(oldKey, verifierIv, verifierCipher);
                if (!ok) { feedback(fb, false, 'Current password is incorrect.');
                    this.disabled = false; return; }
                const newSalt = randomSaltB64();
                const newKey = await deriveKey(newPass, newSalt);
                const { iv, cipher } = await makeVerifier(newKey);
                cryptoKey = newKey;
                saltB64 = newSalt;
                await reencryptAllData();
                await setMeta('salt', newSalt);
                await setMeta('verifierIv', iv);
                await setMeta('verifierCipher', cipher);
                feedback(fb, true, 'Password updated successfully.');
                showToast('Password changed');
                $('changePassForm').style.display = 'none';
            } catch (err) {
                console.error(err);
                feedback(fb, false, 'Could not update password: ' + (err && err.message ? err.message :
                    'unknown error'));
            } finally {
                this.disabled = false;
            }
        });

        const panicToggle = $('panicLockToggle');
        if (panicToggle) {
            panicToggle.checked = getPref('panicLockEnabled', false);
            panicLockEnabled = panicToggle.checked;
            panicToggle.addEventListener('change', function() {
                panicLockEnabled = this.checked;
                setPref('panicLockEnabled', panicLockEnabled);
                showToast(panicLockEnabled ? 'Panic Lock Mode enabled' : 'Panic Lock Mode disabled');
            });
        }

        $('openResetLockBtn').addEventListener('click', () => {
            $('resetLockForm').style.display = 'flex';
            $('changePassForm').style.display = 'none';
            $('resetCurrentPassword').value = '';
            $('resetLockFeedback').innerHTML = '';
            setTimeout(() => $('resetCurrentPassword').focus(), 80);
        });
        $('cancelResetLockBtn').addEventListener('click', () => { $('resetLockForm').style.display =
                'none'; });

        const cloudSyncBtn = $('cloudSyncNowBtn');
        if (cloudSyncBtn) {
            cloudSyncBtn.addEventListener('click', async function() {
                if (!cryptoKey) { showToast('Unlock the vault first', true); return; }
                if (!window.FirebaseSync || !window.FirebaseSync.isConfigured()) {
                    showToast('Cloud sync is not configured yet', true);
                    return;
                }
                this.disabled = true;
                await performCloudSync(lastUnlockEmail, lastUnlockPassword);
                this.disabled = false;
            });
        }
        updateCloudSyncStatusUI(window.FirebaseSync && window.FirebaseSync.isSignedIn() ? 'synced' : 'idle');

        $('backupDataBtn').addEventListener('click', async function() {
            try {
                const backup = {
                    app: 'Strongbox',
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    data: { vault: vaultItems, goals: goalItems, folders: folders, notes: notes,
                        cards: cardItems, trash: trashItems }
                };
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const stamp = new Date().toISOString().slice(0, 10);
                a.href = url;
                a.download = 'strongbox-backup-' + stamp + '.json';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                showToast('Backup downloaded');
            } catch (err) {
                console.error(err);
                showToast('Backup failed', true);
            }
        });

        $('restoreDataBtn').addEventListener('click', () => { $('restoreFileInput').click(); });

        $('openFactoryResetBtn').addEventListener('click', () => {
            $('factoryResetConfirm').style.display = 'flex';
            $('factoryResetConfirmInput').value = '';
            $('factoryResetFeedback').innerHTML = '';
            setTimeout(() => $('factoryResetConfirmInput').focus(), 80);
        });

        $('cancelFactoryResetBtn').addEventListener('click', () => {
            $('factoryResetConfirm').style.display = 'none';
        });

        $('submitFactoryResetBtn').addEventListener('click', async function() {
            const fb = $('factoryResetFeedback');
            if ($('factoryResetConfirmInput').value.trim() !== 'DELETE') {
                feedback(fb, false, 'Please type DELETE exactly to confirm.');
                return;
            }
            this.disabled = true;
            try {
                const recs = await tx('records', 'readwrite').clear();
                await new Promise((res, rej) => { recs.onsuccess = res;
                    recs.onerror = () => rej(recs.error); });
                const metas = await tx('meta', 'readwrite').clear();
                await new Promise((res, rej) => { metas.onsuccess = res;
                    metas.onerror = () => rej(metas.error); });
                try {
                    Object.keys(localStorage)
                        .filter(k => k.startsWith('sb_'))
                        .forEach(k => localStorage.removeItem(k));
                } catch (e) {}
                showToast('App data erased. Reloading...');
                setTimeout(() => window.location.reload(), 900);
            } catch (err) {
                console.error(err);
                this.disabled = false;
                feedback(fb, false, 'Reset failed: ' + (err && err.message ? err.message :
                    'unknown error'));
            }
        });

        $('restoreFileInput').addEventListener('change', async function() {
            const file = this.files && this.files[0];
            this.value = '';
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const data = parsed && parsed.data ? parsed.data : parsed;
                if (!data || typeof data !== 'object') throw new Error('Invalid backup file');
                if (!confirm(
                        'Restoring will merge this backup into your current data. Continue?'
                        )) return;
                const storeMap = { vault: 'vault', goals: 'goals', folders: 'folders',
                    notes: 'notes', cards: 'cards', trash: 'trash' };
                for (const key in storeMap) {
                    const items = Array.isArray(data[key]) ? data[key] : [];
                    for (const item of items) {
                        if (!item || !item.id) continue;
                        await writeRecord(storeMap[key], item);
                    }
                }
                showToast('Data restored successfully. Reloading...');
                setTimeout(() => window.location.reload(), 900);
            } catch (err) {
                console.error(err);
                showToast('Restore failed: ' + (err && err.message ? err.message : 'invalid file'),
                    true);
            }
        });

        $('submitResetLockBtn').addEventListener('click', async function() {
            const pass = $('resetCurrentPassword').value;
            const fb = $('resetLockFeedback');
            if (!pass) { feedback(fb, false, 'Please enter your current password.'); return; }
            this.disabled = true;
            try {
                const key = await deriveKey(pass, saltB64);
                const verifierIv = await getMeta('verifierIv', null);
                const verifierCipher = await getMeta('verifierCipher', null);
                const ok = await checkVerifier(key, verifierIv, verifierCipher);
                if (!ok) { feedback(fb, false, 'Current password is incorrect.');
                    this.disabled = false; return; }
                if (encryptionEnabled) {
                    cryptoKey = key;
                    await reencryptAllData();
                }
                cryptoKey = null;
                saltB64 = null;
                encryptionEnabled = false;
                lockEnabled = false;
                await setMeta('lockEnabled', false);
                await setMeta('encryptionEnabled', false);
                await idbDelete('meta', 'salt');
                await idbDelete('meta', 'verifierIv');
                await idbDelete('meta', 'verifierCipher');
                clearAutoLockTimer();
                feedback(fb, true, 'Saved password erased. Lock screen is fully reset.');
                showToast('Lock screen reset');
                $('resetLockForm').style.display = 'none';
                refreshSettingsView();
            } catch (err) {
                console.error(err);
                feedback(fb, false, 'Could not reset lock screen: ' + (err && err.message ? err
                    .message : 'unknown error'));
            } finally {
                this.disabled = false;
            }
        });

        $('autoLockSelect').addEventListener('change', async function() {
            autoLockMinutes = parseInt(this.value, 10) || AUTOLOCK_DEFAULT_MIN;
            await setMeta('autoLockMinutes', autoLockMinutes);
            resetAutoLockTimer();
            showToast('Auto-lock timing updated');
        });
    }
    /* ============ END OF SETTINGS ============ */

    /* ============ START OF EVENT LISTENERS ============ */
    function initEventListeners() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });
        $('brandReload').addEventListener('click', async function() {
    const brandEl = this.querySelector('.brand-name');
    const originalText = brandEl.textContent;
    
    try {
        brandEl.textContent = '⟳ Loading...';
        brandEl.style.opacity = '0.6';
        
        // Check if DB is still open
        try {
            await db ? db : await openDB();
        } catch (e) {
            // Re-open DB if closed
            db = await openDB();
        }
        
        // Reload all data
        await loadAllData();
        
        // Re-render everything
        renderEverything();
        refreshSettingsView();
        
        // Update counts
        updateVaultCount();
        
        brandEl.textContent = originalText;
        brandEl.style.opacity = '1';
        
        // Switch to vault tab
        switchTab('vault');
        
        showToast('Reloaded successfully');
    } catch (err) {
        console.error('Reload failed:', err);
        brandEl.textContent = originalText;
        brandEl.style.opacity = '1';
        showToast('Reload failed: ' + (err.message || 'unknown error'), true);
    }
});

        document.querySelectorAll('.vault-mode-toggle .mode-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const mode = this.dataset.mode;
                $('vaultSearch').value = '';
                setVaultMode(mode);
                renderVaultFilterMenu();
                updateVaultCount();
                if (mode === 'passwords') {
                    $('newVaultBtn').onclick = () => openVaultModal(null);
                }
            });
        });
        vaultMode = 'passwords';
        if (true) {
            $('newVaultBtn').onclick = () => openVaultModal(null);
        } else {
            $('newVaultBtn').onclick = () => openCardModal(null);
        }

        $('qrTextInput').addEventListener('input', generateQRCode);

        document.querySelectorAll('#qrFgColors .qr-color-swatch').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('#qrFgColors .qr-color-swatch').forEach(b => b
                    .classList.remove('selected'));
                this.classList.add('selected');
                if (this.dataset.color) {
                    qrFgColor = this.dataset.color;
                    generateQRCode();
                }
            });
        });
        document.querySelectorAll('#qrBgColors .qr-color-swatch').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('#qrBgColors .qr-color-swatch').forEach(b => b
                    .classList.remove('selected'));
                this.classList.add('selected');
                if (this.dataset.color) {
                    qrBgColor = this.dataset.color;
                    generateQRCode();
                }
            });
        });
        $('qrFgCustom').addEventListener('click', function() { $('qrFgColorPicker').click(); });
        $('qrFgColorPicker').addEventListener('input', function() {
            document.querySelectorAll('#qrFgColors .qr-color-swatch').forEach(b => b.classList.remove(
                'selected'));
            $('qrFgCustom').classList.add('selected');
            qrFgColor = this.value;
            $('qrFgCustom').style.background = this.value;
            generateQRCode();
        });
        $('qrBgCustom').addEventListener('click', function() { $('qrBgColorPicker').click(); });
        $('qrBgColorPicker').addEventListener('input', function() {
            document.querySelectorAll('#qrBgColors .qr-color-swatch').forEach(b => b.classList.remove(
                'selected'));
            $('qrBgCustom').classList.add('selected');
            qrBgColor = this.value;
            $('qrBgCustom').style.background = this.value;
            generateQRCode();
        });
        $('qrSize').addEventListener('input', updateQRSize);
        $('qrErrorCorrection').addEventListener('change', function() {
            qrErrorCorrection = this.value;
            generateQRCode();
        });
        // margin slider (if present)
        const marginSlider = $('qrMargin');
        if (marginSlider) {
            marginSlider.addEventListener('input', function() {
                const label = $('qrMarginLabel');
                if (label) label.textContent = this.value;
                generateQRCode();
            });
        }
        $('qrLogoUploadBtn').addEventListener('click', function() { $('qrLogoInput').click(); });
        $('qrLogoInput').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(event) {
                qrLogoData = event.target.result;
                $('qrLogoPreviewImg').src = qrLogoData;
                $('qrLogoPreview').classList.add('visible');
                $('qrLogoClearBtn').disabled = false;
                generateQRCode();
            };
            reader.readAsDataURL(file);
        });
        $('qrLogoClearBtn').addEventListener('click', function() {
            qrLogoData = null;
            $('qrLogoPreview').classList.remove('visible');
            $('qrLogoPreviewImg').src = '';
            $('qrLogoClearBtn').disabled = true;
            $('qrLogoInput').value = '';
            generateQRCode();
        });
        $('qrDownloadPng').addEventListener('click', function() {
            downloadQR('png');
            showToast('QR Code downloaded as PNG');
        });
        $('qrDownloadJpg').addEventListener('click', function() {
            downloadQR('jpg');
            showToast('QR Code downloaded as JPG');
        });
        $('qrDownloadSvg').addEventListener('click', function() {
            downloadQR('svg');
            showToast('QR Code downloaded as SVG');
        });
        updateQRSize();

        $('newVaultBtn').addEventListener('click', function() {
            if (vaultMode === 'passwords') {
                openVaultModal(null);
            } else {
                openCardModal(null);
            }
        });
        $('exportVaultBtn').addEventListener('click', exportVaultCSV);
        $('importVaultBtn').addEventListener('click', () => $('importVaultFile').click());
        $('importVaultFile').addEventListener('change', e => {
            const file = e.target.files && e.target.files[0];
            importVaultCSVFile(file);
            e.target.value = '';
        });

        $('vaultModalClose').addEventListener('click', () => closeModal('vaultModalOverlay'));
        $('vaultModalCancel').addEventListener('click', () => closeModal('vaultModalOverlay'));
        $('vaultModalOverlay').addEventListener('click', e => { if (e.target.id === 'vaultModalOverlay')
                closeModal('vaultModalOverlay'); });
        $('vaultModalSave').addEventListener('click', saveVaultModal);

        $('vaultSearch').addEventListener('input', function() {
            if (vaultMode === 'passwords') {
                renderVault();
            } else {
                renderCards();
            }
            updateVaultCount();
        });

      $('vaultViewToggleBtn').addEventListener('click', () => {
            setVaultCardStyle(vaultCardStyle === 'row' ? 'card' : 'row');
        });
        $('vaultViewToggleLabel').textContent = vaultCardStyle === 'row' ? 'View: Compact' : 'View: Cards';

        $('vaultList').addEventListener('click', e => {
            const card = e.target.closest('.entry-card');
            if (!card) return;
            const id = card.dataset.id;
            if (e.target.closest('.open-link-btn')) {
                const btn = e.target.closest('.open-link-btn');
                const url = btn.dataset.url;
                if (url) {
                    window.open(url, '_blank', 'noopener,noreferrer');
                    showToast('Opening link...');
                }
                return;
            }
            if (e.target.closest('.edit-vault')) openVaultModal(vaultItems.find(i => i.id === id));
            else if (e.target.closest('.delete-vault')) deleteVaultEntry(id);
            else if (e.target.closest('.reveal-btn')) {
                const btn = e.target.closest('.reveal-btn');
                const span = $(btn.dataset.target);
                const real = span.dataset.secret;
                const isMasked = span.dataset.masked !== '0';
                if (isMasked) { span.textContent = real || '(empty)';
                    span.dataset.masked = '0'; } else { span.textContent = '•'.repeat(Math.min(real ?
                        real.length : 8, 14));
                    span.dataset.masked = '1'; }
            } else if (e.target.closest('.copy-btn')) {
                const btn = e.target.closest('.copy-btn');
                copyToClipboard(btn.dataset.copy, 'Copied — clipboard clears in 20s');
            }
        });

        let escPressCount = 0;
        let escPressTimer = null;

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && panicLockEnabled && lockEnabled && !isLocked) {
                escPressCount++;
                if (escPressCount === 1) {
                    escPressTimer = setTimeout(() => {
                        escPressCount = 0;
                        escPressTimer = null;
                    }, 400);
                } else if (escPressCount >= 2) {
                    clearTimeout(escPressTimer);
                    escPressCount = 0;
                    escPressTimer = null;
                    showLockScreen();
                    showToast('App locked via Panic Mode');
                }
            }
        });

        document.getElementById('cardListContainer')?.addEventListener('click', function(e) {
            const item = e.target.closest('.card-item');
            if (!item) return;
            const id = item.dataset.id;
            if (e.target.closest('.edit-card')) {
                const card = cardItems.find(c => c.id === id);
                if (card) openCardModal(card);
            } else if (e.target.closest('.delete-card')) {
                deleteCardEntry(id);
            }
        });

        $('newGoalBtn').addEventListener('click', () => openGoalModal(null));
        $('goalModalClose').addEventListener('click', () => closeModal('goalModalOverlay'));
        $('goalModalCancel').addEventListener('click', () => closeModal('goalModalOverlay'));
        $('goalModalOverlay').addEventListener('click', e => { if (e.target.id === 'goalModalOverlay')
                closeModal('goalModalOverlay'); });
        $('goalModalSave').addEventListener('click', saveGoalModal);

        $('gCategory').addEventListener('change', () => {
            $('newCategoryRow').style.display = $('gCategory').value === '__new__' ? 'flex' :
                'none';
            if ($('gCategory').value === '__new__') $('gNewCategoryInput').focus();
        });
        $('gNewCategoryConfirm').addEventListener('click', confirmNewGoalCategory);
        $('gNewCategoryInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e
                    .preventDefault();
                confirmNewGoalCategory(); } });

        $('goalsFilterBtn').addEventListener('click', e => {
            e.stopPropagation();
            renderGoalFilterMenu();
            $('goalsFilterMenu').classList.toggle('open');
        });
        $('goalsFilterMenu').addEventListener('click', e => {
            const btn = e.target.closest('.filter-menu-item');
            if (!btn) return;
            activeGoalFilter = btn.dataset.filter;
            setPref('goalFilter', activeGoalFilter);
            renderGoalFilterMenu();
            $('goalsFilterMenu').classList.remove('open');
            renderGoals();
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.goal-filter-wrap')) $('goalsFilterMenu').classList.remove(
                'open');
        });
        $('goalsSearch').addEventListener('input', renderGoals);
        $('goalsList').addEventListener('click', e => {
            const card = e.target.closest('.entry-card');
            if (!card) return;
            const id = card.dataset.id;
            if (e.target.closest('.goal-check')) toggleGoalDone(id);
            else if (e.target.closest('.edit-goal')) openGoalModal(goalItems.find(i => i.id === id));
            else if (e.target.closest('.delete-goal')) deleteGoalEntry(id);
        });

        $('vaultFilterBtn').addEventListener('click', e => {
            e.stopPropagation();
            if (vaultMode === 'passwords') {
                renderVaultFilterMenu();
            } else {
                renderCardFilterMenu();
            }
            $('vaultFilterMenu').classList.toggle('open');
        });
        $('vaultFilterMenu').addEventListener('click', e => {
            const btn = e.target.closest('.filter-menu-item');
            if (!btn) return;
            if (vaultMode === 'passwords') {
                activeVaultFilter = btn.dataset.filter;
                setPref('vaultFilter', activeVaultFilter);
                renderVaultFilterMenu();
                renderVault();
            } else {
                activeCardFilter = btn.dataset.filter;
                renderCardFilterMenu();
                renderCards();
            }
            $('vaultFilterMenu').classList.remove('open');
            updateVaultCount();
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.goal-filter-wrap') && !e.target.closest('#vaultFilterBtn') && !
                e.target.closest('#vaultFilterMenu')) {
                $('vaultFilterMenu').classList.remove('open');
            }
        });

        $('vCategory').addEventListener('change', () => {
            $('newVaultCategoryRow').style.display = $('vCategory').value === '__new__' ?
                'flex' : 'none';
            if ($('vCategory').value === '__new__') $('vNewCategoryInput').focus();
        });
        $('vNewCategoryConfirm').addEventListener('click', confirmNewVaultCategory);
        $('vNewCategoryInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e
                    .preventDefault();
                confirmNewVaultCategory(); } });

        $('addFolderBtn').addEventListener('click', () => { addFolder($('newFolderInput').value);
            $('newFolderInput').value = ''; });
        $('newFolderInput').addEventListener('keydown', e => { if (e.key === 'Enter') { addFolder($(
                        'newFolderInput').value);
                    $('newFolderInput').value = ''; } });
        $('addNoteBtn').addEventListener('click', () => { addNote($('newNoteInput').value);
            $('newNoteInput').value = ''; });
        $('newNoteInput').addEventListener('keydown', e => { if (e.key === 'Enter') { addNote($(
                        'newNoteInput').value);
                    $('newNoteInput').value = ''; } });

        $('folderList').addEventListener('click', e => {
            const item = e.target.closest('.folder-item');
            if (!item) return;
            const id = item.dataset.id;
            if (e.target.closest('.rename-folder')) {
                const f = folders.find(x => x.id === id);
                beginInlineRename(item, f.name, (newName) => renameFolder(id, newName));
                return;
            }
            if (e.target.closest('.delete-folder')) { deleteFolderCascade(id); return; }
            selectedFolderId = id;
            selectedNoteId = null;
            renderFolders();
            renderNotes();
            loadNoteIntoEditor();
            if (isMobileWidth()) showMobileNotepadPanel('notes');
        });
        $('noteList').addEventListener('click', e => {
            const item = e.target.closest('.note-item');
            if (!item) return;
            const id = item.dataset.id;
            if (e.target.closest('.rename-note')) {
                const n = notes.find(x => x.id === id);
                beginInlineRename(item, n.title, (newTitle) => renameNote(id, newTitle));
                return;
            }
            if (e.target.closest('.delete-note')) { deleteNoteSingle(id); return; }
            if (selectedNoteId && selectedNoteId !== id) saveCurrentNote();
            selectedNoteId = id;
            renderNotes();
            loadNoteIntoEditor();
            if (isMobileWidth()) showMobileNotepadPanel('editor');
        });

        $('trashList').addEventListener('click', e => {
            const card = e.target.closest('.entry-card');
            if (!card) return;
            const id = card.dataset.id;
            if (e.target.closest('.restore-trash')) {
                restoreFromTrash(id).then(() => {
                    renderTrash();
                    renderVaultMode();
                    renderGoals();
                    renderFolders();
                    renderNotes();
                    buildSearchIndex();
                    updateVaultCount();
                    showToast('Item restored');
                }).catch(() => showToast('Could not restore item', true));
            } else if (e.target.closest('.delete-trash-perm')) {
                permanentlyDeleteTrash(id).then(() => { renderTrash();
                    showToast('Permanently deleted'); });
            }
        });
        $('emptyTrashBtn').addEventListener('click', () => {
            if (trashItems.length === 0) return;
            emptyTrash().then(() => { renderTrash();
                showToast('Trash emptied'); });
        });

document.querySelectorAll('.theme-card').forEach(card => {
            card.addEventListener('click', () => setTheme(card.dataset.theme));
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setTheme(card.dataset.theme);
                }
            });
        });

        $('lockUnlockBtn').addEventListener('click', attemptUnlock);
        $('lockPasswordInput').addEventListener('keydown', e => { if (e.key === 'Enter') attemptUnlock(); });
        $('lockEmailInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('lockPasswordInput')
                .focus(); });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closeModal('vaultModalOverlay');
                closeModal('goalModalOverlay');
                closeModal('cardModalOverlay');
            }
        });

        wireEyeToggles(document);
        initLockSettingsUI();
        initEditorToolbar();

        $('fName').addEventListener('input', function() {
            const urlHint = document.getElementById('urlDetectionHint');
            if (urlHint) {
                const url = extractURL(this.value);
                urlHint.textContent = url ? '✓ URL detected: ' + url : '';
                urlHint.style.color = url ? 'var(--good)' : 'var(--muted)';
            }
        });
    }
    /* ============ END OF EVENT LISTENERS ============ */

    /* ============ START OF BOOT ============ */
    const sessionStart = Date.now();
    const startTime = Date.now();

function initProfileSettings() {
        $('profileChangePicBtn').addEventListener('click', () => $('profilePicInput').click());

        $('profilePicInput').addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showToast('Please choose an image file', true);
                return;
            }
            try {
                profileAvatarDataUrl = await readImageAsDataURL(file);
                renderProfileAvatarPreview();
            } catch (err) {
                showToast('Could not read that image', true);
            }
            e.target.value = '';
        });

        $('profileRemovePicBtn').addEventListener('click', () => {
            profileAvatarDataUrl = null;
            renderProfileAvatarPreview();
        });

        $('profileName').addEventListener('input', renderProfileAvatarPreview);
        $('profileSaveBtn').addEventListener('click', saveProfileSettings);
    }

    async function boot() {
               // Register service worker for offline support + installability
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('./sw.js');
                console.log('Service worker registered:', registration.scope);

                // Case 1: a new SW finished installing while this tab is open
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            promptUpdate(registration);
                        }
                    });
                });

                // Optional: actively ask the browser to check for a new sw.js on load
                registration.update();

                // Case 2: the SW itself detected fresher content (network-first files) and
                // told us via postMessage, even without a whole new sw.js being deployed
                navigator.serviceWorker.addEventListener('message', (event) => {
                    if (event.data && event.data.type === 'SW_UPDATED') {
                        showToast('A new version is available. Refresh to update.');
                    }
                });
            } catch (err) {
                console.warn('Service worker registration failed:', err);
            }
        }

        setTheme(getPref('theme', 'light'));
        initSidebarCollapse();
        initMobileSidebar();
        initMobileNotepadTabs();
        initEventListeners();
        initProfileSettings();
        initPasswordGenerator();

        try {
            db = await openDB();
            lockEnabled = await getMeta('lockEnabled', false);
            encryptionEnabled = await getMeta('encryptionEnabled', false);
            saltB64 = await getMeta('salt', null);
            syncMode = await getMeta('syncMode', 'device');
           autoLockMinutes = await getMeta('autoLockMinutes', AUTOLOCK_DEFAULT_MIN);
            await loadProfileSettings();

            if (!lockEnabled) {
                await loadAllData();
                initGenUsedFromVault();
            }
        } catch (err) {
            console.error('Failed to initialize database:', err);
            showToast('Could not open local database', true);
        }

        const elapsed = Date.now() - startTime;
        const minDelay = 2200;
        const remaining = Math.max(0, minDelay - elapsed);

        setTimeout(() => {
           if (lockEnabled) {
                $('app').classList.add('no-anim');
                $('lockScreen').classList.add('no-anim');
                $('app').classList.add('locked');
                $('lockScreen').classList.add('visible');
                applyLockScreenMode();
                isLocked = true;
                $('lockPasswordInput').value = '';
                $('lockEmailInput').value = '';
                void $('app').offsetWidth;
                $('app').classList.remove('no-anim');
                $('lockScreen').classList.remove('no-anim');
                setTimeout(() => $('lockEmailInput').focus(), 350);
            }

            $('app').classList.add('visible');
            $('splash').classList.add('fade-out');

            if (!lockEnabled) {
                $('app').classList.add('unlocked');
                vaultMode = 'passwords';
                renderEverything();
                refreshSettingsView();
                $('newVaultBtn').onclick = () => openVaultModal(null);
            }

            if (lockEnabled) {
                setTimeout(() => $('lockEmailInput').focus(), 400);
            }
        }, remaining);

        initAutoLockActivity();

        setInterval(() => {
            if (!isLocked) clearExpiredTrash().then(renderTrash).catch(() => {});
        }, 60 * 60 * 1000);

        setInterval(() => {
            if (!isLocked && window.FirebaseSync && window.FirebaseSync.isSignedIn()) {
                mergeCloudData().then(() => loadAllData()).catch(() => {});
            }
        }, 30 * 1000);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !isLocked && window.FirebaseSync && window.FirebaseSync.isSignedIn()) {
                mergeCloudData().then(() => loadAllData()).catch(() => {});
            }
        });
    }

    boot();
    /* ============ END OF BOOT ============ */

})();
