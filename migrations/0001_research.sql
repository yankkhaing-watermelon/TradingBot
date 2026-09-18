CREATE TABLE IF NOT EXISTS reports (
 hash TEXT PRIMARY KEY, report_date TEXT NOT NULL, generated_at TEXT NOT NULL,
 imported_at TEXT DEFAULT CURRENT_TIMESTAMP, origin TEXT, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_date ON reports(report_date DESC,generated_at DESC);
CREATE TABLE IF NOT EXISTS imports (
 id INTEGER PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 origin TEXT, report_hash TEXT, status TEXT, added INTEGER, repeated INTEGER
);
CREATE TABLE IF NOT EXISTS gmail_processed (id TEXT PRIMARY KEY, imported_at TEXT DEFAULT CURRENT_TIMESTAMP);
