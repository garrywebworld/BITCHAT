// ============================================================================
// auth.js
// All Firebase Authentication logic: email/password register + login,
// Google popup sign-in, logout, session/auto-login handling, and route
// guards for the three pages (login, register, chat).
// ============================================================================

import { auth, db, googleProvider } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// ----------------------------------------------------------------------------
// Firebase error → human-readable message.
// Requirement: never show a generic "Something went wrong" — always surface
// the real Firebase error code/message, worded for a normal user to read.
// ----------------------------------------------------------------------------
export function friendlyAuthError(err) {
  const code = err?.code || "unknown";
  const map = {
    "auth/email-already-in-use": "That email address is already registered. Try logging in instead.",
    "auth/invalid-email": "That email address is not valid. Please check it and try again.",
    "auth/weak-password": "That password is too weak. Firebase requires at least 6 characters.",
    "auth/missing-password": "Please enter a password.",
    "auth/user-not-found": "No account exists with that email address.",
    "auth/wrong-password": "That password is incorrect. Please try again.",
    "auth/invalid-credential": "The email or password you entered is incorrect.",
    "auth/invalid-login-credentials": "The email or password you entered is incorrect.",
    "auth/too-many-requests": "Too many failed attempts. Please wait a moment before trying again.",
    "auth/popup-closed-by-user": "The Google sign-in popup was closed before completing sign-in.",
    "auth/cancelled-popup-request": "Another sign-in popup was already open. Please try again.",
    "auth/popup-blocked": "Your browser blocked the sign-in popup. Please allow popups for this site.",
    "auth/unauthorized-domain": "This domain is not authorized for sign-in. Add it under Firebase Authentication → Settings → Authorized domains.",
    "auth/network-request-failed": "Network error — please check your internet connection and try again.",
    "auth/user-disabled": "This account has been disabled. Contact support for help.",
    "auth/requires-recent-login": "Please log in again to complete this action.",
  };
  if (map[code]) return map[code];
  // Fallback: still show the *actual* Firebase error, never a vague message.
  return `Firebase error (${code}): ${err?.message || "no additional details were provided."}`;
}

/** Maps Firestore error codes to readable text, per the same "no generic errors" rule. */
export function friendlyFirestoreError(err) {
  const code = err?.code || "unknown";
  const map = {
    "permission-denied": "Permission denied by Firestore security rules. Check that you are logged in and the rules allow this action.",
    unavailable: "Firestore is temporarily unavailable — you may be offline. Reconnect and try again.",
    unauthenticated: "You must be logged in to perform this action.",
    "not-found": "The requested document does not exist.",
  };
  if (map[code]) return map[code];
  return `Firestore error (${code}): ${err?.message || "no additional details were provided."}`;
}

// ----------------------------------------------------------------------------
// Firestore user-profile helpers
// ----------------------------------------------------------------------------

/** Creates (or refreshes presence on) the users/{uid} document. */
async function upsertUserProfile(user, extra = {}) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    console.info("[auth.js] Creating new user profile for", user.uid);
    await setDoc(userRef, {
      uid: user.uid,
      displayName: user.displayName || extra.displayName || "New User",
      email: user.email,
      photoURL: user.photoURL || "",
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  } else {
    console.info("[auth.js] Existing user profile found for", user.uid, "— updating presence");
    await updateDoc(userRef, {
      online: true,
      lastSeen: serverTimestamp(),
      ...(user.photoURL ? { photoURL: user.photoURL } : {}),
    });
  }
}

/** Marks the current user offline (used on logout and tab close). */
async function markOffline(uid) {
  try {
    await updateDoc(doc(db, "users", uid), {
      online: false,
      lastSeen: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[auth.js] Failed to mark user offline:", err);
  }
}

// ----------------------------------------------------------------------------
// Public API — Register / Login / Google / Logout / Reset
// ----------------------------------------------------------------------------

/**
 * Registers a new user with email + password, sets their display name, and
 * creates their Firestore profile document.
 */
export async function registerUser({ username, email, password }) {
  console.info("[auth.js] Attempting registration for", email);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: username });
  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    displayName: username,
    email: cred.user.email,
    photoURL: "",
    online: true,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  console.info("[auth.js] Registration successful for", cred.user.uid);
  return cred.user;
}

/** Logs in an existing user with email + password. */
export async function loginUser({ email, password }) {
  console.info("[auth.js] Attempting login for", email);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await upsertUserProfile(cred.user);
  console.info("[auth.js] Login successful for", cred.user.uid);
  return cred.user;
}

/**
 * Signs in with Google via a popup. Creates the Firestore profile document on
 * first sign-in only; on subsequent sign-ins it just refreshes presence.
 */
export async function loginWithGoogle() {
  console.info("[auth.js] Attempting Google sign-in popup");
  const cred = await signInWithPopup(auth, googleProvider);
  await upsertUserProfile(cred.user);
  console.info("[auth.js] Google sign-in successful for", cred.user.uid);
  return cred.user;
}

/** Sends a password-reset email. */
export async function resetPassword(email) {
  console.info("[auth.js] Sending password reset email to", email);
  await sendPasswordResetEmail(auth, email);
}

/** Marks the user offline, signs them out, and redirects to login.html. */
export async function logoutUser() {
  const uid = auth.currentUser?.uid;
  console.info("[auth.js] Logging out user", uid);
  if (uid) await markOffline(uid);
  await signOut(auth);
  window.location.href = "login.html";
}

// ----------------------------------------------------------------------------
// Route guards — call one of these at the top of each page's script.
// ----------------------------------------------------------------------------

/**
 * For login.html / register.html:
 * If a user is already authenticated, redirect straight to chat.html.
 * Otherwise, invoke the callback so the page can hide its loading state.
 */
export function redirectIfAuthenticated(onUnauthenticated) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      console.info("[auth.js] Already authenticated, redirecting to chat.html");
      window.location.href = "chat.html";
    } else {
      onUnauthenticated?.();
    }
  });
}

/**
 * For chat.html:
 * If no user is authenticated, redirect back to login.html. Otherwise,
 * invoke the callback with the authenticated user.
 */
export function requireAuth(onAuthenticated) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      console.info("[auth.js] Not authenticated, redirecting to login.html");
      window.location.href = "login.html";
    } else {
      onAuthenticated(user);
    }
  });
}

/** Registers a best-effort "mark offline" call when the tab/window closes. */
export function attachOfflineOnUnload() {
  window.addEventListener("beforeunload", () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // Fire-and-forget; the browser may not wait for this to finish.
    updateDoc(doc(db, "users", uid), { online: false, lastSeen: serverTimestamp() }).catch(() => {});
  });
}
