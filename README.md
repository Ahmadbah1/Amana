# Amana

Application SaaS de caisse / reçus de paiement pour commerçants
(MTN MoMo, Orange Money). PWA mono-page, interface française.

## Chaîne de liens (architecture)

```
index.html  ──►  Vercel amana-site (production)
    │
    │  SUPABASE_URL + SUPABASE_ANON
    ▼
Supabase projet « amana-prod »  rggqvjrzjswxrtgsnzfo (eu-central-1, free)
    ├── schema.sql                     (migrations initial_schema → harden_schema
    │                                    → add_receipts_tx_unique_index → drop_dead_permissions
    │                                    → add_stock_tables → add_stock_sync_receipts → add_stock_rpcs)
    │     └── tables, RLS, fonctions (create_organization, create_receipt,
    │         cancel_receipt, set_permissions, audit_log,
    │         create_product/update_product/adjust_stock/delete_product), publication temps réel
    ├── supabase/functions/staff/index.ts   (déployée comme fonction « staff »)
    │     └── comptes employés (création, réactivation, mot de passe) — réservée au gérant
    └── net/realtime : publication sur `receipts`

app.html  →  redirection vers index.html (compatibilité des anciens liens)
icon-192.png  →  logo / favicon / splash
```

## Clés et configuration (publique par design)

La clé **publishable** (anon) est écrite en dur dans `index.html` — c'est
volontaire : elle est publique par design, protégée par les règles RLS
de Postgres. Le moindre accès aux données exige une session authentifiée.

**Ne jamais** mettre la clé `service_role` dans ce dossier (serveur uniquement,
jamais exposé au navigateur). Elle ne figure nulle part ici.

## Déploiement

### 1) Supabase — une seule fois par projet

```bash
# Variables d'environnement (jamais commitées) :
#   SUPABASE_URL  et  SUPABASE_ANON  déjà dans index.html
#   (la clé publishable est publique par design — voir ci-dessus)

# Schéma
supabase link --project-ref rggqvjrzjswxrtgsnzfo
supabase db push            # ou : SQL Editor > colle schema.sql + migration durcissement

# Fonction staff
supabase functions deploy staff

# Temps réel (une seule fois)
# alter publication supabase_realtime add table public.receipts;
```

### 2) Vercel — déploiement de l'app

Le projet **amana-site** (team `team_pwx913088X55ZJ0jGuEOmg2V`) est lié au repo.

```bash
vercel link                # lien local (une fois)
vercel --prod              # ou : créer un déploiement git via le connector Vercel
```

Le projet sert la racine (`outputDirectory: "."`, framework null).
Ne pas committer `.vercel/` (déjà dans `.gitignore`).

### 3) GitHub

```bash
git push origin arena/bf81ea2b-amana   # branche → déclenche le déploiement si auto-deploy ON
git push origin main                    # seulement après relecture/pull request
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Application complète (frontend). Config Supabase en dur, protégée par RLS. |
| `app.html` | Redirection → `index.html`. |
| `manifest.webmanifest` | Manifest PWA (installable : standalone, thème #072652). |
| `service-worker.js` | Service worker : cache-first pour les actifs, network-first pour le HTML ; API Supabase jamais mise en cache. |
| `icon.svg` / `icon-192.png` / `icon-512.png` | Icônes PWA (logo authentique). |
| `tests/tests.mjs` | Tests statiques + parseSms (aucune dépendance) : `npm test`. |
| `tests/smoke.mjs` | Test de fumée navigateur (Chromium) : `npm run test:smoke` (nécessite `npx playwright install chromium`). |
| `schema.sql` | Schéma Postgres (tables, RLS, fonctions RPC, publication realtime). |
| `supabase/config.toml` | `project_id` = `rggqvjrzjswxrtgsnzfo` + `[functions.staff] verify_jwt`. |
| `supabase/functions/staff/index.ts` | Fonction edge gérants → employés. |
| `.gitignore` | Jamais de secrets dans le repo. |

## Points de vigilance

- La **clé `service_role`** reste dans Supabase (dashboard/Functions secrets), jamais ici, jamais dans la page.
- Le **temps réel** (`alter publication ... add table public.receipts;`) est à vérifier
  avant usage — sans lui, une bannière « Temps réel indisponible » s'affiche et l'app
  recharge toutes les 30 s (filet de sécurité intégré).
- L'**index unique** `receipts_tx_unique` sur `(shop_id, tx_id)` est appliqué dans la
  base (dédoublonnage des transactions). Il reste documenté dans `schema.sql`.
- La fonction `staff` en production n'autorise que le **gérant** (`role='owner'`).
- Le CORS de `staff` est restreint au domaine réel (`https://amana-ahmad.vercel.app`).
- Les reçus chargés sont limités aux **150 plus récents** (bannière d'aperçu affichée
  dans la liste ; filtres + export CSV pour aller plus loin).

