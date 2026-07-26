# BITCHAT

A production-ready, static messaging web app built with vanilla HTML/CSS/JS
(ES Modules) and Firebase (Authentication + Cloud Firestore only — no
Storage, no Realtime Database, no backend server). Designed to run as-is on
GitHub Pages.

## Project structure

```
BITCHAT/
├── index.html          Redirect gateway (chat.html or login.html)
├── login.html           Email/password + Google login
├── register.html        Email/password + Google sign-up
├── chat.html             Main messaging UI
├── firestore.rules       Security rules for Firestore
├── css/
│   ├── style.css        Shared tokens, reset, toasts, spinner, buttons
│   ├── login.css
│   ├── register.css
│   └── chat.css
├── js/
│   ├── firebase.js      Firebase app/auth/db initialization (single source)
│   ├── auth.js           Register / login / Google / logout / route guards
│   ├── chat.js            Firestore data layer (search, chats, messages)
│   ├── ui.js               DOM/formatting helpers (toasts, avatars, dates)
│   └── app.js             chat.html entry point — wires everything together
└── assets/
    ├── icons/
    └── images/
```

## 1. Firebase Console setup (required before this will work)

Go to https://console.firebase.google.com and open the **messaging-app-8f8e3**
project (the config in `js/firebase.js` already points at it).

### Enable Email/Password authentication
1. **Build → Authentication → Sign-in method**
2. Click **Email/Password**, toggle it **Enabled**, click **Save**.

### Enable Google authentication
1. Same screen: **Build → Authentication → Sign-in method**
2. Click **Google**, toggle it **Enabled**.
3. Set a **Project support email** (required by Google's provider).
4. Click **Save**.

### Add your GitHub Pages domain as an authorized domain
This step is mandatory — without it, Google Sign-In (and email link auth)
will fail with `auth/unauthorized-domain` once the site is live on GitHub
Pages.
1. **Build → Authentication → Settings → Authorized domains**
2. Click **Add domain**.
3. Add: `garrywebworld.github.io`
4. `localhost` is already authorized by default for local testing.

### Enable Cloud Firestore
1. **Build → Firestore Database → Create database**
2. Choose a location close to your users, and start in **production mode**
   (the rules below lock it down properly, so production mode is safe).
3. Once created, go to the **Rules** tab and paste in the contents of
   `firestore.rules` from this project, then click **Publish**.

### Composite indexes (one-time, automatic prompt)
Two queries in this app require composite indexes:
- `chats` filtered by `participants` (array-contains) + ordered by `updatedAt`
- `users` filtered/ordered by `displayName`, and separately by `email`

The **first time** each query runs, the Firestore SDK throws an error in the
browser console containing a direct link like:
`https://console.firebase.google.com/.../firestore/indexes?create_composite=...`

Open that link, click **Create index**, wait a minute or two for it to build,
and the query will start working. This is expected Firestore behavior, not a
bug — indexes cannot be created ahead of time without knowing the exact query
shape, and the console link handles that automatically.

## 2. Deploying to GitHub Pages

1. Push this entire `BITCHAT/` folder to a GitHub repository (e.g.
   `garrywebworld/garrywebworld.github.io`, or any repo with Pages enabled).
2. In the repo, go to **Settings → Pages**, set the source to the branch
   containing these files (root, or `/docs` if you placed it there).
3. Visit `https://garrywebworld.github.io/` (or your repo's Pages URL).
4. Confirm that URL exactly matches what you added under **Authorized
   domains** in step above — subdomain and path matter for `auth/unauthorized-domain`.

No build step, bundler, or Node.js server is required — every file is static
and every script is loaded as an ES Module directly by the browser.

## 3. How the pieces fit together

- **`js/firebase.js`** initializes exactly one Firebase App/Auth/Firestore
  instance and is imported by every other module — there is never a second
  `initializeApp()` call anywhere in the project.
- **`js/auth.js`** owns all authentication logic and exposes two route
  guards: `redirectIfAuthenticated()` (used by login/register — bounces
  logged-in users to `chat.html`) and `requireAuth()` (used by chat.html —
  bounces logged-out users to `login.html`).
- **`js/chat.js`** owns all Firestore reads/writes for chats and messages:
  creating a deterministic 1:1 chat id, live conversation/message listeners,
  sending messages, and batching read-receipt updates.
- **`js/ui.js`** has no Firebase imports at all — it's pure DOM/formatting
  helpers reused by every page (toasts, spinners, avatar initials, date/time
  formatting).
- **`js/app.js`** is only loaded by `chat.html` and is the "controller" that
  wires `auth.js` + `chat.js` output into the DOM defined in `chat.html`.

## 4. Data model

```
users/{uid}
  uid, displayName, email, photoURL, online, lastSeen, createdAt

chats/{chatId}                 // chatId = sorted "uidA_uidB"
  chatId, participants: [uidA, uidB], lastMessage: {text, senderId, timestamp, seen}, updatedAt

chats/{chatId}/messages/{messageId}
  senderId, text, timestamp, seen
```

## 5. Error handling philosophy

Every `catch` block in this project surfaces the real Firebase/Firestore
error code and message (via `friendlyAuthError()` / `friendlyFirestoreError()`
in `js/auth.js`), reworded for a normal user to read — never a generic
"Something went wrong." All Firebase operations also `console.info` /
`console.error` their key steps so the browser DevTools console gives a full
trace of what happened during registration, login, chat creation, and
message sending.
