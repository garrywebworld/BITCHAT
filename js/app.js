// ============================================================================
// app.js
// Entry point for chat.html. Wires together auth.js, chat.js, and ui.js:
// guards the route, renders the sidebar/conversation list, and drives the
// active conversation (messages, sending, read receipts, presence).
// ============================================================================

import { auth } from "./firebase.js";
import { requireAuth, logoutUser, attachOfflineOnUnload } from "./auth.js";
import {
  searchUsers,
  getOrCreateChat,
  listenToUserChats,
  getUserProfile,
  listenToUserProfile,
  listenToMessages,
  sendMessage,
  markMessagesSeen,
} from "./chat.js";
import {
  $,
  escapeHtml,
  initialsOf,
  formatTime,
  formatDay,
  formatLastSeen,
  tsToDate,
  showToast,
  setPageLoading,
  debounce,
} from "./ui.js";

// ----------------------------------------------------------------------------
// Module-level state
// ----------------------------------------------------------------------------
let currentUser = null;          // { uid, displayName, email }
let activeChatId = null;
let activePartnerUid = null;
let activePartnerProfile = null; // live-updated via listenToUserProfile

let chatsCache = [];              // latest snapshot of the user's chats
let partnerProfileCache = new Map(); // uid -> profile, for rendering the list

let unsubChats = null;
let unsubMessages = null;
let unsubPartner = null;

// ----------------------------------------------------------------------------
// Boot sequence
// ----------------------------------------------------------------------------
requireAuth(async (user) => {
  currentUser = { uid: user.uid, displayName: user.displayName, email: user.email };

  const profile = await getUserProfile(user.uid);
  if (profile?.displayName) currentUser.displayName = profile.displayName;

  $("me-name").textContent = currentUser.displayName || "User";
  $("me-avatar").innerHTML = initialsOf(currentUser.displayName);

  attachOfflineOnUnload();
  wireStaticEventListeners();

  unsubChats = listenToUserChats(
    currentUser.uid,
    onChatsUpdated,
    (err) => showToast(`Could not load conversations — ${err.message}`, "error")
  );

  setPageLoading(false);
  console.info("[app.js] Chat app initialized for", currentUser.uid);
});

