-- Amana entreprise : base D1 (SQLite). Les reçus sont en écriture seule (non modifiables, non supprimables).
CREATE TABLE orgs(id TEXT PRIMARY KEY,name TEXT NOT NULL,niu TEXT,created_at INTEGER NOT NULL);
CREATE TABLE shops(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,city TEXT,tel TEXT,code TEXT NOT NULL,seq INTEGER NOT NULL DEFAULT 0);
CREATE TABLE users(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,shop_id TEXT,role TEXT NOT NULL CHECK(role IN('owner','employee')),name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,pw TEXT NOT NULL,salt TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,fails INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
CREATE TABLE receipts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,shop_id TEXT NOT NULL,user_id TEXT NOT NULL,number TEXT NOT NULL,client_ref TEXT,created_at INTEGER NOT NULL,client TEXT,method TEXT,txid TEXT,pay_status TEXT,total INTEGER NOT NULL,items TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'valid' CHECK(state IN('valid','flagged','void')),UNIQUE(shop_id,number),UNIQUE(user_id,client_ref));
CREATE TABLE flags(id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL,user_id TEXT NOT NULL,reason TEXT NOT NULL,comment TEXT,created_at INTEGER NOT NULL,decision TEXT,decided_by TEXT,decided_at INTEGER);
CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,org_id TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,target TEXT,at INTEGER NOT NULL,detail TEXT);
CREATE INDEX idx_rc_org ON receipts(org_id,created_at);
CREATE INDEX idx_rc_user ON receipts(user_id,created_at);
-- Garde-fous au niveau de la base : seul "state" d'un reçu peut changer
CREATE TRIGGER rc_immutable BEFORE UPDATE OF org_id,shop_id,user_id,number,client_ref,created_at,client,method,txid,pay_status,total,items ON receipts BEGIN SELECT RAISE(ABORT,'receipt is immutable'); END;
CREATE TRIGGER rc_nodelete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'receipts cannot be deleted'); END;
CREATE TRIGGER au_noupdate BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
CREATE TRIGGER au_nodelete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
