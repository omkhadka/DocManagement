-- TGISL Knowledge Hub — database schema (MySQL 5.7+ / MariaDB 10.3+)
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(64) PRIMARY KEY,
  v TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(16) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  color VARCHAR(16) DEFAULT '#0F7C7A',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dept_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  department_id INT NULL,
  role ENUM('admin','head','member','viewer') NOT NULL DEFAULT 'member',
  job_title VARCHAR(120) DEFAULT '',
  phone VARCHAR(40) DEFAULT '',
  active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_pw TINYINT(1) NOT NULL DEFAULT 0,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_login DATETIME NULL,
  mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
  mfa_secret VARCHAR(255) NULL,
  mfa_recovery TEXT NULL,
  mfa_last_step BIGINT NOT NULL DEFAULT 0,
  mfa_enabled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_email (email),
  KEY idx_user_dept (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS group_members (
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  KEY idx_gm_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS libraries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(16) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  icon VARCHAR(32) DEFAULT 'folder',
  color VARCHAR(16) DEFAULT '#0F7C7A',
  department_id INT NULL,
  approval_required TINYINT(1) NOT NULL DEFAULT 1,
  approval_mode ENUM('any_head','owner_head') NOT NULL DEFAULT 'any_head',
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS folders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  library_id INT NOT NULL,
  parent_id INT NULL,
  name VARCHAR(160) NOT NULL,
  inherit TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_folder_lib (library_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- level: 1 Read, 2 Contribute, 3 Approve, 4 Full control
CREATE TABLE IF NOT EXISTS permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope_type ENUM('library','folder','document') NOT NULL,
  scope_id INT NOT NULL,
  principal_type ENUM('user','department','group','role','everyone') NOT NULL,
  principal_id VARCHAR(32) NOT NULL DEFAULT '',
  level TINYINT NOT NULL DEFAULT 1,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_perm_scope (scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS content_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  code VARCHAR(8) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  color VARCHAR(16) DEFAULT '#5B6B73',
  review_months INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS termsets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_name VARCHAR(80) NOT NULL DEFAULT 'TGISL',
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  navigable TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS terms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  termset_id INT NOT NULL,
  parent_id INT NULL,
  label VARCHAR(120) NOT NULL,
  synonyms VARCHAR(400) DEFAULT '',
  sort INT NOT NULL DEFAULT 0,
  deprecated TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_term_set (termset_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Site columns / document properties
CREATE TABLE IF NOT EXISTS fields (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  type ENUM('text','number','date','choice','term','user','bool') NOT NULL DEFAULT 'text',
  options TEXT,
  termset_id INT NULL,
  multi TINYINT(1) NOT NULL DEFAULT 0,
  required TINYINT(1) NOT NULL DEFAULT 0,
  description VARCHAR(255) DEFAULT '',
  sort INT NOT NULL DEFAULT 0,
  filterable TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- which fields a content type uses (no rows = none)
CREATE TABLE IF NOT EXISTS content_type_fields (
  content_type_id INT NOT NULL,
  field_id INT NOT NULL,
  PRIMARY KEY (content_type_id, field_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  library_id INT NOT NULL,
  folder_id INT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  doc_number VARCHAR(64) DEFAULT NULL,
  keywords VARCHAR(500) DEFAULT '',
  content_type_id INT NULL,
  confidentiality ENUM('public','internal','confidential','restricted') NOT NULL DEFAULT 'internal',
  status ENUM('draft','pending','published','rejected') NOT NULL DEFAULT 'draft',
  current_version_id INT NULL,
  published_version_id INT NULL,
  owner_id INT NULL,
  checked_out_by INT NULL,
  checked_out_at DATETIME NULL,
  review_date DATE NULL,
  inherit TINYINT(1) NOT NULL DEFAULT 1,
  views INT NOT NULL DEFAULT 0,
  downloads INT NOT NULL DEFAULT 0,
  search_text MEDIUMTEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by INT NULL,
  KEY idx_doc_lib (library_id, folder_id),
  KEY idx_doc_status (status),
  KEY idx_doc_owner (owner_id),
  FULLTEXT KEY ft_doc (title, description, keywords, doc_number, search_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  major INT NOT NULL DEFAULT 0,
  minor INT NOT NULL DEFAULT 1,
  filename VARCHAR(255) NOT NULL,
  stored_name VARCHAR(120) NOT NULL,
  mime VARCHAR(120) DEFAULT 'application/octet-stream',
  ext VARCHAR(16) DEFAULT '',
  size BIGINT NOT NULL DEFAULT 0,
  sha256 CHAR(64) NOT NULL,
  comment VARCHAR(500) DEFAULT '',
  uploaded_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  extracted_text MEDIUMTEXT,
  text_source VARCHAR(8) NOT NULL DEFAULT '',
  ocr_confidence TINYINT NULL,
  ocr_pages SMALLINT NULL,
  ocr_at DATETIME NULL,
  KEY idx_ver_doc (document_id),
  KEY idx_ver_hash (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_meta (
  document_id INT NOT NULL,
  field_id INT NOT NULL,
  value TEXT,
  PRIMARY KEY (document_id, field_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_terms (
  document_id INT NOT NULL,
  term_id INT NOT NULL,
  field_id INT NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, term_id, field_id),
  KEY idx_dt_term (term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_links (
  document_id INT NOT NULL,
  related_id INT NOT NULL,
  PRIMARY KEY (document_id, related_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  version_id INT NOT NULL,
  requested_by INT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decision ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  decided_by INT NULL,
  decided_at DATETIME NULL,
  note VARCHAR(1000) DEFAULT '',
  KEY idx_appr_doc (document_id),
  KEY idx_appr_dec (decision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  user_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cmt_doc (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS favorites (
  user_id INT NOT NULL,
  document_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body VARCHAR(500) DEFAULT '',
  link VARCHAR(255) DEFAULT '',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notif_user (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(48) NOT NULL,
  object_type VARCHAR(24) DEFAULT '',
  object_id INT NULL,
  details VARCHAR(1000) DEFAULT '',
  ip VARCHAR(64) DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_obj (object_type, object_id),
  KEY idx_audit_user (user_id),
  KEY idx_audit_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS saved_searches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  query TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ss_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS access_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  library_id INT NOT NULL,
  level TINYINT NOT NULL DEFAULT 1,
  reason VARCHAR(500) DEFAULT '',
  status ENUM('open','granted','declined') NOT NULL DEFAULT 'open',
  decided_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_failures (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  user_id INT NULL,
  email VARCHAR(190) NOT NULL DEFAULT '',
  kind VARCHAR(16) NOT NULL DEFAULT 'password',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_af_ip (ip, created_at),
  KEY idx_af_user (user_id, ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS doc_counters (
  k VARCHAR(64) PRIMARY KEY,
  n INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mfa_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  selector CHAR(24) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  user_agent VARCHAR(255) DEFAULT '',
  ip VARCHAR(64) DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME NULL,
  expires_at DATETIME NOT NULL,
  UNIQUE KEY uq_mfa_sel (selector),
  KEY idx_mfa_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Toto, the built-in document assistant (v1.5)
CREATE TABLE IF NOT EXISTS ai_index (
  document_id INT PRIMARY KEY,
  version_id INT NOT NULL,
  text_hash CHAR(40) NOT NULL,
  tf MEDIUMTEXT NULL,
  vec MEDIUMTEXT NULL,
  minhash TEXT NULL,
  summary TEXT NULL,
  sens_info TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_upd (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_df (
  token VARCHAR(64) NOT NULL PRIMARY KEY,
  df INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS upload_stage (
  token CHAR(32) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  stored_name VARCHAR(64) NOT NULL,
  ext VARCHAR(16) NOT NULL DEFAULT '',
  mime VARCHAR(128) NOT NULL DEFAULT '',
  size BIGINT NOT NULL DEFAULT 0,
  sha256 CHAR(64) NOT NULL,
  extracted_text MEDIUMTEXT NULL,
  ocr_text MEDIUMTEXT NULL,
  ocr_full TINYINT(1) NOT NULL DEFAULT 0,
  ocr_confidence TINYINT NULL,
  ocr_pages SMALLINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_stage_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Toto: facts taught by administrators (v1.5.4)
CREATE TABLE IF NOT EXISTS toto_facts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject VARCHAR(190) NOT NULL,
  fact VARCHAR(600) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tf_subject (subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Request for input: one named person edits an Office document in Word/Excel/PowerPoint (v1.7)
CREATE TABLE IF NOT EXISTS input_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  version_id INT NOT NULL,
  requested_by INT NOT NULL,
  assignee_id INT NOT NULL,
  message VARCHAR(1000) NOT NULL DEFAULT '',
  due_date DATE NULL,
  status ENUM('open','done','cancelled','expired') NOT NULL DEFAULT 'open',
  dav_token CHAR(40) NOT NULL,
  work_stored_name VARCHAR(64) NULL,
  work_size BIGINT NULL,
  work_sha256 CHAR(64) NULL,
  work_saved_at DATETIME NULL,
  work_saves INT NOT NULL DEFAULT 0,
  lock_token VARCHAR(80) NULL,
  lock_expires DATETIME NULL,
  result_version_id INT NULL,
  done_comment VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  closed_by INT NULL,
  UNIQUE KEY uq_ir_token (dav_token),
  KEY idx_ir_doc (document_id, status),
  KEY idx_ir_assignee (assignee_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