## Stock / inventaire (réservé au gérant)

Un module de gestion de stock réservé au gérant (onglet 📦 Stock, masqué pour
les employés — côté frontend, RLS et RPC) :

- **Tables** : `products` (nom, unité, quantité, seuil minimum, prix de vente)
  et `stock_movements` (historique des mouvements : vente, annulation,
  ajustement manuel). RLS gérant-only ; lecture seule pour les employés.
- **Synchronisation automatique** : à chaque reçu créé, les articles dont le
  nom correspond au produit sont débités (`source='receipt'`) ; une
  annulation de reçu restaure le stock (`source='receipt_cancel'`).
- **Journal** : chaque mouvement est journalisé (`stock_movements`) et les
  opérations manuelles (création/ajustement/suppression) sont aussi loggées
  dans `audit_log` (`stock.create`, `stock.adjust`, `stock.delete`).
- **Matching** : comparaison = nom normalisé (minuscules, sans accents ni
  ponctuation) pour raccorder un article saisi au produit enregistré.
- **UX** : recherche en direct dans la liste des produits, bouton ⬇ CSV
  (export exportable avec BOM et quoting anti-formule, compatible Excel),
  fiche reçu affiche le détail du stock débité, toasts distinguent
  « stock ajusté » vs « 0 article(s) reconnu(s) ».
- **Vérification post-déploiement** : `npm run check:served` re-télécharge la
  page servie et compare le sha256/octets avec `index.html` local — il échoue
  tant que la production n'a pas été re-déployée.

## Tests

```bash
npm test               # tests statiques (syntaxe, manifest, icônes, ids, parseSms, stock) — aucune dépendance
npm run test:smoke     # fumée navigateur — page réelle, CDN réels — nécessite playwright
npm run test:e2e       # scénario complet gérant dans Chromium (stub Supabase local, aucune donnée de production) — incl. onglet Stock (présentation, recherche, export)
npm run check:served   # vérifie que la production sert exactement le fichier local (sha256) — après chaque déploiement
npm run test:all       # test + smoke + e2e enchaînés
```

## Nouveautés (v1.1.0)

