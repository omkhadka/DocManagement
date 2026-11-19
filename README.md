# TGISL Knowledge Hub — v1.7.0

Document management and knowledge platform for Taifa Gas Investment SEZ Limited.
PHP 7.4+ (8.1+ recommended) and MySQL / MariaDB — runs on standard cPanel hosting, no Node, Composer or shell access needed.

---

## 1. Deploy to km.taifagaskenya.co.ke (cPanel)

**1. Create the subdomain**
cPanel → **Domains** (or *Subdomains*) → Create → `km.taifagaskenya.co.ke`.
Note its document root, e.g. `/home/CPANELUSER/km.taifagaskenya.co.ke`.

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
Open `https://km.taifagaskenya.co.ke/install.php` and fill in:
- Database host `localhost`, the database name, user and password from step 2
- **Storage folder** — keep the suggested path *outside* the web root, e.g. `/home/CPANELUSER/km_storage`
- Your administrator account (name, email, password ≥ 10 characters)
- Optionally tick **demo staff and sample documents** to try the platform (demo users can be deactivated later)

**7. Delete `install.php`** from File Manager after the success screen. (It refuses to run again anyway while `app/config.php` exists.)

**8. Sign in** at `https://km.taifagaskenya.co.ke` and go to **Administration**.

### First-day checklist
1. *Departments* — adjust the 12 pre-created TGISL departments.
2. *People & access* — add staff one by one or **Import CSV** (`name, email, department, role, job title`). Each person gets a temporary password and must set their own at first sign-in.
3. Mark approvers by giving them the **Department head** role.
4. *Libraries & permissions* — review who can read / contribute to each of the 8 starter libraries.
5. *Properties & term store* — refine Plant Area, Discipline, Project Phase, Issue Purpose and Regulator terms and synonyms.
6. *Settings* — set the site address, document-number pattern and (optionally) email notifications.

---

## 1b. Updating an existing installation

