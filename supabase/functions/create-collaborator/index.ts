-- ============================================================
-- AMANA — schéma complet et sécurisé (nouveau projet Supabase)
-- Exécuter en entier dans SQL Editor.
-- ============================================================

-- 1. TABLES -------------------------------------------------
CREATE TABLE stores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  logo_url TEXT,
  receipt_footer TEXT DEFAULT 'Merci de votre confiance !',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('manager', 'collaborator', 'employee')) NOT NULL DEFAULT 'employee',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  operator TEXT CHECK (operator IN ('MTN', 'ORANGE')) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  transaction_ref TEXT NOT NULL,
  customer_phone TEXT,
  items_summary TEXT,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  quantity INT,
  input_method TEXT CHECK (input_method IN ('OCR', 'MANUAL')) NOT NULL,
  status TEXT CHECK (status IN ('VALID', 'FLAGGED', 'CANCELLED')) DEFAULT 'VALID',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Une même référence ne peut pas être saisie deux fois (sauf si le reçu a été annulé)
CREATE UNIQUE INDEX receipts_unique_ref
  ON receipts (store_id, transaction_ref) WHERE status <> 'CANCELLED';
CREATE INDEX receipts_store_date ON receipts (store_id, created_at DESC);

CREATE TABLE incident_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  receipt_id UUID REFERENCES receipts(id) ON DELETE CASCADE NOT NULL,
  reported_by UUID REFERENCES profiles(id) NOT NULL,
  reason TEXT NOT NULL,
  suggested_amount NUMERIC(12, 2) CHECK (suggested_amount IS NULL OR suggested_amount > 0),
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Historique d'audit des corrections de reçus
CREATE TABLE receipt_audit (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id UUID REFERENCES receipts(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  old_amount NUMERIC(12, 2),
  new_amount NUMERIC(12, 2),
  old_status TEXT,
  new_status TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. FONCTIONS D'ACCÈS --------------------------------------
CREATE OR REPLACE FUNCTION public.has_store_access(sid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM stores s WHERE s.id = sid AND s.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.store_id = sid AND p.is_active);
$$;

CREATE OR REPLACE FUNCTION public.is_store_manager(sid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM stores s WHERE s.id = sid AND s.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.store_id = sid
                 AND p.is_active AND p.role IN ('manager', 'collaborator'));
$$;

-- 3. INSCRIPTION GÉRANT : création boutique + profil par trigger
--    (fonctionne aussi quand la confirmation email est activée)
CREATE OR REPLACE FUNCTION public.handle_new_manager() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_store UUID;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'store_name', '') <> '' THEN
    INSERT INTO stores (name, owner_id)
      VALUES (LEFT(NEW.raw_user_meta_data->>'store_name', 120), NEW.id)
      RETURNING id INTO new_store;
    INSERT INTO profiles (id, store_id, full_name, role)
      VALUES (NEW.id, new_store, COALESCE(LEFT(NEW.raw_user_meta_data->>'full_name', 120), 'Gérant'), 'manager');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_manager();

-- 4. RPC : création atomique d'un reçu + décrémentation du stock
CREATE OR REPLACE FUNCTION public.create_receipt(
  p_store_id UUID, p_operator TEXT, p_amount NUMERIC, p_ref TEXT, p_phone TEXT,
  p_product_id UUID, p_qty INT, p_input_method TEXT
) RETURNS receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT; v_item TEXT; v_row receipts; v_ref TEXT := UPPER(TRIM(COALESCE(p_ref, '')));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;
  IF NOT has_store_access(p_store_id) THEN RAISE EXCEPTION 'Accès refusé à cette boutique'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'Profil inactif ou introuvable';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;
  IF v_ref = '' THEN RAISE EXCEPTION 'Référence obligatoire'; END IF;

  IF p_product_id IS NOT NULL THEN
    IF COALESCE(p_qty, 0) < 1 THEN RAISE EXCEPTION 'Quantité invalide'; END IF;
    UPDATE products SET stock_quantity = stock_quantity - p_qty
      WHERE id = p_product_id AND store_id = p_store_id AND stock_quantity >= p_qty
      RETURNING name INTO v_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuffisant ou article introuvable'; END IF;
    v_item := p_qty || 'x ' || v_name;
  END IF;

  INSERT INTO receipts (store_id, user_id, operator, amount, transaction_ref, customer_phone,
                        items_summary, product_id, quantity, input_method)
  VALUES (p_store_id, auth.uid(), p_operator, p_amount, v_ref, NULLIF(TRIM(COALESCE(p_phone, '')), ''),
          v_item, p_product_id, CASE WHEN p_product_id IS NULL THEN NULL ELSE p_qty END, p_input_method)
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Cette référence de transaction existe déjà pour cette boutique';
END $$;

-- 5. Signalement : le reçu passe en FLAGGED automatiquement
CREATE OR REPLACE FUNCTION public.flag_receipt_on_incident() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE receipts SET status = 'FLAGGED' WHERE id = NEW.receipt_id AND status = 'VALID';
  RETURN NEW;
END $$;

CREATE TRIGGER on_incident_created
  AFTER INSERT ON incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.flag_receipt_on_incident();

-- 6. RPC : résolution d'un signalement (avec audit)
--    p_action : 'apply' (corriger le montant) | 'dismiss' (valider tel quel) | 'cancel' (annuler le reçu)
CREATE OR REPLACE FUNCTION public.resolve_incident(p_report_id UUID, p_action TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r incident_reports; rc receipts;
BEGIN
  SELECT * INTO r FROM incident_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signalement introuvable'; END IF;
  IF NOT is_store_manager(r.store_id) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
  IF r.is_resolved THEN RAISE EXCEPTION 'Signalement déjà clôturé'; END IF;

  SELECT * INTO rc FROM receipts WHERE id = r.receipt_id FOR UPDATE;

  IF p_action = 'apply' THEN
    IF r.suggested_amount IS NULL THEN RAISE EXCEPTION 'Aucun montant suggéré'; END IF;
    IF rc.status = 'CANCELLED' THEN RAISE EXCEPTION 'Reçu déjà annulé'; END IF;
    INSERT INTO receipt_audit (receipt_id, store_id, changed_by, old_amount, new_amount, old_status, new_status, reason)
      VALUES (rc.id, rc.store_id, auth.uid(), rc.amount, r.suggested_amount, rc.status, 'VALID', r.reason);
    UPDATE receipts SET amount = r.suggested_amount, status = 'VALID' WHERE id = rc.id;

  ELSIF p_action = 'dismiss' THEN
    IF rc.status = 'FLAGGED' THEN
      INSERT INTO receipt_audit (receipt_id, store_id, changed_by, old_amount, new_amount, old_status, new_status, reason)
        VALUES (rc.id, rc.store_id, auth.uid(), rc.amount, rc.amount, rc.status, 'VALID', 'Signalement rejeté : ' || r.reason);
      UPDATE receipts SET status = 'VALID' WHERE id = rc.id;
    END IF;

  ELSIF p_action = 'cancel' THEN
    IF rc.status = 'CANCELLED' THEN RAISE EXCEPTION 'Reçu déjà annulé'; END IF;
    INSERT INTO receipt_audit (receipt_id, store_id, changed_by, old_amount, new_amount, old_status, new_status, reason)
      VALUES (rc.id, rc.store_id, auth.uid(), rc.amount, rc.amount, rc.status, 'CANCELLED', r.reason);
    UPDATE receipts SET status = 'CANCELLED' WHERE id = rc.id;
    IF rc.product_id IS NOT NULL AND COALESCE(rc.quantity, 0) > 0 THEN
      UPDATE products SET stock_quantity = stock_quantity + rc.quantity WHERE id = rc.product_id;
    END IF;

  ELSE
    RAISE EXCEPTION 'Action invalide';
  END IF;

  UPDATE incident_reports SET is_resolved = TRUE WHERE id = r.id;
END $$;

-- 7. RPC : réapprovisionnement atomique et activation/désactivation d'un membre
CREATE OR REPLACE FUNCTION public.restock_product(p_product_id UUID, p_qty INT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store UUID;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RAISE EXCEPTION 'Quantité invalide'; END IF;
  SELECT store_id INTO v_store FROM products WHERE id = p_product_id;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Article introuvable'; END IF;
  IF NOT is_store_manager(v_store) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
  UPDATE products SET stock_quantity = stock_quantity + p_qty WHERE id = p_product_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_profile_active(p_profile_id UUID, p_active BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store UUID; v_owner UUID;
BEGIN
  SELECT store_id INTO v_store FROM profiles WHERE id = p_profile_id;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Profil introuvable'; END IF;
  IF NOT is_store_manager(v_store) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
  IF p_profile_id = auth.uid() THEN RAISE EXCEPTION 'Vous ne pouvez pas modifier votre propre accès'; END IF;
  SELECT owner_id INTO v_owner FROM stores WHERE id = v_store;
  IF p_profile_id = v_owner THEN RAISE EXCEPTION 'Le propriétaire ne peut pas être désactivé'; END IF;
  UPDATE profiles SET is_active = p_active WHERE id = p_profile_id;
END $$;

-- 8. DROITS D'EXÉCUTION -------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.has_store_access(UUID), public.is_store_manager(UUID),
  public.create_receipt(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INT, TEXT),
  public.resolve_incident(UUID, TEXT), public.restock_product(UUID, INT),
  public.set_profile_active(UUID, BOOLEAN)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.has_store_access(UUID), public.is_store_manager(UUID),
  public.create_receipt(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INT, TEXT),
  public.resolve_incident(UUID, TEXT), public.restock_product(UUID, INT),
  public.set_profile_active(UUID, BOOLEAN)
TO authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_manager(), public.flag_receipt_on_incident()
FROM PUBLIC, anon, authenticated;

-- 9. ROW LEVEL SECURITY -------------------------------------
ALTER TABLE stores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_audit    ENABLE ROW LEVEL SECURITY;

-- stores
CREATE POLICY stores_select ON stores FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR has_store_access(id));
CREATE POLICY stores_insert ON stores FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'manager' AND p.is_active));
CREATE POLICY stores_update ON stores FOR UPDATE TO authenticated
  USING (is_store_manager(id)) WITH CHECK (is_store_manager(id));
-- Seules ces colonnes sont modifiables côté client (pas owner_id)
REVOKE UPDATE ON stores FROM authenticated;
GRANT UPDATE (name, logo_url, receipt_footer) ON stores TO authenticated;

-- profiles : lecture seule côté client (écriture via trigger / Edge Function / RPC)
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_store_manager(store_id));

