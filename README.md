# TGISL Knowledge Hub — v1.4.0

Document management and knowledge platform for Taifa Gas Investment SEZ Limited.
PHP 7.4+ (8.1+ recommended) and MySQL / MariaDB — runs on standard cPanel hosting, no Node, Composer or shell access needed.

---

## 1. Deploy to km.arginternational.ae (cPanel)

**1. Create the subdomain**
cPanel → **Domains** (or *Subdomains*) → Create → `km.arginternational.ae`.
Note its document root, e.g. `/home/CPANELUSER/km.arginternational.ae`.

**2. Create the database**
cPanel → **MySQL® Databases**
- Create database, e.g. `CPANELUSER_km`
- Create user, e.g. `CPANELUSER_kmuser`, with a strong password
- *Add User to Database* → tick **ALL PRIVILEGES**

**3. Upload the files**
cPanel → **File Manager** → open the subdomain's document root → **Upload** `tgisl-km.zip` → right-click → **Extract**.
Make sure `index.php`, `api.php`, `install.php` sit directly in the document root (not in a sub-folder).
Show hidden files (Settings → *Show Hidden Files*) and confirm `.htaccess` and `.user.ini` were extracted.

**4. PHP version and extensions**
cPanel → **Select PHP Version** (or *MultiPHP Manager*) → choose **PHP 8.1 or newer** for the subdomain.
Extensions to enable: `pdo_mysql`, `mbstring`, `zip`, `fileinfo` (normally on by default).
Upload limits: `.user.ini` sets 128 MB per file. If your host ignores it, set `upload_max_filesize` and `post_max_size` in *Select PHP Version → Options* or *MultiPHP INI Editor*.

**5. SSL**
cPanel → **SSL/TLS Status** → run AutoSSL for the subdomain. Then open `.htaccess` and remove the `#` from the two *Force HTTPS* lines.

**6. Run the installer**
Open `https://km.arginternational.ae/install.php` and fill in:
- Database host `localhost`, the database name, user and password from step 2
- **Storage folder** — keep the suggested path *outside* the web root, e.g. `/home/CPANELUSER/km_storage`
- Your administrator account (name, email, password ≥ 10 characters)
- Optionally tick **demo staff and sample documents** to try the platform (demo users can be deactivated later)

**7. Delete `install.php`** from File Manager after the success screen. (It refuses to run again anyway while `app/config.php` exists.)

**8. Sign in** at `https://km.arginternational.ae` and go to **Administration**.

### First-day checklist
1. *Departments* — adjust the 12 pre-created TGISL departments.
2. *People & access* — add staff one by one or **Import CSV** (`name, email, department, role, job title`). Each person gets a temporary password and must set their own at first sign-in.
3. Mark approvers by giving them the **Department head** role.
4. *Libraries & permissions* — review who can read / contribute to each of the 8 starter libraries.
5. *Properties & term store* — refine Plant Area, Discipline, Project Phase, Issue Purpose and Regulator terms and synonyms.
6. *Settings* — set the site address, document-number pattern and (optionally) email notifications.

---

## 1b. Updating an existing installation

**v1.2.x / v1.3.x → v1.4.0:** back up the database, then upload `km-v1.4.0-part1-app.tar.gz` to the site folder → **Extract** (overwrite) → delete the archive → refresh the browser (Ctrl + F5). The database upgrades itself on the first page load: approvals are switched off and anything still waiting for approval is published. The OCR engine files (parts 2–4 of v1.2.0) are unchanged. `.htaccess` now forces HTTPS.

**Older (v1.0 → v1.1):**

1. **Back up first:** cPanel → *Backup* → download a database backup (or phpMyAdmin → Export).
2. File Manager → open the site folder → **Upload** `tgisl-km-v1.1-update.tar.gz` → right-click → **Extract**, tick/confirm **overwrite**.
3. Delete the uploaded archive. `app/config.php` and your storage folder are not touched.
4. Open the site once. The database upgrades itself (adds the two-step fields) — you'll see "Database upgraded to v2" in the audit log.

---

## 2. How it works

