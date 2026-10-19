# Provision POS (Android, Kotlin, Compose, Room, CameraX + ML Kit)

Offline POS, barcode scanner, inventory and reports for a single provision store. Currency: Naira (₦).

## STATUS: source only, NOT yet compiled or run
This project was written without an Android SDK or access to Google's Maven repository, so it has
**never been compiled, tested or installed**. Expect a few small compile errors on first build; fix them in Android Studio
(or send me the error text). No APK exists yet. A source ZIP is not an installable app.

## Build the APK (needs a Windows/Mac/Linux computer)
1. Install Android Studio (latest stable). It bundles the JDK and offers to install the Android SDK (API 34).
2. File > Open > select the `ProvisionPOS` folder. Let Gradle sync finish (needs internet once, to download libraries).
   Android Studio downloads the Gradle wrapper automatically (`gradle-wrapper.jar` is not included).
3. Build > Build Bundle(s) / APK(s) > Build APK(s). The file is at `app/build/outputs/apk/debug/app-debug.apk`.
4. Copy it to your phone (USB, WhatsApp to self, Google Drive). Open it; allow "Install unknown apps" for the app you opened it from.
5. On first launch, tap Allow when asked for camera access (or Android Settings > Apps > Provision POS > Permissions > Camera).
No computer? Use GitHub Codespaces / Android-capable cloud IDE, or a build service, with this same project.

## Using it
- First launch: enter store name (others optional) > Start.
- Add product: Products > + > scan or type barcode, enter cost, price, opening stock > Save. No barcode? leave empty; an internal code (P00001) is generated.
- Sell: Sale tab > scan icon (continuous; each scan adds 1) or search > Checkout > choose payment (Split payment for mixed) > Complete sale.
- Receipt: shown after sale; Share as text. Find it later in More > Sales history.
- Backup: More > Settings & backup > Export backup (choose where to save). Restore on a new phone: install app, finish setup, Restore backup, pick the file.
- Test a few sales with small items before real use, then refund them (More > Sales history > open sale > Refund).

## Architecture
MVVM. `domain/` (pure money/quantity maths, no Android), `data/` (Room entities, DAOs, `Repository` with all transactions),
`ui/` (Compose screens + one `AppViewModel`). Money = Long kobo; quantities = Long thousandths (supports kg/litres). Settings live in a Room table so they are in backups.
- Sale = one `withTransaction`: idempotency token check, re-read price/active/stock, validate payments, insert sale+items+payments, deduct stock, write movements. Any failure rolls everything back.
- Receipt numbers come from a counter stored in the same transaction (unique after restarts and restores).
- Refunds mark the sale REFUNDED and restore stock via movements; nothing is deleted.

## Implemented
Setup, dashboard, scanner (CameraX + ML Kit, torch, manual entry, permission handling, not-found dialog), products (add/edit/deactivate/search),
stock (adjust, received, damaged, expired, loss, movements, low/out), cart (qty, discount, optional tax), cash/transfer/POS/split payments with change,
text receipts + share, sales history with filters, full refunds, reports (daily/7-day/month/custom, by method/product/category, gross profit with missing-cost warning, CSV export),
optional PIN (salted SHA-256), JSON backup/restore with validation.

## Not implemented / limitations
PDF receipts, Bluetooth thermal printer, credit sales, partial refunds, sample-data mode, dark/light toggle (follows system), barcode label printing, CSV import,
expiry alerts (expiry date is stored only), PDF report export. Restore replaces all data (no merge). Backup file contains the PIN hash. Database is version 1 (no migrations needed yet; add them in `AppDatabase.MIGRATIONS`).
Settings use Room rather than DataStore (so they back up with the data).

## Tests
- `app/src/test/.../CalcTest.kt` (JVM unit tests: money, totals, tax, change, split): **written, not run**.
- `app/src/androidTest/.../SaleRepositoryTest.kt` (Room in-memory: stock deduction, price snapshot, double submit, rollback, duplicate barcode, refund, backup round-trip): **written, not run**.
- Manual on a real phone (all untested): camera permission denial, real scanning, torch, sharing, backup file picker, airplane-mode use.
