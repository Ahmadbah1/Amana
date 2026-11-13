# Amana Business v3 — dossier complet GitHub → Vercel + Supabase

Cette version implémente les rubriques 1 à 4 : fiabilité en ligne, sécurité des employés, corrections traçables, PDF/partage/QR.

## IMPORTANT — votre projet est déjà préparé côté serveur
Pour **votre projet existant** `etomyyijwouxbagnnjun`, les migrations 003, 004 et 005 ont maintenant été appliquées par l'assistant, et la fonction `amana-employees` v3 a été déployée. **NE REJOUEZ PAS LES MIGRATIONS ET NE REDÉPLOYEZ PAS LA FONCTION POUR CETTE INSTALLATION.** Les commandes d'installation plus bas sont conservées pour une installation neuve uniquement.

Vercel `amana-project` est déjà configuré : `npm ci` → `npm run build` → `public_site`, racine du dépôt, Node actuellement 26.x (compatible avec engines >=22).

**Votre action : remplacer le contenu du dépôt GitHub par le contenu de ce dossier, puis lancer le déploiement de la branche main dans Vercel.** Aucun déploiement de l'ancien code n'a été relancé pendant la préparation. Les paramètres du projet indiquaient que la création automatique des déploiements Git était désactivée : après votre upload, si aucun déploiement ne démarre, demandez à l'assistant de déclencher le déploiement de la nouvelle branche main.

Lire `ETAT-INSTALLATION.md` pour les contrôles effectués et les réglages encore manquants : SMTP, SMS, CAPTCHA et activation serveur des passkeys. Ces fonctionnalités ne sont pas actives simplement parce que le code est fourni.

## Installation — suivre cet ordre

### 1. Sauvegarder
Sauvegarder la base Supabase et conserver une copie de l'ancien dépôt avant la mise à jour. Ne pas effacer les données ni recréer les tables existantes.

### 2. Appliquer les migrations Supabase
Dans le SQL Editor du projet `etomyyijwouxbagnnjun` :
- Si 001 et 002 sont déjà appliquées, **ne pas les rejouer**.
- Appliquer `sql/003_phone_accounts.sql` si cela n'a pas encore été fait.
- Appliquer **une seule fois** `sql/004_reliability_audit_receipts.sql`.
- Appliquer ensuite **une seule fois** `sql/005_employee_invitations.sql`.

Pour un projet totalement neuf : 001 → 002 → 003 → 004 → 005, dans cet ordre. Une migration est transactionnelle ; en cas d'erreur, ne pas continuer les étapes suivantes sans la résoudre. Les anciens reçus sont conservés. Les références de transaction déjà dupliquées dans l'historique ne sont pas effacées ; de nouveaux doublons sont bloqués. Un instantané des coordonnées actuelles de l'entreprise est ajouté aux anciens reçus (les coordonnées historiques exactes ne peuvent pas être reconstituées).

**Important :** 004 crée `amana_health`. Sans cette migration, le site affiche « Connexion Internet requise » même si votre connexion fonctionne, car la vérification serveur ne trouve pas son endpoint. L'ancien frontend n'est plus compatible avec la nouvelle émission sécurisée : coordonner la migration et le déploiement dans une fenêtre de maintenance.

### 3. Redéployer la fonction d'invitation
La fonction existante `amana-employees` doit être **remplacée par celle de ce dossier** : l'ancienne créait un mot de passe choisi par le gérant.

Avec Supabase CLI, depuis le dossier racine :
```
supabase login
supabase link --project-ref etomyyijwouxbagnnjun
supabase functions deploy amana-employees --no-verify-jwt
```
Le paramètre désactive uniquement le contrôle JWT de passerelle ; la fonction vérifie elle-même le jeton avec `auth.getUser`, puis le rôle et le statut du gérant. Ces vérifications sont obligatoires.

