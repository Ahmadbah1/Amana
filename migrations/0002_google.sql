-- Copie automatique vers le Google Drive / Sheets du propriétaire
CREATE TABLE google(org_id TEXT PRIMARY KEY,refresh_enc TEXT NOT NULL,at_enc TEXT,at_exp INTEGER NOT NULL DEFAULT 0,email TEXT,folder_id TEXT NOT NULL,sheet_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ok',connected_at INTEGER NOT NULL);
CREATE TABLE gfolders(org_id TEXT NOT NULL,k TEXT NOT NULL,drive_id TEXT NOT NULL,PRIMARY KEY(org_id,k));
CREATE TABLE gmap(receipt_id TEXT PRIMARY KEY,sheet_row INTEGER NOT NULL,art INTEGER NOT NULL DEFAULT 0);
CREATE TABLE gfiles(receipt_id TEXT PRIMARY KEY,file_id TEXT NOT NULL);
CREATE TABLE receipt_files(receipt_id TEXT PRIMARY KEY,png TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE sync_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,org_id TEXT NOT NULL,kind TEXT NOT NULL,ref TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0,error TEXT);
CREATE INDEX idx_sq ON sync_queue(org_id,done,next_at);
CREATE TRIGGER rf_noupdate BEFORE UPDATE ON receipt_files BEGIN SELECT RAISE(ABORT,'image is immutable'); END;
CREATE TRIGGER rf_nodelete BEFORE DELETE ON receipt_files BEGIN SELECT RAISE(ABORT,'image is immutable'); END;
