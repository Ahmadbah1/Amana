# État réel de votre installation — Supabase + Vercel

## Effectué par l'assistant
Projet Supabase `etomyyijwouxbagnnjun` :
- Migration `amana_v3_phone_accounts` appliquée (équivalent 003).
- Migration `amana_v3_reliability_audit_receipts` appliquée (équivalent 004).
- Migration `amana_v3_employee_invitations` appliquée (équivalent 005).
- Fonction `amana-employees` mise à jour, version serveur 2, statut ACTIVE ; elle contient le code v3 d'invitations privées.
- URL principale Auth : `https://amana-project.vercel.app/`.
- Redirections autorisées : cette URL, `https://amana-project.vercel.app/?invitation=1`, et l'ancienne adresse GitHub Pages.
- Rotation des refresh tokens conservée active.

Projet Vercel `amana-project` :
- Dépôt lié : Ahmadbah1/Amana, branche main.
- Installation : npm ci.
- Build : npm run build.
- Sortie : public_site.
- Racine du dépôt ; framework Other ; Node actuel 26.x, compatible avec le package.
- Aucun nouveau déploiement n'a été lancé, car les fichiers sur GitHub sont encore sous votre responsabilité.

**Ne pas réexécuter les fichiers SQL sur ce projet.** Ils sont fournis comme sources et pour une éventuelle installation neuve.

## Contrôles distants réalisés, sans création de compte ni envoi de message
- amana_health : HTTP 200, horodatage serveur reçu.
- verify_receipt avec jeton invalide : HTTP 200 / null, pas de données exposées.
- amana-employees sans authentification : HTTP 401 Unauthorized.
- Tables audit_events et employee_invitations présentes.
- INSERT, UPDATE et DELETE directs sur receipts : droits authenticated absents.
- Trigger de révocation des sessions présent.
- Le projet ne contenait aucune entreprise ni aucun reçu au contrôle préalable ; aucun faux compte ou reçu n'a été créé pour les tests distants.

## À faire maintenant sur GitHub
1. Décompresser l'archive.
2. Mettre son contenu à la racine du dépôt, en remplaçant les anciens fichiers ; ne pas ajouter un dossier parent dans le dépôt.
3. Conserver les sous-dossiers assets, sql, supabase, scripts, docs et tests ; conserver package-lock.json, build.mjs et vercel.json.
4. Ne pas publier .env, node_modules ou public_site.
5. Faire le commit sur main.
6. Vérifier le nouveau déploiement Vercel. Le projet indiquait une création automatique Git désactivée : si aucun build ne démarre, revenir dans la conversation et demander le déclenchement du déploiement main. Ne pas supposer que modifier les réglages a publié le nouveau code.

## Non effectué / limites du connecteur
- **SMTP** : aucun fournisseur personnalisé configuré ; les e-mails d'inscription et d'invitation dépendent encore du service par défaut Supabase et de ses restrictions. Un vrai SMTP reste à configurer avec vos paramètres fournisseur.
- **SMS** : Phone Auth reste désactivé, aucun fournisseur SMS renseigné. Les inscriptions par téléphone ne fonctionneront pas avant cette configuration.
- **Passkeys** : le code est prêt, mais `passkey_enabled` est encore false côté serveur. Le connecteur disponible ne permet pas de modifier ce réglage. Dans Supabase Authentication → Passkeys, activer avec RP ID `amana-project.vercel.app`, origine `https://amana-project.vercel.app`, nom Amana.
- **CAPTCHA** : non activé, aucune clé Turnstile disponible. Il faut configurer le secret dans Supabase et la clé publique dans config.js avant de présenter cette protection comme active.
- Aucun test réel de livraison, d'invitation suivie, de biométrie ou de compte à deux entreprises n'a été réalisé sur la production. Les tests locaux sont dans docs/TESTS-EFFECTUES.md.

Les guides complets sont dans docs/MISE-EN-SERVICE.md et docs/EMAIL-SMS-PASSKEYS.md. Ne communiquez pas les clés secrètes dans GitHub ni dans les fichiers publics.
