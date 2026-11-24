# Our Meals

A tiny shared weekly meal planner for two people, built for phones.

For every lunch and dinner (breakfast optional), each of you marks one of:

| | Plan |
|---|---|
| 🍳 | Cooking at home together |
| 🍽️ | Eating out together |
| 🥪 | On my own, at home |
| 🏃 | On my own, out / at work |
| ✈️ | Skipping / away |

…plus a short note ("tacos", "Sushi place", "leftovers").

The week view shows a status for each meal:

- **Home together** / **Out together**: you both agree.
- **Separate**: you've each got your own plan.
- **Waiting on _name_**: only one of you has answered.
- **Plans don't match**: one of you said "together" and the other didn't.
- **Not planned**.

You can fill in your partner's plan too ("Alex is out Tuesday"). "Together" plans default to applying to both of you, so only one person has to enter them.

No build step and no server code: plain HTML/CSS/JS, plus Firebase Firestore for real-time sync.

---

## 1. Enable sync (one-time, ~10 minutes)

Until you do this the app runs in **demo mode**: it works, but data stays on one phone.

1. Go to <https://console.firebase.google.com> and **Add project** (Google Analytics: off is fine).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Build → Firestore Database → Create database** → pick a nearby location → *Start in production mode*.
4. In Firestore, open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and **Publish**.
5. **Project settings (gear) → General → Your apps → Web (`</>`)**. Register the app (no hosting needed) and copy the `firebaseConfig` values into [`config.js`](config.js).
6. After you deploy (step 2 below), go to **Authentication → Settings → Authorized domains** and add your site's domain (e.g. `yourname.github.io`).

The free (Spark) plan is far more than two people will ever use.

## 2. Put it online

It's just static files. Any static host works:

- **GitHub Pages**: repo **Settings → Pages → Deploy from branch** → pick the branch, `/ (root)`. Pages on a **private** repo needs a paid GitHub plan; otherwise make the repo public (only the code is public, since your meal data lives in Firebase) or use one of the options below.
- **Netlify / Cloudflare Pages / Vercel**: connect the repo, no build command, publish directory `/`.
- **Firebase Hosting**: `npm i -g firebase-tools && firebase init hosting && firebase deploy`.

## 3. Use it

1. Open the site on your phone → **Start a shared plan** → enter both names.
2. Tap **Share invite link** and send it to your partner. They open it and tap "I'm _name_".
3. Each of you: **Add to Home Screen** (Safari: Share → Add to Home Screen; Chrome: ⋮ → Add to Home screen).
   Do this *after* you've joined, because the shortcut remembers your household and who you are.

## Privacy / security model

- Your household lives at an unguessable 22-character ID that's only in your invite link. Anyone with the link can view and edit, so treat it like a shared-album link.
- Firestore rules block listing or deleting households, so nobody can browse other people's plans.
- No accounts or passwords. If you later want real logins, swap anonymous auth for Google sign-in and lock the household to your two user IDs in `firestore.rules`.

## Local development

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

ES modules don't load from `file://`, so you need a local server.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `store.js` | Storage: Firebase when configured, otherwise localStorage demo mode |
| `config.js` | Your Firebase web config |
| `firestore.rules` | Security rules to paste into Firebase |
| `manifest.webmanifest`, `icon.svg` | Home-screen install |