La variable serveur `AMANA_SITE_URL` est optionnelle ; par défaut elle vaut `https://amana-project.vercel.app/`. Pour un autre domaine, la définir dans les secrets de la fonction. Les clés `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournies par Supabase aux Edge Functions. Ne jamais publier la clé SERVICE_ROLE_KEY. La clé ANON et la clé publishable sont publiques par conception ; la sécurité des données repose sur les politiques RLS et les fonctions autorisées.

### 4. Remplacer les fichiers du dépôt GitHub
Mettre **le contenu de ce dossier à la racine** de `Ahmadbah1/Amana` ; ne pas placer le dossier lui-même dans un sous-dossier du dépôt. Conserver `.gitignore`, `package.json`, `package-lock.json`, `vercel.json`, `build.mjs` et les sources. Remplacer entièrement l'ancien index.html.

Ne pas publier `.env`, node_modules ou des secrets. `public_site` est généré au build ; il ne doit pas être committé. Les anciens app.html et anciens service workers ne sont plus nécessaires : retirer leurs références du site.

### 5. Vérifier Vercel
- Framework : Other
- Root Directory : racine du dépôt
- Node.js : 22.x ou version ultérieure compatible
- Installation : `npm ci`
- Build : `npm run build`
- Output Directory : `public_site`

Le fichier vercel.json définit ces commandes. Vérifier les éventuels réglages manuels contradictoires dans le Dashboard. Déployer, attendre READY puis ouvrir https://amana-project.vercel.app/.

### 6. Configurer Auth et les fournisseurs
Lire **docs/MISE-EN-SERVICE.md** et **docs/EMAIL-SMS-PASSKEYS.md**. Les envois nécessitent un vrai SMTP / fournisseur SMS. Aucun abonnement, domaine ou fournisseur n'a été activé à votre place.

## Structure
```
index.html  style.css  app.js  auth.js  features.js  config.js
build.mjs  package.json  package-lock.json  vercel.json
assets/fonts/             # police PDF embarquée et licence
sql/                      # migrations 001 à 005
supabase/functions/amana-employees/index.ts
scripts/configure-auth.mjs
.env.example              # modèle vide pour usage local optionnel
README.md  docs/  tests/
```

## Ce que fait la v3
### 1 — Fiabilité en ligne
- Blocage de l'interface si le réseau est coupé ou si le serveur ne répond pas ; nouvelle vérification à la reprise et toutes les 15 secondes. Contrôle avant émission, PDF, invitations et actions sensibles.
- État visible du reçu : brouillon, en cours, enregistré, réponse non confirmée.
- Clé UUID par émission, conservée en mémoire lors des tentatives. Le serveur renvoie le reçu existant pour la même demande ; un changement du contenu avec la même clé est refusé.
- Les champs sont figés après le premier envoi pour éviter qu'une nouvelle tentative crée un autre contenu. Pour modifier après un échec déterministe, quitter puis recommencer un nouveau brouillon.
- Unicité des TxID normalisés par entreprise ; une référence déjà utilisée est refusée, sauf lors d'un remplacement lié à ce même reçu. Vérification serveur du total et limite de 20 émissions/minute/employé.

### 2 — Employés et sécurité
- Invitation e-mail privée ; l'employé choisit lui-même son mot de passe après ouverture du lien.
- Un compte e-mail déjà existant n'est pas rattaché automatiquement à une entreprise : aucun transfert de compte implicite.
- Limite serveur de 10 invitations/heure/entreprise, délai de 2 minutes pour la même adresse ; les tentatives échouées comptent aussi.
- Révocation : RLS immédiate, suppression des sessions/refresh tokens serveur via trigger et détection dans l'interface sous 20 secondes. Les JWT déjà émis peuvent rester cryptographiquement valides jusqu'à expiration, mais ne donnent plus accès aux données de l'entreprise.
- Journal consultable par le gérant, non modifiable via le rôle applicatif ; événements sur reçus, profils, paramètres entreprise, signalements et invitations. Pas d'historique reconstitué avant installation, ni journalisation de chaque connexion Auth. L'administrateur de la base conserve techniquement ses pouvoirs sur les données.
- Passkeys et changement de mot de passe conservés. Protection CAPTCHA Turnstile intégrée en option ; activer le CAPTCHA **aussi côté Supabase** et renseigner la clé publique de config.js avant lancement public. Voir guide de mise en service.

### 3 — Corrections traçables
- Pas d'édition/suppression de reçu émis par les rôles applicatifs, y compris le gérant.
- L'employé signale un problème. Le gérant ouvre le reçu, annule avec motif ou crée un remplacement.
- L'annulation du reçu initial et l'émission du remplacement sont atomiques. Si le nouveau reçu est refusé, l'annulation n'est pas validée. Une seule liaison directe de remplacement par reçu ; un remplacement peut ensuite être lui-même remplacé avec un nouvel historique.
- Les reçus annulés restent visibles ; les montants confirmés du tableau de bord les excluent.
- Le gérant peut renseigner le traitement du signalement, conservé avec son auteur et sa date. La résolution du signalement est distincte de l'opération comptable, et doit être faite après correction.

### 4 — PDF / partage / QR
- PDF A4 ou ticket 80 mm (plusieurs pages si nécessaire), police et bibliothèques embarquées, logo et coordonnées figés à l'émission pour les nouveaux reçus.
- Partage du PDF via la feuille de partage du téléphone lorsque disponible ; sinon téléchargement à envoyer manuellement. Pas d'envoi automatique de PDF par SMS/e-mail au client.
- Les employés peuvent remettre le reçu courant après émission, sans interface d'archives. Une lecture ponctuelle autorisée par RPC de leurs propres reçus est nécessaire pour rafraîchir leur statut avant remise ; elle n'autorise pas ceux d'autrui.
- QR vers la vérification en ligne, sans authentification. Jeton long et non énumérable. Affichage limité : entreprise, numéro, date, total et statut annulé/remplacement. Aucun client, article, contact, employé ou TxID exposé.
- Le QR vérifie l'existence du reçu, **pas la réception du paiement**. Un PDF déjà téléchargé ne peut pas être effacé ou mis à jour rétroactivement : le statut courant est vérifiable par son QR.
- Les reçus structurés restent en PostgreSQL ; les PDF sont générés à la demande, pas archivés automatiquement comme fichiers. Les exports Excel sont archivés dans le bucket privé existant.

## Limites / précautions
- Le mode en ligne bloque l'utilisation, pas la possibilité technique d'inspecter le code ni de conserver des fichiers téléchargés ou des captures. Aucun site web ne peut rappeler ces copies. Les brouillons sont uniquement en mémoire, perdus au rechargement ; aucune sauvegarde hors ligne de reçus.
- Sans TxID, la clé de demande protège les nouvelles tentatives dans le même écran. Après fermeture/rechargement complet, une nouvelle saisie sans TxID peut être un doublon humain : vérifier les archives côté gérant avant de réémettre un paiement incertain.
- Si une invitation échoue, vérifier SMTP et historique Auth. En cas de compte déjà créé pendant un incident d'envoi, le destinataire peut utiliser la récupération de mot de passe sur son e-mail lorsque le SMTP fonctionne. Ne pas supprimer des comptes pour « débloquer » sans vérifier leur entreprise et leurs données.
- L'OCR nécessite encore un téléchargement tiers à la demande ; saisie manuelle disponible. Aucun paiement réel n'est vérifié par Amana.
- Les anciens historiques locaux ne sont pas migrés automatiquement.
- Avant exploitation : configurer SMTP, SMS si utilisés, CAPTCHA serveur, quotas et alertes de coût SMS ; tester isolation réelle, invitations, sauvegardes, rôles et mobile. Renouveler le mot de passe initial de base de données depuis Supabase et vérifier les conditions de votre forfait Vercel pour un usage commercial.

## Tests fournis et réalisés
- `npm run test:db` : PostgreSQL embarqué PGlite avec schémas Auth/Storage simulés ; application des 5 migrations et tests RLS, total, idempotence, TxID, immutabilité, rôles, isolation, annulation/remplacement, confidentialité QR, audit, invitation et révocation. Ce n'est pas un test de votre projet Supabase distant ni de son service Auth.
- `npm run test:browser` : Chromium, Auth simulée ; démarrage sans CDN, trois langues, écran OTP, mobile 390 px, retry après réponse incertaine, PDF A4/ticket, blocage hors ligne, restrictions de navigation employé et page publique de vérification.
- Dépendances npm de production : audit sans vulnérabilité signalée au moment de la préparation ; ce constat n'est pas une garantie de sécurité.
- Non testés réellement : livraison e-mails/SMS, liens d'invitation émis par Auth, passkeys sur appareil physique, impression thermique et WhatsApp natif. Suivre **docs/RECETTE.md** avant ouverture aux clients.

Pour rejouer localement : `npm ci`, `npm run build`, `npm run preview` (port 3001), puis `npx playwright install --with-deps chromium` et `npm test` dans un autre terminal.
