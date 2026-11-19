<?php
/**
 * Toto's how-to knowledge: "how do I upload a document?", "how can I change the classification?" …
 * Each topic: words that point to it, the answer in steps, and buttons that take the person there.
 */
declare(strict_types=1);

function help_topics(array $u): array {
    $admin = $u['role'] === 'admin';
    $flow = approvals_on();
    $t = [
        ['id' => 'upload', 'title' => 'Uploading a document', 'words' => ['upload', 'add a document', 'add document', 'add file', 'put a document', 'submit a document', 'store a document', 'save a document', 'new document', 'drag'],
            'steps' => ['Open the library (left menu) and press **Upload** — or use the ⬆ icon at the top right from anywhere, or simply drag files onto a library page.',
                'Pick the library and folder, then choose or drop the files (several at once is fine).',
                'I read each file and fill in the title, content type, tags and keywords for you — they’re marked ✦ Toto. Check them, and pick the **classification**.',
                'Press **Upload**. ' . ($flow ? 'Depending on the library it is published straight away or sent for approval.' : 'It is published straight away, numbered automatically, and searchable at once.'),
                'Tip: a scan or photo? I read the text from it before you upload, so it is searchable too.'],
            'actions' => [['label' => 'Open the upload dialog', 'run' => 'upload']]],
        ['id' => 'version', 'title' => 'Uploading a new version', 'words' => ['new version', 'update a document', 'update document', 'replace', 'revise', 'revision', 'newer version', 'overwrite'],
            'steps' => ['Open the document and press **New version** (top right).', 'Choose the updated file and say what changed.',
                'Or just upload a file with the **same name** into the same folder — it becomes the next version automatically.',
                'Every older version stays in the **Versions** tab, where you can download, compare or restore it.'], 'actions' => []],
        ['id' => 'props', 'title' => 'Changing a document’s properties', 'words' => ['change attribute', 'attributes', 'properties', 'property', 'metadata', 'edit title', 'rename', 'change title', 'edit description', 'keywords', 'change content type', 'edit details', 'change details', 'edit properties'],
            'steps' => ['Open the document.', 'In the **Properties** panel on the right press **Edit** (or ⋯ → **Edit properties**).',
                'Change the title, description, keywords, content type, its properties (revision, dates, plant area…), tags or the review date.',
                'Press **Save** — search picks the changes up immediately.', 'You need Contribute access (or to be the author) to edit.'], 'actions' => []],
        ['id' => 'tags', 'title' => 'Tagging documents', 'words' => ['tag', 'tags', 'term', 'terms', 'label', 'categorise', 'categorize', 'classify by area', 'plant area'],
            'steps' => ['When you upload, I already add the tags I’m confident about — and offer more as chips you can click.',
                'On a document page, click any suggested tag under **Toto suggests these tags** to add it.',
                'Or **Edit** the properties and pick tags in the tag boxes (type a few letters).',
                'Tags come from the term store, so everyone uses the same words — and searching *bullet* also finds *Mounded Bullets*.'], 'actions' => []],
        ['id' => 'classification', 'title' => 'Classification (Public, Internal, Confidential, Restricted)', 'words' => ['classification', 'classify', 'confidential', 'restricted', 'public', 'internal', 'sensitive', 'secret', 'who can see', 'visibility'],
            'steps' => ['**Public** — anyone who can open the library; fine to share outside.', '**Internal** — anyone who can open the library; not for outside the organisation.',
                '**Confidential** — only the author, the library’s department, contributors, approvers and people you name.', '**Restricted** — only you, administrators and the people you name under Permissions (salaries, legal, board).',
                'To change it: open the document → **Edit** → Classification. I’ll warn you if a file looks more sensitive than you chose.'], 'actions' => []],
        ['id' => 'permissions', 'title' => 'Sharing and permissions', 'words' => ['permission', 'permissions', 'share', 'sharing', 'give access', 'grant access', 'access to', 'allow someone', 'who can open', 'restrict access'],
            'steps' => ['Document: ⋯ → **Manage permissions** (needs Full control). Add a person or group and pick Read, Contribute or Full control.',
                'A whole library or folder: open it and press **Permissions**.', 'Levels: **Read** view/download · **Contribute** upload/edit · **Full control** permissions and numbering.',
                'No access to something? Open it and press **Request access** — the administrators get your request.'], 'actions' => []],
        ['id' => 'folder', 'title' => 'Creating a folder', 'words' => ['folder', 'subfolder', 'create folder', 'new folder', 'make a folder'],
            'steps' => ['Open the library, go into the folder where the new one should live.', 'Press **New folder**, type the name, save.', 'You need Contribute access to the library.'], 'actions' => []],
        ['id' => 'checkout', 'title' => 'Check-out and check-in', 'words' => ['check out', 'checkout', 'check-out', 'check in', 'checkin', 'lock', 'locked', 'unlock', 'release'],
            'steps' => ['Open the document → ⋯ → **Check out (lock for editing)**. Others can still read it, but can’t upload a new version.',
                'Upload your new version — that checks it back in automatically. Or press **Release** to unlock without changes.',
                'Locks lapse by themselves after the time set by the administrator, so nothing stays stuck.'], 'actions' => [['label' => 'My checked-out documents', 'href' => '#/my/checked_out']]],
        ['id' => 'delete', 'title' => 'Deleting and the recycle bin', 'words' => ['delete', 'remove a document', 'remove document', 'trash', 'recycle', 'undelete', 'restore deleted', 'get back'],
            'steps' => ['Published documents can’t be deleted by staff — that keeps the record safe. Drafts can be deleted from ⋯ → **Delete**.',
                'Deleted items go to the **Recycle bin** (left menu) and can be restored from there until they expire.', 'Administrators can delete published documents and empty the bin.'],
            'actions' => [['label' => 'Open the recycle bin', 'href' => '#/recycle']]],
        ['id' => 'restore', 'title' => 'Restoring or comparing versions', 'words' => ['old version', 'previous version', 'restore version', 'roll back', 'rollback', 'compare', 'difference', 'what changed'],
            'steps' => ['Open the document → **Versions** tab.', 'Press **Compare versions** to see what changed in the text.', 'Press **Restore** on an older version to make it current again (it becomes a new version, nothing is lost).'], 'actions' => []],
        ['id' => 'download', 'title' => 'Downloading', 'words' => ['download', 'zip', 'export', 'save to my computer', 'print'],
            'steps' => ['Open the document and press **Download**.', 'Several at once: tick them in the library list and press **Download** — you get one ZIP.',
                'Confidential and Restricted documents carry a watermark on screen; every download is recorded.'], 'actions' => []],
        ['id' => 'move', 'title' => 'Moving a document', 'words' => ['move', 'relocate', 'wrong folder', 'wrong library', 'transfer'],
            'steps' => ['Open the document → ⋯ → **Move**, pick the library and folder.', 'Several at once: tick them in the library list and press **Move**.', 'The author (with Contribute access) or someone with Full control can move documents.'], 'actions' => []],
        ['id' => 'favourite', 'title' => 'Favourites and following', 'words' => ['favourite', 'favorite', 'follow', 'star', 'bookmark', 'notify me', 'alert me'],
            'steps' => ['Open the document and press **Add to favourites** (the star).', 'It appears under **Favourites** in the menu, and you get a notification when a new version is published.'],
            'actions' => [['label' => 'My favourites', 'href' => '#/my/favorites']]],
        ['id' => 'comments', 'title' => 'Comments and @mentions', 'words' => ['comment', 'comments', 'mention', 'discuss', 'feedback', 'note on a document'],
            'steps' => ['Open the document → **Comments** tab.', 'Type your comment; use **@Name** to notify a colleague — they get a notification.'], 'actions' => []],
        ['id' => 'review', 'title' => 'Review dates', 'words' => ['review date', 'periodic review', 'due for review', 'overdue', 'mark as reviewed', 'reviewed'],
            'steps' => ['Each document can have a **next review date** (many content types set it automatically).', 'When it is due, an alert appears on the document. Check it, upload a new version if needed, then press **Mark as reviewed**.',
                'See everything due under **Documents due for review**.'], 'actions' => [['label' => 'Documents due for review', 'href' => '#/my/review']]],
        ['id' => 'search', 'title' => 'Searching well', 'words' => ['search', 'find a document', 'find documents', 'look for', 'filter', 'operators', 'advanced search'],
            'steps' => ['Just ask me in plain words — “latest hydrotest procedure”, “drawings changed last week”, “how many reports in Engineering?”.',
                'Press **Ctrl + K** anywhere for quick search.', 'The classic search has filters and operators: `type:pdf lib:ENG owner:grace tag:"Fire Water" after:2026-01-01 "exact phrase"`.'],
            'actions' => [['label' => 'Classic search', 'href' => '#/search']]],
        ['id' => 'ocr', 'title' => 'Scans and pictures (text recognition)', 'words' => ['scan', 'scanned', 'ocr', 'picture', 'photo', 'image text', 'not searchable', 'searchable'],
            'steps' => ['When you upload a scan, I read its text in the upload dialog — no extra step.', 'For older scans, open the document and press **Make it searchable**.',
                'It runs in your browser, so nothing leaves the company.'], 'actions' => []],
        ['id' => 'mfa', 'title' => 'Two-step verification', 'words' => ['two-step', 'two step', '2fa', 'mfa', 'authenticator', 'verification code', 'security code', 'otp'],
            'steps' => ['Click your name at the bottom left → **Profile**.', 'Under **Two-step verification**, scan the QR code with Google or Microsoft Authenticator and type the 6-digit code.',
                'Keep the recovery codes somewhere safe — they get you in if you lose your phone.'], 'actions' => [['label' => 'Open my profile', 'href' => '#/profile']]],
        ['id' => 'password', 'title' => 'Changing your password', 'words' => ['password', 'change password', 'reset password', 'forgot password', 'forgotten password'],
            'steps' => ['Click your name at the bottom left → **Profile** → **Change password**.', 'Forgot it? Ask an administrator to reset it (People & access → open your name → Reset password).',
                'Changing your password signs you out on every other device.'], 'actions' => [['label' => 'Open my profile', 'href' => '#/profile']]],
        ['id' => 'theme', 'title' => 'Dark mode', 'words' => ['dark mode', 'light mode', 'theme', 'night mode', 'dark theme'],
            'steps' => ['Press the 🌙 / ☀ button at the bottom left, next to your name.'], 'actions' => [['label' => 'Switch now', 'run' => 'theme']]],
        ['id' => 'number', 'title' => 'Document numbers', 'words' => ['document number', 'doc number', 'numbering', 'number format', 'reference number'],
            'steps' => ['Numbers are given automatically on upload, e.g. TGISL-ENG-PRO-0001 (library · type · running number).',
                'Someone with Full control can type a number by hand (and I offer the number printed in the file).', 'Administrators set the pattern in Settings.'], 'actions' => []],
        ['id' => 'related', 'title' => 'Linking related documents', 'words' => ['related', 'link documents', 'link a document', 'relate', 'similar documents'],
            'steps' => ['Open the document → **Related documents** → **Link**, then find the other document.', 'Below that I list **similar documents** by meaning — no linking needed.'], 'actions' => []],
        ['id' => 'notifications', 'title' => 'Notifications', 'words' => ['notification', 'notifications', 'bell', 'email alerts', 'alerts'],
            'steps' => ['The 🔔 at the top right shows mentions, new versions of your favourites and requests.', 'Administrators can also switch on e-mail copies in Settings.'], 'actions' => []],
        ['id' => 'input', 'title' => 'Asking someone for input (editing in Word, Excel or PowerPoint)', 'words' => ['request input', 'ask for input', 'input', 'edit in word', 'edit in excel', 'edit in powerpoint', 'edit the document', 'edit a document', 'edit document', 'open in word', 'edit online', 'collaborate', 'co-author', 'make changes'],
            'steps' => ['Open the Word, Excel or PowerPoint document → ⋯ → **Request input…** (document owner, Full control or administrators).',
                'Pick **one person**, say what you need, and add a due date if you like. They get a notification; the document is locked for everyone else.',
                'They press **Edit in Word** (or Excel / PowerPoint) — the file opens in the Office app on their computer. Every **Save** goes straight back to the hub.',
                'When they press **I’m done**, their last save becomes the next version and you are notified. You can **Withdraw** the request at any time.',
                'No Office on that computer? They can download the file, edit it elsewhere and **upload their copy** from the same banner.'], 'actions' => []],
        ['id' => 'map', 'title' => 'The knowledge map', 'words' => ['knowledge map', 'map', 'graph', 'who knows what', 'expert', 'experts', 'network'],
            'steps' => ['Open **Knowledge map** in the left menu.', '**Topics & experts** shows subjects (green) and the people who write about them (blue). A red ring means only one person holds that knowledge.',
                '**Documents** shows how documents connect — links, shared tags, and text I found similar.', 'Click anything to see who knows it and its documents; drag to move, scroll to zoom. You can also just ask me “who knows about fire & gas?”.'],
            'actions' => [['label' => 'Open the knowledge map', 'href' => '#/map']]],
        ['id' => 'toto', 'title' => 'What Toto does', 'words' => ['toto', 'ai', 'assistant', 'suggestions', 'sparkle', 'key points', 'summary'],
            'steps' => ['I read every upload and suggest the title, type, tags, keywords, number and dates (marked ✦ Toto).', 'I warn when a file contains salary, ID, bank or other sensitive data.',
                'I spot near-copies, write **Key points** on document pages and list similar documents.', 'And I answer questions here. All on this server — no outside AI.'], 'actions' => []],
    ];
    if ($flow) $t[] = ['id' => 'approval', 'title' => 'Approvals', 'words' => ['approve', 'approval', 'approver', 'send for approval', 'publish', 'reject'],
        'steps' => ['Upload, then choose **Send for approval** — a department head reviews it.', 'Approvers find waiting items under **Approvals** and press **Approve** or **Request changes**.'],
        'actions' => [['label' => 'Approvals', 'href' => '#/approvals']]];
    $adminOnly = [
        ['id' => 'adduser', 'title' => 'Adding people', 'words' => ['add user', 'add a user', 'new user', 'add person', 'add people', 'create account', 'invite', 'add employee', 'import users'],
            'steps' => ['Admin → **People & access** → **Add person** (or **Import CSV** for many).', 'Set the department and role; give them access through libraries or groups.'], 'actions' => [['label' => 'People & access', 'href' => '#/admin/users']]],
        ['id' => 'library', 'title' => 'Creating a library', 'words' => ['new library', 'create library', 'add library', 'create a library', 'add a library'],
            'steps' => ['Press **+** next to *Libraries* in the menu (or Admin → **Libraries & permissions**).', 'Name it, give it a code (used in document numbers), pick the owning department and who may read or contribute.'],
            'actions' => [['label' => 'Libraries & permissions', 'href' => '#/admin/libraries']]],
        ['id' => 'termstore', 'title' => 'The term store and content types', 'words' => ['term store', 'add term', 'new term', 'content type', 'add property', 'new field', 'add field', 'taxonomy', 'synonym'],
            'steps' => ['Admin → **Properties & term store**.', 'Add terms (with synonyms) to a term set, or create properties and attach them to content types.', 'Synonyms make search and my suggestions smarter.'],
            'actions' => [['label' => 'Properties & term store', 'href' => '#/admin/taxonomy']]],
    ];
    foreach ($adminOnly as $x) $t[] = $x + ['admin' => true];
    if (!$admin) foreach ($t as &$x) if (!empty($x['admin'])) { $x['steps'] = ['That’s something an administrator does (' . mb_strtolower($x['title']) . '). Ask one of them, or use **Request access** on the page you need.']; $x['actions'] = []; }
    unset($x);
    return $t;
}

/** Answers "how do I …" questions about the platform. Null when it isn't one. */
function toto_help(string $q, array $u): ?array {
    $lc = ' ' . mb_strtolower(preg_replace('/\s+/u', ' ', trim($q))) . ' ';
    $asking = preg_match('/\b(how (do|can|should|would) (i|we|you|one)|how to|how does|how is|where (do|can) i|can i|is it possible|what is the way|way to|steps? (to|for)|guide|explain|help (me )?(with|to)?|i (want|need|would like) to|what does .* mean|what\'?s the difference|difference between|teach me|show me how|tell me how|unable to|can\'?t|cannot|don\'?t know how)\b/u', $lc);
    if (!$asking) return null;
    $best = null; $bestScore = 0;
    foreach (help_topics($u) as $t) {
        $s = 0;
        foreach ($t['words'] as $w) if (mb_strpos($lc, ' ' . $w) !== false || mb_strpos($lc, $w . ' ') !== false) $s += mb_strlen($w) > 8 ? 3 : 2;
        if ($s > $bestScore) { $bestScore = $s; $best = $t; }
    }
    if (!$best) return null;
    return $best;
}