**v1.4.x – v1.6.x → v1.7.0 (Toto, knowledge map, requests for input):** back up the database, then upload `km-v1.7.0-part1-app.tar.gz` to the site folder → **Extract** (overwrite) → delete the archive → refresh the browser (Ctrl + F5). The database upgrades itself to v9 on the first page load (adds Toto's tables). Then go to **Admin → Settings → Toto → Rebuild Toto's index** once, so Toto reads the documents uploaded before it existed. Nothing else to install: Toto is plain PHP.

**v1.2.x / v1.3.x / v1.4.0 → v1.4.1:** back up the database, then upload `km-v1.4.1-part1-app.tar.gz` to the site folder → **Extract** (overwrite) → delete the archive → refresh the browser (Ctrl + F5). The database upgrades itself on the first page load: approvals are switched off and anything still waiting for approval is published. The OCR engine files (parts 2–4 of v1.2.0) are unchanged. `.htaccess` now forces HTTPS.

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

### Toto — the built-in document assistant (v1.5)
Toto runs entirely inside the platform, in plain PHP on your own server. There is no paid AI service, no API key, and no document text ever leaves the server. When someone uploads a new document, Toto reads it first, while the upload dialog is still open:

| What Toto does | How |
|---|---|
| **Fills in the properties** — title, content type, tags, keywords and matching properties (revision, document date, document number) | It reads headings and labels such as *Doc No*, *Rev* and *Date*, matches words against the term store and its synonyms, and learns from the tags and content types on similar documents already in the hub |
| **Sensitive-data warning** — suggests Confidential or Restricted | Pattern checks for salary/payroll terms, personal KRA PINs, ID and passport numbers, dates of birth, bank and IBAN numbers, payment cards (Luhn-checked), medical words, contact lists, prices, and *Confidential* markings. It shows *what kind* of data it found, never the values |
| **Near-duplicates** — “91 % the same as …”, with a one-click *make it a new version* | 64-hash MinHash fingerprints of 5-word shingles |
| **Key points** on the document page | Extractive summary: it picks the 3–4 most distinctive sentences of the document's own text. It never writes new text |
| **Similar documents** by meaning, not only shared tags | TF-IDF keyword vectors and cosine similarity |

- **Scans and picture-only PDFs** are read in the upload dialog first, using the same in-browser text recognition as the rest of the platform. Toto then makes its suggestions from that text, and the document is searchable as soon as it is published. Long scans (more than 12 pages) get a quick read of the first 12 pages for the suggestions; the full text is read after upload.
- Everything Toto fills in is marked with a green **✦ Toto** badge, so the uploader can check it before publishing. Changing a field removes the badge.
- If Toto finds Restricted-looking data in a single upload, the uploader must choose **Make it Restricted** or **Keep Internal** before it uploads. For several files, a tick box (on by default) raises each flagged file.
- Toto only compares a document with documents the uploader is allowed to see, so it never reveals titles or tags of hidden documents.
- The file is sent once. Toto keeps it under a one-day token while the dialog is open, and the upload then refers to it.
- **Admin → Settings → Toto:** switch it on or off, see how many documents it has read, and rebuild its index. The rebuild runs in small batches, so it is safe on shared hosting.

### Ask Toto — a librarian you talk to (v1.5.1)
**Search** in the menu opens Toto. Toto, a small animated librarian, pops up, waves and greets you by name, and you ask in plain words:
- *Where is the latest hydrotest procedure for the bullets?* → names the newest matching procedure, with its number, version and author.
- *What is the hold time for the hydrotest?* → quotes the sentence from the document that answers it, and links to the document.
- *How many drawings were added this month?* / *Who owns the fire & gas philosophy?* / *Which documents are overdue for review?* / *Show me my documents from last week*.
- Follow-ups keep the thread: *only PDFs*, *what about drawings?*, *newest first*, *how many are there?*

Toto understands content types, libraries, people (*by Grace*), tags and their synonyms, file types, dates (*last month*, *since March*, *in 2025*), status, review dates, classification and document numbers. It shows what it understood as chips, and you can click a chip away to search again without it. If nothing matches, Toto first widens the search, telling you what it dropped. If there is still nothing, it suggests a colleague who knows the subject. Toto only ever counts, names or quotes documents the person asking can open. The classic search with filters is one click away, and Ctrl + K offers *Ask Toto* too.

### Toto's personality (v1.5.3)
Toto chats as well as searches, and all of it is hand-written PHP, with no AI service:
- **How-to help** for the platform: *how do I upload a document*, *how can I change the attributes*, *how to create a folder*, *what's the difference between confidential and restricted*, *how do I turn on two-step verification*. Toto answers in numbered steps, with buttons that take you there (Open the upload dialog, My favourites…). Administrator topics are explained only to administrators.
- **Small talk** in English, Swahili and Nepali greetings, plus jokes, fun facts, riddles, rock-paper-scissors, coin flips, dice, a calculator (*15% of 2500*, *(12+8)\*3/4*), unit conversions (*10 bar to psi*, *60 F to C*, *2 tonnes of LPG to litres*) and dates (*days until Christmas*, *what day is it*).
- **Moods:** Toto waves, dances at a good joke, winks at riddles, looks around while searching, yawns and dozes off if you leave him alone, and giggles when you poke him (up to a point).
- **A temper, for fun:** insults, shouting in capitals, impatience (*hurry up!!!*) or asking the same thing again and again make him grumpy: steam puffs, red cheeks, sassy replies. Push too far and he takes a 10-second ☕ tea break. Say sorry and he forgives you. If someone says they are stressed or sad, the sass switches off and he answers kindly. If someone writes anything about harming themselves, he points them to people who can help.

### Toto knows his creator, and learns (v1.5.4)
- Toto always knows that **Om Khadka** programmed the platform and Toto himself. Ask *who made you?*, *who developed this system?* or *who is Om Khadka?*. When Om himself asks, Toto greets him as his creator. Nobody can teach Toto otherwise. The name is set in **Admin → Settings → Toto → Toto’s creator**.
- **Administrators teach Toto** in the chat: *remember that the site office opens at 7 am*, *remember that Peter Otieno is the site QA/QC lead*. Anyone who later asks (*when does the site office open?*, *who is Peter Otieno?*) hears the answer. *forget the site office* removes it, and *what have you learned?* lists everything. The same list, with delete buttons, is in Admin → Settings → Toto. Non-administrators can't teach him, so nobody can plant false information. Every fact taught or forgotten is recorded in the audit log.
- Every visit to Ask Toto starts a fresh, tidy conversation. The newest question scrolls up under Toto automatically, with the answer below it.

### Requests for input: editing in Word, Excel and PowerPoint (v1.7)
Office documents are edited by **one named person at a time, and only when asked**:
1. The document owner, someone with Full control or an administrator opens a Word, Excel or PowerPoint document → ⋯ → **Request input…**, picks **one person**, writes what they need and optionally sets a due date. The person must already be able to open the document.
2. That person gets a notification, and the document is **checked out to them**. Nobody else can change it, the lock does not lapse while the request is open, and contributors can't upload versions meanwhile.
3. On the document they press **Edit in Word** (or Excel / PowerPoint). The file opens in the Office app on their computer, and every **Save** goes straight back to the hub as a working copy. Saves never overwrite a version.
4. **I'm done** turns their last save into the next version ("Input from Peter Otieno: …"). It is published as usual, indexed for search and read by Toto, and the requester is notified. The requester can **Withdraw** the request at any time, which discards unsaved work and unlocks the document.
5. If the person has no Office on that computer, they can **download the file, edit it elsewhere and upload their copy** from the same banner.

How it works: `dav.php` is a small WebDAV endpoint, reached as `/dav/<token>/<file>` through the `.htaccess` rewrite. Each request has its own 40-character token that opens only that one file, is shown only to the person asked, and stops working when the request is closed. Every request, save, finish and withdrawal is in the audit log.

**Hosting check:** some hosts block the WebDAV methods Office uses. Open **Admin → Settings → Editing in Word, Excel & PowerPoint → Test Office editing**. If anything shows ❌, ask hosting support to allow PROPFIND, LOCK, UNLOCK and PUT for `/dav/` (usually a ModSecurity rule). The site must use HTTPS, and Office for Windows needs it. Set **Site address** (base URL) in Settings so the links point to the right domain.

### Knowledge map (v1.6)
**Knowledge map** in the left menu draws the hub's knowledge as an interactive network, built only from documents the viewer can open:
- **Topics & experts:** subjects (tags) are shown in green and people in blue, joined by lines when a person writes or comments on that subject. Click a topic to see who the go-to person is, everyone who knows it, and its documents. Click a person to see what they know and their documents. A **red ring** marks knowledge held by one person only, and a person's panel lists *"Knowledge only they hold"*, which helps plan handovers.
- **Documents:** documents are coloured by library and joined by explicit links, shared tags and text Toto found similar ("26% similar text").
- Drag to pan, scroll or use the buttons to zoom, find anything by name, and filter by library.
- Toto answers *who knows about fire & gas?* / *who should I ask about the unloading arms?* with the go-to people, and links to that spot on the map.

### Talking Toto (v1.6)
- 🔊 **Speaker button:** Toto reads his answers aloud. His mouth moves and he gestures while he talks. The voice is generated by the browser on the person's own computer, so it costs nothing.
- 🎙️ **Microphone button:** you ask Toto by voice. He tilts his head with a hand to his ear while listening, the words appear as you speak, and the question is sent when you pause. This works in Chrome and Edge. **Privacy note:** those browsers turn speech into text using their own speech service (Google in Chrome, Microsoft in Edge), so the spoken question leaves the computer; documents never do. Administrators can switch the microphone off in **Admin → Settings → Toto**.

### Smart features
- **Full-text search** inside PDF (text-based), Word, Excel, PowerPoint, OpenDocument, TXT/CSV — with snippets, highlighting, facets and operators: `type:pdf lib:ENG ct:DWG owner:grace status:pending tag:"Fire Water System" after:2026-01-01 "exact phrase"`
- **Synonym-aware term store** — a search for *bullet* finds documents tagged *Mounded Bullets*
- **Auto-tag suggestions** from the file content, one click to apply. Toto (above) also applies the confident ones at upload
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
- **Security:** sign-in is throttled per device, never by locking the whole account: 5 wrong passwords or codes for one account from one IP address pause that device for 15 minutes, 10 failures from one IP (any accounts) pause it for 10 minutes, and an account attacked from many addresses only gets slower (up to 3 s per try); People → open the person → Save clears it; changing or resetting a password signs that person out everywhere else; check-outs lapse after the hours set in Settings; executable and web-page file types (php, html, js, exe…) can never be uploaded, whatever the allowed list says; HTTPS is forced.
- **Optional `app/config.php` keys:** `'trusted_proxies' => ['10.0.0.5']` — only if the site sits behind a reverse proxy/CDN that sends `X-Forwarded-Proto` (the header is ignored from anyone else); `'xsendfile' => true` — only if the host has mod_xsendfile (or LiteSpeed X-Sendfile) enabled, so the web server streams downloads instead of PHP.
- **Errors:** PHP errors go to the server error log (cPanel → *Errors*). For temporary detail in API responses add `'debug' => true,` to `app/config.php` — remove it afterwards.

## 4. File map
```
index.php        App shell            api.php       JSON API (api.php?r=module.action)
download.php     Permission-checked file streaming, ZIP export
install.php      One-time installer   .htaccess / .user.ini   Security rules, PHP limits
app/             Back end (blocked from the web): bootstrap, permission engine, text extraction, Toto (ai.php), API modules, schema
assets/          app.css, app.js (built from assets/js/*), qrcode.js (QR generator, MIT licence), ocr/ (text-recognition engine), favicon
```
