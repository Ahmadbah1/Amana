-- Super administrateur de la plateforme + abonnements Premium par entreprise
CREATE TABLE platform_admins(user_id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
CREATE TABLE subscriptions(org_id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
-- Historique des attributions et des paiements enregistrés : écriture seule
CREATE TABLE grants(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,admin_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('grant','revoke')),months INTEGER NOT NULL DEFAULT 0,amount INTEGER NOT NULL DEFAULT 0,method TEXT,ref TEXT,note TEXT,starts_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX idx_grants_org ON grants(org_id,created_at);
CREATE TRIGGER gr_noupdate BEFORE UPDATE ON grants BEGIN SELECT RAISE(ABORT,'grants are append-only'); END;
CREATE TRIGGER gr_nodelete BEFORE DELETE ON grants BEGIN SELECT RAISE(ABORT,'grants are append-only'); END;
