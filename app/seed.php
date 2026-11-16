<?php
/** Default structure for TGISL (departments, taxonomy, libraries) and optional demo content. */
declare(strict_types=1);

function seed_defaults(int $adminId): void {
    $settings = [
        'site_name' => 'TGISL Knowledge Hub',
        'org_name' => 'Taifa Gas Investment SEZ Limited',
        'number_pattern' => 'TGISL-{LIB}-{TYPE}-{SEQ}',
        'max_upload_mb' => '100',
        'allowed_ext' => 'pdf,doc,docx,xls,xlsx,xlsm,ppt,pptx,txt,csv,md,rtf,odt,ods,odp,jpg,jpeg,png,gif,webp,svg,dwg,dxf,zip,rar,7z,msg,eml,mp4,mp3,xml,json,vsdx,mpp,xer',
        'recycle_days' => '90',
        'session_minutes' => '240',
        'email_notifications' => '0',
        'checkout_hours' => '72',
        'db_version' => '4', 'approval_workflow' => '0',
        'mfa_policy' => 'optional',
        'mfa_remember_days' => '30',
        'welcome_text' => 'One place for every controlled document, drawing, procedure and lesson learned across the Mombasa LPG terminal.',
    ];
    foreach ($settings as $k => $v) set_setting($k, $v);

    $depts = [
        ['Management', 'MGT', '#0E2A3B'], ['Engineering', 'ENG', '#0F7C7A'], ['Projects & Construction', 'PRJ', '#2F6FB0'],
        ['Procurement & Contracts', 'PRC', '#8A5A00'], ['Finance', 'FIN', '#5B4FA8'], ['HSE', 'HSE', '#2E8B57'],
        ['Operations & Maintenance', 'OPS', '#B5532C'], ['Quality (QA/QC)', 'QAQC', '#7A6A2F'], ['Human Resources & Admin', 'HRA', '#A33A6B'],
        ['Information Technology', 'ICT', '#3D5A80'], ['Legal & Compliance', 'LEG', '#6B4E3D'], ['Commercial & Sales', 'COM', '#C0392B'],
    ];
    $D = [];
    foreach ($depts as [$n, $c, $col]) $D[$c] = insert('departments', ['name' => $n, 'code' => $c, 'color' => $col]);
    q('UPDATE users SET department_id = ? WHERE id = ?', [$D['MGT'], $adminId]);

    $types = [
        ['Drawing', 'DWG', '#2F6FB0', 0], ['Specification', 'SPC', '#0F7C7A', 0], ['Datasheet', 'DS', '#3D5A80', 0],
        ['Procedure', 'PRO', '#2E8B57', 24], ['Policy', 'POL', '#0E2A3B', 12], ['Method Statement', 'MS', '#7A6A2F', 0],
        ['Report', 'RPT', '#5B4FA8', 0], ['Contract', 'CON', '#8A5A00', 0], ['Purchase Order', 'PO', '#B5532C', 0],
        ['Correspondence', 'COR', '#5B6B73', 0], ['Minutes of Meeting', 'MOM', '#6B4E3D', 0], ['Certificate / Permit', 'CER', '#C0392B', 12],
        ['Form / Template', 'FRM', '#A33A6B', 24], ['Presentation', 'PRS', '#3A7CA5', 0], ['Lesson Learned', 'LL', '#E8A33D', 0],
    ];
    $T = [];
    foreach ($types as [$n, $c, $col, $rev]) $T[$c] = insert('content_types', ['name' => $n, 'code' => $c, 'color' => $col, 'review_months' => $rev]);

    $sets = [
        'Plant Area' => ['Jetty & Marine Unloading' => ['Unloading Arms', 'Jetty Pipeline'], 'LPG Storage' => ['Mounded Bullets', 'Spheres'],
            'Pump & Compressor House' => [], 'Cylinder Filling Plant' => ['Carousel', 'Cylinder Testing'], 'Tanker Loading Gantry' => [],
            'Fire Water System' => [], 'Flare & Relief System' => [], 'Control Room & Substation' => [], 'Admin & Utilities' => []],
        'Discipline' => ['Process' => [], 'Mechanical' => ['Static Equipment', 'Rotating Equipment'], 'Piping' => [], 'Civil & Structural' => [],
            'Electrical' => [], 'Instrumentation & Control' => [], 'Fire & Gas' => [], 'HSE' => [], 'Architectural' => []],
        'Project Phase' => ['FEED' => [], 'Detailed Engineering' => [], 'Procurement' => [], 'Construction' => [], 'Pre-commissioning' => [], 'Commissioning' => [], 'Operations' => []],
        'Issue Purpose' => ['IFR – Issued for Review' => [], 'IFA – Issued for Approval' => [], 'IFC – Issued for Construction' => [], 'IFI – Issued for Information' => [], 'As-Built' => []],
        'Regulator' => ['EPRA' => [], 'NEMA' => [], 'Kenya Ports Authority' => [], 'DOSHS' => [], 'County Government of Mombasa' => [], 'KEBS' => []],
    ];
    $synonyms = ['Mounded Bullets' => 'bullet, mounded storage', 'Spheres' => 'sphere, horton sphere', 'Fire Water System' => 'firewater, fire pump, deluge',
        'Instrumentation & Control' => 'I&C, instrument, DCS, PLC, SCADA', 'Electrical' => 'MV, LV, switchgear, transformer', 'Piping' => 'isometric, P&ID, pipe',
        'Process' => 'PFD, heat and material balance, HAZOP', 'Flare & Relief System' => 'flare, PSV, relief valve', 'Tanker Loading Gantry' => 'gantry, road tanker, bay',
        'Jetty & Marine Unloading' => 'jetty, ship, vessel, berth, marine', 'Cylinder Filling Plant' => 'cylinder, carousel, bottling'];
    $S = [];
    foreach ($sets as $setName => $terms) {
        $sid = insert('termsets', ['name' => $setName, 'group_name' => 'TGISL']);
        $S[$setName] = $sid;
        $i = 0;
        foreach ($terms as $label => $children) {
            $tid = insert('terms', ['termset_id' => $sid, 'label' => $label, 'synonyms' => $synonyms[$label] ?? '', 'sort' => $i++]);
            $j = 0;
            foreach ($children as $c) insert('terms', ['termset_id' => $sid, 'parent_id' => $tid, 'label' => $c, 'synonyms' => $synonyms[$c] ?? '', 'sort' => $j++]);
        }
    }

    $F = [];
    $fields = [
        ['Discipline', 'term', null, $S['Discipline'], 1], ['Plant Area', 'term', null, $S['Plant Area'], 1],
        ['Project Phase', 'term', null, $S['Project Phase'], 0], ['Issue Purpose', 'term', null, $S['Issue Purpose'], 0],
        ['Revision Code', 'text', null, null, 0], ['Contractor / Vendor', 'text', null, null, 0], ['PO / Contract No.', 'text', null, null, 0],
        ['Contract Value (USD)', 'number', null, null, 0], ['Effective Date', 'date', null, null, 0], ['Expiry Date', 'date', null, null, 0],
        ['Regulator', 'term', null, $S['Regulator'], 0], ['Originator', 'user', null, null, 0],
        ['Priority', 'choice', json_encode(['Low', 'Normal', 'High', 'Critical']), null, 0],
    ];
    foreach ($fields as $i => [$n, $type, $opts, $ts, $multi]) {
        $F[$n] = insert('fields', ['name' => $n, 'type' => $type, 'options' => $opts, 'termset_id' => $ts, 'multi' => $multi, 'sort' => $i]);
    }
    $map = [
        'DWG' => ['Discipline', 'Plant Area', 'Project Phase', 'Issue Purpose', 'Revision Code', 'Contractor / Vendor'],
        'SPC' => ['Discipline', 'Plant Area', 'Issue Purpose', 'Revision Code'], 'DS' => ['Discipline', 'Plant Area', 'Contractor / Vendor', 'Revision Code'],
        'PRO' => ['Discipline', 'Effective Date', 'Originator'], 'POL' => ['Effective Date', 'Originator'],
        'MS' => ['Discipline', 'Plant Area', 'Contractor / Vendor', 'Issue Purpose'], 'RPT' => ['Project Phase', 'Plant Area', 'Originator'],
        'CON' => ['Contractor / Vendor', 'PO / Contract No.', 'Contract Value (USD)', 'Effective Date', 'Expiry Date'],
        'PO' => ['Contractor / Vendor', 'PO / Contract No.', 'Contract Value (USD)', 'Plant Area'],
        'COR' => ['Contractor / Vendor', 'Regulator', 'Priority'], 'MOM' => ['Project Phase', 'Originator'],
        'CER' => ['Regulator', 'Plant Area', 'Effective Date', 'Expiry Date'], 'FRM' => ['Originator'], 'PRS' => ['Project Phase'],
        'LL' => ['Discipline', 'Plant Area', 'Project Phase', 'Priority'],
    ];
    foreach ($map as $ct => $names) foreach ($names as $n) insert('content_type_fields', ['content_type_id' => $T[$ct], 'field_id' => $F[$n]]);

    $libs = [
        ['Engineering Documents', 'ENG', 'Drawings, specifications, datasheets and calculations', 'drafting', '#0F7C7A', 'ENG',
            [['everyone', '', 1], ['department', 'ENG', 2], ['department', 'PRJ', 2], ['department', 'QAQC', 2]]],
        ['Project Controls & Reports', 'PRJ', 'Schedules, progress reports, MoMs and correspondence', 'chart', '#2F6FB0', 'PRJ',
            [['everyone', '', 1], ['department', 'PRJ', 2], ['department', 'MGT', 2]]],
        ['Procurement & Contracts', 'PRC', 'Purchase orders, contracts, vendor documents', 'handshake', '#8A5A00', 'PRC',
            [['department', 'PRC', 2], ['department', 'FIN', 1], ['department', 'MGT', 1], ['department', 'LEG', 2], ['role', 'head', 1]]],
        ['HSE Management System', 'HSE', 'HSE plans, permits, risk assessments, incident reports', 'shield', '#2E8B57', 'HSE',
            [['everyone', '', 1], ['department', 'HSE', 2]]],
        ['Policies & Procedures', 'POL', 'Company-wide policies, SOPs and forms', 'book', '#0E2A3B', 'MGT',
            [['everyone', '', 1], ['role', 'head', 2]]],
        ['Operations & Maintenance', 'OPS', 'O&M manuals, maintenance records, operating procedures', 'wrench', '#B5532C', 'OPS',
            [['everyone', '', 1], ['department', 'OPS', 2], ['department', 'ENG', 2]]],
        ['Human Resources', 'HRA', 'HR policies, templates and staff records', 'people', '#A33A6B', 'HRA',
            [['department', 'HRA', 2], ['department', 'MGT', 1]]],
        ['Lessons Learned', 'KNW', 'Knowledge captured from the project — what worked and what to avoid', 'bulb', '#E8A33D', 'MGT',
            [['everyone', '', 2]]],
    ];
    foreach ($libs as [$n, $code, $desc, $icon, $col, $dept, $perms]) {
        $lid = insert('libraries', ['name' => $n, 'code' => $code, 'description' => $desc, 'icon' => $icon, 'color' => $col,
            'department_id' => $D[$dept], 'approval_required' => 1, 'approval_mode' => 'any_head', 'created_by' => $adminId]);
        foreach ($perms as [$pt, $pid, $lv]) {
            $pidv = $pt === 'department' ? (string)$D[$pid] : $pid;
            insert('permissions', ['scope_type' => 'library', 'scope_id' => $lid, 'principal_type' => $pt, 'principal_id' => $pidv, 'level' => $lv, 'created_by' => $adminId]);
        }
    }
    $eng = (int)val("SELECT id FROM libraries WHERE code='ENG'");
    foreach (['Process', 'Mechanical', 'Piping', 'Civil & Structural', 'Electrical', 'Instrumentation & Control', 'Vendor Documents'] as $f)
        insert('folders', ['library_id' => $eng, 'name' => $f, 'created_by' => $adminId]);
    $prj = (int)val("SELECT id FROM libraries WHERE code='PRJ'");
    foreach (['Schedules', 'Monthly Progress Reports', 'Minutes of Meeting', 'Correspondence'] as $f)
        insert('folders', ['library_id' => $prj, 'name' => $f, 'created_by' => $adminId]);
    $prc = (int)val("SELECT id FROM libraries WHERE code='PRC'");
    foreach (['Purchase Orders', 'Contracts', 'Vendor Prequalification'] as $f)
        insert('folders', ['library_id' => $prc, 'name' => $f, 'created_by' => $adminId]);

    insert('announcements', ['title' => 'Welcome to the TGISL Knowledge Hub', 'pinned' => 1, 'created_by' => $adminId,
        'body' => "Upload your documents into the right library. Each upload is versioned automatically, and it is published straight away to everyone with read access."]);
}