// ----------------------------------------------------------------------------
// Static (one-time) event listener wiring
// ----------------------------------------------------------------------------
function wireStaticEventListeners() {
  $("logout-btn").addEventListener("click", async () => {
    try {
      await logoutUser();
    } catch (err) {
      console.error("[app.js] Logout failed:", err);
      showToast(`Logout failed — ${err.message}`, "error");
    }
  });

  $("search-input").addEventListener("input", debounce(handleSearchInput, 250));

  $("send-btn").addEventListener("click", handleSendMessage);
  $("message-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  $("message-input").addEventListener("input", (e) => {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  });

  $("back-btn").addEventListener("click", () => {
    $("app-shell").classList.remove("chat-open");
  });

  // Basic offline/online banner using the browser's connectivity events.
  window.addEventListener("offline", () => showToast("You are offline. Messages will send once reconnected.", "error"));
  window.addEventListener("online", () => showToast("Back online.", "success"));
}

// ----------------------------------------------------------------------------
// Conversation list
// ----------------------------------------------------------------------------
async function onChatsUpdated(chats) {
  chatsCache = chats;
  await hydratePartnerProfiles(chats);
  renderConversationList($("search-input").value.trim());
}

async function hydratePartnerProfiles(chats) {
  const missing = [];
  chats.forEach((chat) => {
    const partnerUid = chat.participants.find((id) => id !== currentUser.uid);
    if (partnerUid && !partnerProfileCache.has(partnerUid)) missing.push(partnerUid);
  });
  await Promise.all(
    missing.map(async (uid) => {
      const profile = await getUserProfile(uid);
      if (profile) partnerProfileCache.set(uid, profile);
    })
  );
}

function renderConversationList(filterTerm = "") {
  const listEl = $("conversation-list");
  const lowerFilter = filterTerm.toLowerCase();

  const rows = chatsCache
    .map((chat) => {
      const partnerUid = chat.participants.find((id) => id !== currentUser.uid);
      const partner = partnerProfileCache.get(partnerUid) || { displayName: "Unknown user" };
      return { chat, partnerUid, partner };
    })
    .filter(({ partner }) => !lowerFilter || partner.displayName?.toLowerCase().includes(lowerFilter));

  if (chatsCache.length === 0) {
    listEl.innerHTML = `<div class="empty-hint">No conversations yet.<br />Search for someone above to start chatting.</div>`;
    return;
  }
  if (rows.length === 0) {
    listEl.innerHTML = `<div class="empty-hint">No conversations match "${escapeHtml(filterTerm)}".</div>`;
    return;
  }

  listEl.innerHTML = rows
    .map(({ chat, partnerUid, partner }) => {
      const isActive = chat.id === activeChatId;
      const last = chat.lastMessage || {};
      const preview = last.text ? (last.senderId === currentUser.uid ? `You: ${last.text}` : last.text) : "Say hello 👋";
      const time = tsToDate(chat.updatedAt);
      const showUnread = last.senderId && last.senderId !== currentUser.uid && last.seen === false;
      return `
        <div class="conv-item ${isActive ? "active" : ""}" data-chat-id="${chat.id}" data-partner-uid="${partnerUid}">
          <div class="avatar">
            ${initialsOf(partner.displayName)}
            <span class="status-dot ${partner.online ? "online" : ""}"></span>
          </div>
          <div class="conv-body">
            <div class="conv-row">
              <span class="conv-name">${escapeHtml(partner.displayName)}</span>
              <span class="conv-time">${time ? formatTime(time) : ""}</span>
            </div>
            <div class="conv-row">
              <span class="conv-preview">${escapeHtml(preview)}</span>
              ${showUnread ? `<span class="unread-dot"></span>` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".conv-item").forEach((el) => {
    el.addEventListener("click", () => openChat(el.dataset.chatId, el.dataset.partnerUid));
  });
}

// ----------------------------------------------------------------------------
// User search (to start new conversations)
// ----------------------------------------------------------------------------
async function handleSearchInput(e) {
  const term = e.target.value.trim();
  renderConversationList(term);

  if (!term) {
    $("user-results").innerHTML = "";
    return;
  }
  try {
    const users = await searchUsers(term, currentUser.uid);
    renderUserResults(users);
  } catch (err) {
    console.error("[app.js] searchUsers failed:", err);
    // Composite-index errors surface here on first run — show the real message.
    showToast(`Search failed — ${err.message}`, "error");
  }
}

function renderUserResults(users) {
  const box = $("user-results");
  if (users.length === 0) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = users
    .map(
      (u) => `
      <div class="user-result">
        <div class="avatar sm">${initialsOf(u.displayName)}</div>
        <div class="user-meta">
          <div class="user-name">${escapeHtml(u.displayName)}</div>
          <div class="user-email">${escapeHtml(u.email)}</div>
        </div>
        <button class="start-chat-btn" data-uid="${u.uid}">Message</button>
      </div>
    `
    )
    .join("");

  box.querySelectorAll(".start-chat-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.uid;
      try {
        const chatId = await getOrCreateChat(currentUser.uid, uid);
        $("search-input").value = "";
        $("user-results").innerHTML = "";
        await openChat(chatId, uid);
      } catch (err) {
        console.error("[app.js] getOrCreateChat failed:", err);
        showToast(`Could not start chat — ${err.message}`, "error");
      }
    });
  });
}

// ----------------------------------------------------------------------------
// Active chat
// ----------------------------------------------------------------------------
async function openChat(chatId, partnerUid) {
  if (activeChatId === chatId) {
    $("app-shell").classList.add("chat-open");
    return;
  }

  unsubMessages?.();
  unsubPartner?.();

  activeChatId = chatId;
  activePartnerUid = partnerUid;

  $("chat-placeholder").classList.add("hidden");
  $("chat-active").classList.remove("hidden");
  $("app-shell").classList.add("chat-open");

  unsubPartner = listenToUserProfile(partnerUid, (profile) => {
    activePartnerProfile = profile;
    renderChatHeader();
  });

  unsubMessages = listenToMessages(
    chatId,
    (messages) => {
      renderMessages(messages);
      markMessagesSeen(chatId, currentUser.uid, messages).catch((err) =>
        console.warn("[app.js] markMessagesSeen failed:", err)
      );
    },
    (err) => showToast(`Could not load messages — ${err.message}`, "error")
  );

  renderConversationList($("search-input").value.trim());
}

function renderChatHeader() {
  if (!activePartnerProfile) return;
  $("chat-header-avatar").innerHTML = initialsOf(activePartnerProfile.displayName);
  $("chat-header-name").textContent = activePartnerProfile.displayName || "Unknown user";

  const statusEl = $("chat-header-status");
  if (activePartnerProfile.online) {
    statusEl.textContent = "Online";
    statusEl.className = "chat-header-status online";
  } else {
    statusEl.textContent = formatLastSeen(tsToDate(activePartnerProfile.lastSeen));
    statusEl.className = "chat-header-status";
  }
}

function renderMessages(messages) {
  const container = $("messages");
  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 140;

  let html = "";
  let lastDayLabel = null;

  messages.forEach((m) => {
    const date = tsToDate(m.timestamp) || new Date();
    const dayLabel = formatDay(date);
    if (dayLabel !== lastDayLabel) {
      html += `<div class="day-divider"><span>${dayLabel}</span></div>`;
      lastDayLabel = dayLabel;
    }
    const isMine = m.senderId === currentUser.uid;
    html += `
      <div class="msg-row ${isMine ? "mine" : ""}">
        <div class="msg-bubble">
          <div class="msg-text">${escapeHtml(m.text)}</div>
          <div class="msg-meta">
            <span class="msg-time">${formatTime(date)}</span>
            ${isMine ? `<span class="msg-ticks ${m.seen ? "seen" : ""}">${m.seen ? "✓✓" : "✓"}</span>` : ""}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html || `<div class="empty-hint">No messages yet. Say hello!</div>`;
  if (wasNearBottom) container.scrollTop = container.scrollHeight;
}

// ----------------------------------------------------------------------------
// Sending messages
// ----------------------------------------------------------------------------
async function handleSendMessage() {
  const input = $("message-input");
  const text = input.value.trim();
  if (!text || !activeChatId) return;

  input.value = "";
  input.style.height = "auto";

  try {
    await sendMessage(activeChatId, currentUser.uid, text);
  } catch (err) {
    console.error("[app.js] sendMessage failed:", err);
    showToast(`Message failed to send — ${err.message}`, "error");
    input.value = text; // restore so the user doesn't lose what they typed
  }
}
