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
Refunds mark the sale REFUNDED and restore stock; nothing is deleted. Optional PIN is salted SHA-256.

## Verified here (automated, Node + fake IndexedDB)
26 tests pass: money/tax/change/split maths, sale deducts stock, historical price kept, double-submit = one sale, insufficient stock and bad payment roll back,
stale-price rejection, deactivated product, duplicate barcode, validation, stock adjustments, refund, reports + missing-cost gross profit, PIN, backup round-trip and invalid-backup rejection.
Type-check (svelte-check) 0 errors; production build and service worker generate successfully.

## NOT verified (needs a real phone/browser)
Camera scanning accuracy, torch (only some phones/browsers), install-to-home-screen, offline reload after install, sharing/printing, file download/restore, UI layout on your phone.

## Limitations
Browser storage can be wiped if you clear site data or the phone is low on space (the app requests persistent storage, but back up regularly). iPhone Safari may clear data of unused sites.
Not implemented: credit sales, partial refunds, PDF receipts, Bluetooth thermal printing (browser Print only), sample-data mode, expiry alerts (date stored only), multi-device sync.
Restore replaces all data. Backup file includes the PIN hash.
