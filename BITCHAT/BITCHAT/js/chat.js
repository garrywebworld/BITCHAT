// ============================================================================
// chat.js
// All Cloud Firestore logic for messaging: searching users, creating/opening
// 1:1 chats, listening to conversations and messages in real time, sending
// messages, and marking messages as seen (read receipts).
// ============================================================================

import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/**
 * Deterministic chat id for a pair of uids — sorting means the same two
 * users always resolve to the same chat document, so opening a chat with
 * someone twice never creates a duplicate.
 */
export function chatIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

/**
 * Searches the users collection for people whose displayName or email starts
 * with `term`. Firestore has no native substring search, so this uses the
 * standard range-query prefix-match trick on both fields and merges results.
 */
export async function searchUsers(term, excludeUid) {
  const usersRef = collection(db, "users");
  const lowerTerm = term.toLowerCase();

  const nameQuery = query(
    usersRef,
    orderBy("displayName"),
    where("displayName", ">=", term),
    where("displayName", "<=", term + "\uf8ff"),
    limit(10)
  );
  const emailQuery = query(
    usersRef,
    orderBy("email"),
    where("email", ">=", lowerTerm),
    where("email", "<=", lowerTerm + "\uf8ff"),
    limit(10)
  );

  const [nameSnap, emailSnap] = await Promise.all([getDocs(nameQuery), getDocs(emailQuery)]);

  const results = new Map();
  [...nameSnap.docs, ...emailSnap.docs].forEach((d) => {
    if (d.id !== excludeUid) results.set(d.id, d.data());
  });
  return [...results.values()];
}

/**
 * Ensures a chat document exists between two users (creating it if this is
 * their first conversation) and returns its chatId.
 */
export async function getOrCreateChat(myUid, partnerUid) {
  const chatId = chatIdFor(myUid, partnerUid);
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) {
    console.info("[chat.js] Creating new chat document:", chatId);
    await setDoc(chatRef, {
      chatId,
      participants: [myUid, partnerUid],
      lastMessage: { text: "", senderId: "", timestamp: serverTimestamp(), seen: true },
      updatedAt: serverTimestamp(),
    });
  }
  return chatId;
}

/**
 * Subscribes to every chat the given user participates in, ordered by most
 * recently updated. Calls `callback` with the array of {id, ...data} chat
 * documents on every change. Returns an unsubscribe function.
 */
export function listenToUserChats(uid, callback, onError) {
  const chatsRef = collection(db, "chats");
  const q = query(chatsRef, where("participants", "array-contains", uid), orderBy("updatedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("[chat.js] listenToUserChats error:", err);
      onError?.(err);
    }
  );
}

/** Fetches a single user profile document by uid. */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Subscribes to live changes on a single user document (used to track a
 * chat partner's online/lastSeen status in real time). Returns an unsubscribe fn.
 */
export function listenToUserProfile(uid, callback) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}

/**
 * Subscribes to the messages subcollection of a chat, ordered oldest-first.
 * Returns an unsubscribe function.
 */
export function listenToMessages(chatId, callback, onError) {
  const messagesRef = collection(db, "chats", chatId, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("[chat.js] listenToMessages error:", err);
      onError?.(err);
    }
  );
}

/** Sends a new message in a chat and updates the chat's lastMessage/updatedAt. */
export async function sendMessage(chatId, senderId, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const messagesRef = collection(db, "chats", chatId, "messages");
  await addDoc(messagesRef, {
    senderId,
    text: trimmed,
    timestamp: serverTimestamp(),
    seen: false,
  });
  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: { text: trimmed, senderId, timestamp: serverTimestamp(), seen: false },
    updatedAt: serverTimestamp(),
  });
  console.info("[chat.js] Message sent in chat", chatId);
}

/**
 * Marks all messages NOT sent by `myUid` as seen (read receipts). Uses a
 * batched write so many unseen messages are updated in a single round trip.
 */
export async function markMessagesSeen(chatId, myUid, messageDocs) {
  const unseen = messageDocs.filter((m) => m.senderId !== myUid && m.seen !== true);
  if (unseen.length === 0) return;
  const batch = writeBatch(db);
  unseen.forEach((m) => {
    batch.update(doc(db, "chats", chatId, "messages", m.id), { seen: true });
  });
  await batch.commit();
  console.info("[chat.js] Marked", unseen.length, "message(s) as seen in chat", chatId);
}