-- products
CREATE POLICY products_select ON products FOR SELECT TO authenticated USING (has_store_access(store_id));
CREATE POLICY products_insert ON products FOR INSERT TO authenticated WITH CHECK (is_store_manager(store_id));
CREATE POLICY products_update ON products FOR UPDATE TO authenticated
  USING (is_store_manager(store_id)) WITH CHECK (is_store_manager(store_id));
CREATE POLICY products_delete ON products FOR DELETE TO authenticated USING (is_store_manager(store_id));

-- receipts : lecture seule côté client (écriture via RPC)
CREATE POLICY receipts_select ON receipts FOR SELECT TO authenticated
  USING (is_store_manager(store_id) OR (user_id = auth.uid() AND has_store_access(store_id)));

-- incident_reports
CREATE POLICY incidents_select ON incident_reports FOR SELECT TO authenticated
  USING (is_store_manager(store_id) OR reported_by = auth.uid());
CREATE POLICY incidents_insert ON incident_reports FOR INSERT TO authenticated
  WITH CHECK (
    reported_by = auth.uid() AND has_store_access(store_id) AND EXISTS (
      SELECT 1 FROM receipts r WHERE r.id = receipt_id AND r.store_id = incident_reports.store_id
        AND (r.user_id = auth.uid() OR is_store_manager(r.store_id))));

-- receipt_audit
CREATE POLICY audit_select ON receipt_audit FOR SELECT TO authenticated USING (is_store_manager(store_id));

-- 10. TEMPS RÉEL --------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE receipts, incident_reports, products;

-- ============================================================
-- MIGRATION d'une base EXISTANTE (au lieu de tout recréer) :
--   ALTER TABLE receipts ADD COLUMN product_id UUID REFERENCES products(id) ON DELETE SET NULL;
--   ALTER TABLE receipts ADD COLUMN quantity INT;
--   puis exécuter les sections 1 (receipt_audit, index uniques), 2 à 9.
--   Attention : l'index unique échoue s'il existe déjà des doublons de transaction_ref.
-- ============================================================