/** Optional demo staff and documents so the platform can be evaluated immediately. */
function seed_demo(int $adminId, string $password): void {
    $D = [];
    foreach (all('SELECT id, code FROM departments') as $r) $D[$r['code']] = (int)$r['id'];
    $people = [
        ['Grace Wanjiku', 'grace.wanjiku', 'ENG', 'head', 'Engineering Manager'], ['Peter Otieno', 'peter.otieno', 'ENG', 'member', 'Piping Engineer'],
        ['Amina Hassan', 'amina.hassan', 'PRJ', 'head', 'Project Controls Lead'], ['David Mwangi', 'david.mwangi', 'PRJ', 'member', 'Planning Engineer'],
        ['Fatma Said', 'fatma.said', 'PRC', 'head', 'Procurement Manager'], ['John Kamau', 'john.kamau', 'PRC', 'member', 'Buyer'],
        ['Lucy Akinyi', 'lucy.akinyi', 'HSE', 'head', 'HSE Manager'], ['Brian Ochieng', 'brian.ochieng', 'OPS', 'member', 'Operations Supervisor'],
        ['Mercy Njeri', 'mercy.njeri', 'HRA', 'head', 'HR Manager'], ['Samuel Kiptoo', 'samuel.kiptoo', 'FIN', 'viewer', 'Accountant'],
    ];
    $U = [];
    foreach ($people as [$n, $e, $d, $role, $title]) {
        $U[$e] = insert('users', ['name' => $n, 'email' => "$e@tgisl.demo", 'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'department_id' => $D[$d], 'role' => $role, 'job_title' => $title]);
    }
    $g = insert('user_groups', ['name' => 'HAZOP Review Team', 'description' => 'Cross-discipline reviewers for process safety studies']);
    foreach (['grace.wanjiku', 'peter.otieno', 'lucy.akinyi'] as $e) insert('group_members', ['group_id' => $g, 'user_id' => $U[$e]]);

    $L = []; foreach (all('SELECT id, code FROM libraries') as $r) $L[$r['code']] = (int)$r['id'];
    $T = []; foreach (all('SELECT id, code FROM content_types') as $r) $T[$r['code']] = (int)$r['id'];
    $folder = fn($lib, $name) => (int)val('SELECT id FROM folders WHERE library_id=? AND name=?', [$L[$lib], $name]) ?: null;
    $term = fn($label) => (int)val('SELECT id FROM terms WHERE label=?', [$label]);
    $field = fn($name) => (int)val('SELECT id FROM fields WHERE name=?', [$name]);

    $docs = [
        ['ENG', 'Process', 'Process Flow Diagram – LPG Receipt from Jetty to Mounded Bullets', 'DWG', 'peter.otieno', 'published',
            ['Discipline' => ['Process'], 'Plant Area' => ['Jetty & Marine Unloading', 'Mounded Bullets'], 'Issue Purpose' => ['IFC – Issued for Construction'], 'Revision Code' => 'C2'],
            "PROCESS FLOW DIAGRAM\nLPG receipt from marine unloading arms via 12in jetty pipeline to mounded bullets.\nDesign pressure 17.5 barg. Vapour return line to vessel. PSV set points per relief study.\nHAZOP actions 14, 22 and 31 closed in this revision."],
        ['ENG', 'Piping', 'Piping Material Specification for LPG Service', 'SPC', 'peter.otieno', 'published',
            ['Discipline' => ['Piping'], 'Issue Purpose' => ['IFA – Issued for Approval'], 'Revision Code' => 'B1'],
            "PIPING MATERIAL SPECIFICATION\nClass A1 carbon steel ASTM A333 Gr.6 for low temperature service. Flanges ASME B16.5 Class 300 RF.\nGaskets spiral wound SS316 with graphite filler. Bolting A320 L7."],
        ['ENG', 'Instrumentation & Control', 'Fire & Gas Detection Philosophy', 'SPC', 'grace.wanjiku', 'pending',
            ['Discipline' => ['Fire & Gas', 'Instrumentation & Control'], 'Plant Area' => ['LPG Storage', 'Tanker Loading Gantry'], 'Issue Purpose' => ['IFR – Issued for Review']],
            "FIRE AND GAS PHILOSOPHY\nGas detectors (catalytic and IR) at 20% LEL alarm and 40% LEL trip.\nFlame detectors at loading gantry bays and pump house. Deluge activation on confirmed fire voting 2oo3."],
        ['PRJ', 'Monthly Progress Reports', 'Monthly Progress Report – September 2026', 'RPT', 'david.mwangi', 'published',
            ['Project Phase' => ['Construction'], 'Plant Area' => ['LPG Storage', 'Jetty & Marine Unloading']],
            "MONTHLY PROGRESS REPORT SEPTEMBER 2026\nOverall progress 61.4% against plan 64.0%. Engineering 96%, procurement 88%, construction 42%.\nCritical path: mounded bullet backfill and jetty pipeline hydrotest. Recovery plan agreed with EPC contractor."],
        ['PRJ', 'Minutes of Meeting', 'Weekly Construction Coordination Meeting #38', 'MOM', 'amina.hassan', 'published',
            ['Project Phase' => ['Construction']],
            "MINUTES OF MEETING 38\nAttendees: TGISL, EPC contractor, PMC. Actions: submit revised hydrotest procedure, resolve NCR-112 on sphere welding, mobilise second crane."],
        ['PRC', 'Purchase Orders', 'Purchase Order – LPG Transfer Pumps', 'PO', 'john.kamau', 'pending',
            ['Contractor / Vendor' => 'Corken Pumps', 'PO / Contract No.' => 'PO-TGISL-0417', 'Contract Value (USD)' => '286500', 'Plant Area' => ['Pump & Compressor House']],
            "PURCHASE ORDER PO-TGISL-0417\nSupply of 3 x LPG transfer pumps, 120 m3/h, ATEX Zone 1 motors, with spares for 2 years operation. Delivery CIF Mombasa 20 weeks."],
        ['HSE', null, 'Permit to Work Procedure', 'PRO', 'lucy.akinyi', 'published',
            ['Discipline' => ['HSE'], 'Effective Date' => '2026-03-01'],
            "PERMIT TO WORK PROCEDURE\nHot work, cold work, confined space entry and electrical isolation permits. Gas testing before every hot work permit. Permit validity one shift."],
        ['HSE', null, 'EPRA Construction Permit – LPG Storage Facility', 'CER', 'lucy.akinyi', 'published',
            ['Regulator' => ['EPRA'], 'Plant Area' => ['LPG Storage'], 'Effective Date' => '2025-11-15', 'Expiry Date' => '2026-11-14'],
            "EPRA CONSTRUCTION PERMIT\nPermit to construct LPG storage facility at Dongo Kundu Special Economic Zone, Mombasa. Valid twelve months."],
        ['POL', null, 'Document Control Procedure', 'PRO', 'amina.hassan', 'published',
            ['Effective Date' => '2026-01-10'],
            "DOCUMENT CONTROL PROCEDURE\nDocument numbering, revision codes (A, B for review; C0 for construction), transmittals, and the approval process in the Knowledge Hub."],
        ['KNW', null, 'Lesson Learned – Sphere Weld Repair Delays', 'LL', 'grace.wanjiku', 'published',
            ['Discipline' => ['Mechanical'], 'Plant Area' => ['Spheres'], 'Priority' => 'High'],
            "LESSON LEARNED\nRadiography backlog delayed sphere weld repairs by three weeks. Recommendation: contract a second NDT crew before peak welding and track repair rate weekly."],
        ['OPS', null, 'Cylinder Filling Carousel – Operating Manual', 'PRO', 'brian.ochieng', 'draft',
            ['Plant Area' => ['Carousel']],
            "OPERATING MANUAL\nStart-up and shutdown sequence for the 24-head cylinder filling carousel. Check-weigh rejects and leak detection."],
    ];
    foreach ($docs as $i => [$lib, $fold, $title, $ct, $owner, $status, $meta, $text]) {
        $ownerId = $U[$owner] ?? $adminId;
        $fid = $fold ? $folder($lib, $fold) : null;
        $num = next_doc_number($L[$lib], $T[$ct]);
        $created = date('Y-m-d H:i:s', strtotime('-' . (40 - $i * 3) . ' days'));
        $docId = insert('documents', ['library_id' => $L[$lib], 'folder_id' => $fid, 'title' => $title, 'description' => strtok($text, "\n") ?: '',
            'doc_number' => $num, 'content_type_id' => $T[$ct], 'status' => 'draft', 'owner_id' => $ownerId, 'created_at' => $created, 'updated_at' => $created,
            'views' => random_int(3, 120), 'confidentiality' => $lib === 'PRC' ? 'confidential' : 'internal']);
        $versions = $status === 'published' && $i % 3 === 0 ? 2 : 1;
        $verId = 0;
        for ($v = 1; $v <= $versions; $v++) {
            $content = $text . ($v > 1 ? "\nRevision note: comments from review incorporated." : '');
            $stored = bin2hex(random_bytes(16)) . '.txt';
            $dir = storage_path('files/' . substr($stored, 0, 2));
            @mkdir($dir, 0750, true);
            file_put_contents("$dir/$stored", $content);
            $major = $status === 'published' ? $v : 0; $minor = $status === 'published' ? 0 : $v;
            $verId = insert('document_versions', ['document_id' => $docId, 'major' => $major, 'minor' => $minor,
                'filename' => preg_replace('/[^A-Za-z0-9]+/', '_', $title) . '.txt', 'stored_name' => $stored, 'mime' => 'text/plain', 'ext' => 'txt',
                'size' => strlen($content), 'sha256' => hash('sha256', $content), 'comment' => $v === 1 ? 'Initial upload' : 'Updated after review',
                'uploaded_by' => $ownerId, 'created_at' => date('Y-m-d H:i:s', strtotime($created) + $v * 86400), 'extracted_text' => $content]);
        }
        $upd = ['current_version_id' => $verId, 'status' => $status, 'search_text' => $text];
        if ($status === 'published') $upd['published_version_id'] = $verId;
        update('documents', $upd, 'id=?', [$docId]);
        foreach ($meta as $fname => $val) {
            $fidd = $field($fname);
            if (is_array($val)) foreach ($val as $lbl) insert('document_terms', ['document_id' => $docId, 'term_id' => $term($lbl), 'field_id' => $fidd]);
            else insert('document_meta', ['document_id' => $docId, 'field_id' => $fidd, 'value' => $val]);
        }
        if ($status === 'pending') insert('approvals', ['document_id' => $docId, 'version_id' => $verId, 'requested_by' => $ownerId, 'requested_at' => date('Y-m-d H:i:s', strtotime('-' . (2 + $i) . ' hours'))]);
        if ($status === 'published') {
            $approver = $U['grace.wanjiku'];
            insert('approvals', ['document_id' => $docId, 'version_id' => $verId, 'requested_by' => $ownerId, 'decision' => 'approved', 'requested_at' => date('Y-m-d H:i:s', strtotime($created) + 86400),
                'decided_by' => $approver, 'decided_at' => date('Y-m-d H:i:s', strtotime($created) + 2 * 86400), 'note' => 'Approved']);
        }
        insert('audit_log', ['user_id' => $ownerId, 'action' => 'upload', 'object_type' => 'document', 'object_id' => $docId, 'details' => $title, 'created_at' => $created]);
    }
    q("UPDATE documents SET review_date = DATE_SUB(CURDATE(), INTERVAL 5 DAY) WHERE title LIKE 'Permit to Work%'");
    insert('comments', ['document_id' => (int)val("SELECT id FROM documents WHERE title LIKE 'Fire & Gas%'"), 'user_id' => $U['lucy.akinyi'],
        'body' => 'Please align the LEL set points with the HSE philosophy before approval.']);
    insert('announcements', ['title' => 'HAZOP close-out workshop on Thursday', 'pinned' => 0, 'created_by' => $U['grace.wanjiku'],
        'body' => 'All open HAZOP actions must have evidence uploaded to Engineering Documents before the workshop.']);
}
