# Provision POS (web app) — Svelte + TypeScript + Dexie (IndexedDB) + ZXing, installable offline PWA

Offline POS, barcode scanner, inventory and reports for one provision store. Currency ₦. No server, no account, no subscription.

## Run / deploy
```
npm install --legacy-peer-deps
npm run dev        # http://localhost:5173 (camera works on localhost)
npm test           # 26 automated tests
npm run build      # outputs dist/
```
Deploy `dist/` to any static host (Vercel: import the repo, framework preset "Vite", build `npm run build`, output `dist`).
**The camera needs HTTPS** (Vercel/Netlify/GitHub Pages provide it). Open the live URL once on the phone with internet, then use
browser menu > "Install app" / "Add to Home screen". After that it works fully offline.

## Using it
Setup (store name) > Products > ＋ (scan or type barcode, cost, price, opening stock) > Sale tab > 📷 Scan (each scan adds 1) or search > Checkout >
Complete sale > receipt (Share / Print). Reports and backups under More.

## Architecture
`src/lib/money.ts` pure maths (integer kobo, quantities in thousandths) · `db.ts` Dexie schema (v1, add `.version(2)` upgrades later) ·
`repo.ts` all business rules, each in one IndexedDB transaction · `stores.ts` router/cart/dialogs · `views/` screens.
A sale (idempotency token, price/active/stock re-check, payment validation, receipt number, stock deduction, movements) commits or rolls back as one unit.
Refunds mark the sale REFUNDED and restore stock; nothing is deleted.

## Verified here (automated, Node + fake IndexedDB)
26 tests pass: money/tax/change/split maths, sale deducts stock, historical price kept, double-submit = one sale, insufficient stock and bad payment roll back,
stale-price rejection, deactivated product, duplicate barcode, validation, stock adjustments, refund, reports + missing-cost gross profit, backup round-trip and invalid-backup rejection.
Type-check (svelte-check) 0 errors; production build and service worker generate successfully.

## NOT verified (needs a real phone/browser)
Camera scanning accuracy, torch (only some phones/browsers), install-to-home-screen, offline reload after install, sharing/printing, file download/restore, UI layout on your phone.

## Limitations
Browser storage can be wiped if you clear site data or the phone is low on space (the app requests persistent storage, but back up regularly). iPhone Safari may clear data of unused sites.
Not implemented: credit sales, partial refunds, PDF receipts, Bluetooth thermal printing (browser Print only), sample-data mode, expiry alerts (date stored only), multi-device sync.
Restore replaces all data. 

## Google Drive backup (optional)
Settings > Google Drive backup. Enter your Drive email + a Google OAuth **Client ID** (Web application; add the site URL under Authorized JavaScript origins; enable the Drive API;
add your email as a Test user). The app uploads to a folder it creates, "Provision POS Backups", using the `drive.file` scope (it can only see files it created). It cannot upload into a
folder you made by hand. Sign-in tokens last about 1 hour and there is no server to refresh them, so the daily upload runs when you tap Start (Google may flash a sign-in window).
Tested only against a simulated Drive API in unit tests; not tested against real Google.

## Cloud sync (Firebase) — several phones, still offline-first

Every phone keeps its own full database and works with no network. Changes are marked automatically and uploaded when a connection exists;
changes from other phones are downloaded and merged. Set it up in **Settings > Cloud sync** (the steps and the Firestore rules are shown there).

Layout: `users/{uid}/{products|sales|movements|settings}/{id}`; every phone signs in to the same email/password account.

Merge rules (`src/lib/sync.ts`): sales and stock movements are added once (by uid); stock is the sum of movements, so two phones selling at once add up;
product details: latest edit wins; a refund wins over "completed" and is applied once even if done on two phones; if two phones register the same barcode
while apart, the older product keeps it. Receipt numbers carry a 3-letter phone code (`POS-K7Q-000012`) so phones never clash.
Known limit: if two phones sell the last unit at the same moment, stock can end at -1 after syncing.
Restoring a backup file is blocked while sync is on (the cloud is the backup); turn sync off first if you really need it.