- **PWA installable** : manifeste + icônes 192/512 + service worker (cache-first pour
  les actifs, network-first pour le HTML — jamais de cache pour l'API Supabase).
- **Filtres avancés des reçus** : statut, mode de paiement, plage de dates (à côté des
  puces Tous/Aujourd'hui/Annulés) + bannière de limite des 150 reçus.
- **OCR en priorité texte** : la saisie du texte du SMS est en tête de liste ; la photo
  (Tesseract, sur l'appareil) est en secours avec une barre de progression visible ;
  la saisie manuelle reste toujours disponible.
- **Statistiques** (onglet 📊, lié à la permission `view_stats`) : ventes / reçus du
  jour et du mois, par mode de paiement, par statut, annulations.
- **Gérant** : peut créer des reçus comme un employé (même bouton +), sans droits
  supplémentaires ; badge « Gérant » dans l'en-tête.
- **Permissions mortes supprimées** : `edit_price`, `manage_stock` (sans logique) —
  retirées du frontend et de `set_permissions` (migration `drop_dead_permissions`).

## Nouveautés (v1.5.0)

- **Politique employé allégée** : le gérant crée/change le mot de passe d'un employé avec une politique allégée —
  **8 caractères minimum + minuscule + majuscule + chiffre**, sans dictionnaire de mots communs (l'employé est limité
  au niveau des actions par la matrice de droits). La politique **stricte** (12+/min/maj/chiffre/sans mot commun)
  s'applique au gérant (signup + changement self-service). Frontend et fonction staff serveur (v7).
- **Création de reçu — validation locale précis article par article** : avant l'envoi, chaque article est vérifié
  localement (étiquette vide → « Paiement », quantité ≥ 1, prix ≥ 1, plafonds alignés sur la RPC). En cas d'erreur :
  toast article par article (« Article 1 : prix requis (≥ 1) ») + ligne surlignée en rouge, aucun appel réseau.
  La RPC `create_receipt` reste la référence finale.
- **Analytique permanente** : l'onglet Analytique est calculé **une fois** puis conservé en local (localStorage,
  clé par utilisateur + boutique). Il n'est plus recalculé à chaque ouverture : il est invalidé et recalculé uniquement
  après une action (création/annulation de reçu, ajout/maj/suppression/ajustement de stock). **Suppression de la
  limite 1500 reçus** : le calcul porte sur l'historique complet (les tableaux des 30 derniers jours et des mois
  précédents utilisent désormais tous les reçus).

## Nouveautés (v1.4.1)

- **Mots de passe communs refusés** : la politique 12 caractères + min/maj/chiffre est complétée par un
  dictionnaire de ~155 mots de passe communs (casse et espaces ignorés) — signup gérant, création employé,
  changement employé, changement self-service — frontend et fonction staff serveur, une seule politique.
  Message d'erreur explicite : « choisissez un mot de passe moins commun ».
- **Journal du changement self-service** : RPC `log_auth_self_service` (SECURITY DEFINER, seuls les actions
  autorisées, caller doit être l'employé lui-même) insère dans `audit_log` une entrée `auth.password`
  (`self_service: true`) après chaque changement self-service (best effort : un échec d'audit n'annule jamais
  le changement). Le journal (Réglages → Activité) affiche « a changé son mot de passe » sans répéter le nom.

## Nouveautés (v1.4.0)

- **Politique mot de passe robuste** : 12 caractères minimum + minuscule + majuscule + chiffre
  (signup gérant, création employé, changement employé, changement self-service — frontend et fonction staff
  serveur côté une seule politique). Champ mot de passe masqué (`type=password`). Indicateur de force
  affiché pendant la saisie (faible / moyen / fort).
- **Mot de passe oublié ?** (signup gérant) : lien `resetPasswordForEmail`. Les comptes employés (email
  synthétique `xxx@staff.amana.app`) ne reçoivent pas d'email — le gérant reste le seul à les réinitialiser.
- **Changement de mot de passe self-service** (tous les comptes) : section « Sécurité » dans Réglages —
  mot de passe actuel (re-authentifié) puis nouveau + confirmation. Fonctionnement par email re-authentifié ;
  note : un changement self-service n'invalide pas nécessairement les autres sessions (la réinitialisation par
  le gérant via staff.password invalide les sessions).

## Nouveautés (v1.3.0)

- **Analytique / Dashboard (réservé au gérant)** : nouvel onglet 📈 Analytique,
  recalculé à chaque ouverture depuis les reçus, membres, produits et mouvements :
  CA du jour/mois, panier moyen, croissance vs mois précédent, taux d'annulation ;
  courbe du CA sur 30 jours (SVG inline), anneau de statuts de paiement, CA par
  mode de paiement, **couverture des droits** (par droit × employé actif), CA par
  employé, valeur du stock + valeur à risque + mouvements du mois par source ;
  graphique et KPIs reconstruits à chaque ouverture.
- **Compétences déclarées des employés** : nouvelle colonne `members.skills` (texte,
  virgule) + RPC gérant-only `update_member_skills` (journalisé dans `audit_log`) ;
  saisie dans Équipe → employé → « Compétences », affichée avec les compétences de
  l'équipe et leur fréquence sur l'onglet Analytique.

## Nouveautés (v1.2.0)

- **Stock / inventaire** (réservé au gérant) : table `products` + `stock_movements`,
  RLS gérant-only, RPC de création/ajustement/suppression ; synchronisation automatique
  avec les reçus (débit à la création, restauration à l'annulation) et journal des
  mouvements ; matching par nom normalisé.
- **UX Stock** : recherche en direct, export CSV (BOM + quoting anti-formule),
  bannière « Stock débité » sur la fiche reçu, toasts clairs (0 article reconnu vs
  ajustement effectué), reset du filtre à chaque changement de boutique.
- **Déploiement** : en-têtes de sécurité dans `vercel.json` (nosniff, frame DENY,
  Referrer-Policy, Permissions-Policy, no-cache pour le HTML) + script
  `check:served` (sha256 servi vs local) pour vérifier toute mise en production.
