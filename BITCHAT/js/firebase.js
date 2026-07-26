// ============================================================================
// firebase.js
// Central Firebase bootstrap. Every other module imports `auth`, `db`,
// `googleProvider`, and the re-exported SDK functions from this one file so
// there is exactly one initialized App/Auth/Firestore instance in the whole
// project.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// ----------------------------------------------------------------------------
// Project configuration — this is the real config for the messaging-app-8f8e3
// Firebase project. Do not replace with placeholders.
// ----------------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: "AIzaSyDMXOgX_VjlnTHL0IcaYycb4U2bv_f-XmE",
  authDomain: "messaging-app-8f8e3.firebaseapp.com",
  projectId: "messaging-app-8f8e3",
  storageBucket: "messaging-app-8f8e3.firebasestorage.app",
  messagingSenderId: "765445028206",
  appId: "1:765445028206:web:06b48ff752011d39c4297f",
  measurementId: "G-7RT367JN5J",
};

let app;
try {
  app = initializeApp(firebaseConfig);
  console.info("[firebase.js] Firebase app initialized:", app.name);
} catch (err) {
  // Firebase init failures are almost always a bad config object — surface
  // the exact error instead of failing silently, per project requirements.
  console.error("[firebase.js] FIREBASE INITIALIZATION FAILED:", err);
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML =
      `<div style="font-family:monospace;color:#ff5c72;background:#0b0d12;` +
      `height:100vh;display:flex;align-items:center;justify-content:center;` +
      `padding:24px;text-align:center;">` +
      `Firebase failed to initialize:<br/><br/>${err.message}</div>`;
  });
  throw err;
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Keep the user logged in across tabs/refreshes/browser restarts.
setPersistence(auth, browserLocalPersistence)
  .then(() => console.info("[firebase.js] Auth persistence set to LOCAL"))
  .catch((err) => console.error("[firebase.js] Failed to set persistence:", err));

// Enable offline Firestore cache so the UI degrades gracefully when offline.
enableIndexedDbPersistence(db).catch((err) => {
  // Multiple tabs open, or an unsupported browser — not fatal, just log it.
  console.warn("[firebase.js] Firestore offline persistence not enabled:", err.code);
});

export default app;