### Roles
| Role | Can do |
|---|---|
| **Administrator** | Everything: people, libraries, permissions, term store, settings, audit log |
| **Department head** | Approve and publish documents in libraries they can read (or only their own department's, per library) |
| **Member** | Upload, version, tag and comment where they have Contribute access |
| **Viewer** | Read and download published documents only |

### Permission levels (per library, folder or document)
**Read** · **Contribute** · **Approve** · **Full control** — granted to a person, a department, a group, a role, or everyone.
Folders and documents inherit from their parent unless you untick *Inherit* to give them their own (e.g. a confidential folder). Admin → *Libraries & permissions* has a **Check someone's access** tool that explains exactly why a person can or can't see something.

### Publishing (direct, from v1.4)
- Anyone with **Contribute** access uploads → the document is **published at once** as version 1.0 and readers can see it. A new version (or restoring an old one) publishes straight away as 2.0, 3.0… — every earlier version stays in the history.
- **Published documents can't be deleted** by staff — not by the author, not by department heads, not by people with Full control. Only an **administrator** can delete one (it goes to the recycle bin). Unpublished drafts can still be deleted by their author.
- Older drafts saved before v1.4 show a **Publish now** button for their author.
- The approval workflow below can be switched back on in **Settings → Publishing**. Switching it off again publishes everything still waiting.

### Approval workflow (optional — off by default)
1. Anyone with Contribute uploads → the document is a **draft** (version 0.1), visible only to the author and approvers.
2. *Send for approval* → every eligible department head is notified.
3. A head **approves** → the version becomes **1.0** and is visible to all readers; or **requests changes** with a note.
4. Uploading again (same file name in the same folder, or *New version*) creates **1.1**, while readers keep seeing 1.0 until the next approval publishes **2.0**.

Libraries can switch approval off, and approvers can *Publish now* on their own uploads (logged as self-approval).

### Two-step verification (Google Authenticator)
- Works with **Google Authenticator**, Microsoft Authenticator, Authy or any TOTP app (RFC 6238, 6 digits, 30 seconds).
- **Turn on:** Profile → *Two-step verification* → *Turn on* → scan the QR code → enter the code → save the 10 recovery codes.
- **Policy** (Admin → Settings → Two-step verification): *Optional*, *Required for administrators and department heads*, or *Required for everyone*. People who must use it scan the QR code at their next sign-in. Turn it on for your own account before requiring it.
- **Trust this device** skips the code on that browser for 30 days (adjustable; 0 = always ask).
- **Lost phone:** the person signs in with a recovery code, or an admin opens Admin → People → the person → *Reset two-step*.
- Each code works once; 5 wrong codes lock the account for 15 minutes. Secrets are encrypted with the key in `app/config.php` — keep that file in your backups.
- Server time must be correct (cPanel servers sync automatically). If codes are always rejected, ask the host to check the server clock and check the phone's time is set automatically.
- **Emergency (the only admin lost phone and recovery codes):** phpMyAdmin → SQL:
  `UPDATE users SET mfa_enabled=0, mfa_secret=NULL, mfa_recovery=NULL WHERE email='your@email';`

### Searchable scans (text recognition / OCR)
- Scanned PDFs, pictures pasted into Word, and photos (PNG, JPG, WEBP, GIF, BMP) contain no real text. When one is uploaded, the Hub reads its words automatically **in the uploader's browser** (a small "Making a document searchable" box appears bottom-right; keep the tab open until it finishes — usually a few seconds per page).
- PDFs that mix typed pages and scanned pages keep the typed text and only read the scanned pages.
- Documents that are still unreadable show "Words in this file can't be searched yet" with a **Make it searchable** button (authors, contributors and approvers).
- **Admin → Searchable text** lists every document without searchable text and processes them all with one click — use it once after updating to catch files uploaded earlier.
- On a recognised document, **View recognised text** shows what was read (with search words highlighted); **Read again** repeats it.
- English is installed. Engine files live in `assets/ocr` (about 15 MB, open-source: tesseract.js and PDF.js). Nothing is sent to any outside service.
- Handwriting, signatures, stamps and very poor scans are not read reliably.

### Periodic review
- **Next review date** (optional) says when a document should be checked again — it is not the document's own date. It must be after today; content types with a review cycle fill it in automatically.
- From the day after that date, the author and approvers see "Review overdue" (and "Review due soon" in the 30 days before) with a **Mark as reviewed** button, which records the review in the audit log and sets the next date (or no further review).
- Readers don't see review warnings.

### Classification (enforced from v1.3)
- **Public / Internal** — everyone with access to the library or folder can read it.
- **Confidential** — hidden from read-only staff. Visible to the author, the owning department, approvers (department heads), people with Contribute or higher, and anyone named on the document. Hidden documents don't appear in lists, counts, search, notifications or downloads.
- **Restricted** — only the author, admins and people named on the document (… → Permissions). It stops inheriting library access automatically. Only the author, Full control or an approver can change a document's classification.

### Drawing-office look (v1.3)
- Approved documents carry a round **ink company seal** (approver initials and date) that presses onto the title block the moment you approve; drafts, items in review and returned documents get their own rubber stamps.
- Versions are shown in **revision triangles**, previews sit in a **drawing-sheet frame** with grid references, sensitive previews carry a **watermark** with the reader's name, and the home page opens with a compact strip counting your approvals, drafts, reviews and favourites.
- Colours follow the Taifa Gas logo — charcoal, lime green and flame blue — and the logo appears on the sign-in page and in the sidebar. To use your own, replace `assets/brand/mark.png` (square, 128 × 128) and `assets/brand/logo.jpg` (about 400 × 280).

### Smart features
- **Full-text search** inside PDF (text-based), Word, Excel, PowerPoint, OpenDocument, TXT/CSV — with snippets, highlighting, facets and operators: `type:pdf lib:ENG ct:DWG owner:grace status:pending tag:"Fire Water System" after:2026-01-01 "exact phrase"`
- **Synonym-aware term store** — a search for *bullet* finds documents tagged *Mounded Bullets*
- **Auto-tag suggestions** from the file content, one click to apply
- **Duplicate detection** (SHA-256) across the whole hub, and identical re-uploads are refused
- **Automatic document numbers**, e.g. `TGISL-ENG-DWG-0001` (pattern in Settings)
- **Title block** on every document: number, revision, approval stamp, approver, author
- **Check-out / check-in** locking, version **restore** and text **compare**
- **Review dates** per content type with *Due for review* reminders
- **Similar documents** by shared tags, plus manual **related links**
- **Comments with @mentions**, favourites that notify you of new versions, in-app notifications (optional email)
- **Ctrl + K** command palette, drag-and-drop upload anywhere in a library, bulk ZIP download / move / delete
- **Recycle bin** with retention, **access requests**, **audit log** with CSV export, **analytics** (top searches, untagged documents, overdue reviews, approval time)
- Light / dark mode, works on phones

---

## 3. Maintenance

- **Backups:** back up the database (cPanel → *Backup* or *phpMyAdmin → Export*) **and** the storage folder together.
- **Moving server:** copy files + storage folder + database, then edit `app/config.php` (database details, `storage_path`).
- **Locked-out user:** Admin → People → open the person → *Save* (unlocks) or *Reset password*.
- **Front-end changes:** edit files in `assets/js/`, then rebuild `assets/app.js` by concatenating them in the order listed in `build.sh` (or run `sh build.sh` on any machine).
- **Security:** sign-in locks for 15 minutes after 5 wrong passwords or codes; changing or resetting a password signs that person out everywhere else; check-outs lapse after the hours set in Settings; executable and web-page file types (php, html, js, exe…) can never be uploaded, whatever the allowed list says; HTTPS is forced.
- **Errors:** PHP errors go to the server error log (cPanel → *Errors*). For temporary detail in API responses add `'debug' => true,` to `app/config.php` — remove it afterwards.

## 4. File map
```
index.php        App shell            api.php       JSON API (api.php?r=module.action)
download.php     Permission-checked file streaming, ZIP export
install.php      One-time installer   .htaccess / .user.ini   Security rules, PHP limits
app/             Back end (blocked from the web): bootstrap, permission engine, text extraction, API modules, schema
assets/          app.css, app.js (built from assets/js/*), qrcode.js (QR generator, MIT licence), ocr/ (text-recognition engine), favicon
```
