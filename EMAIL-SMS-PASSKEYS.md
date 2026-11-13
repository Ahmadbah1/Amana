# Activation réelle des e-mails, SMS et passkeys

Le code frontend est prêt, mais aucun fournisseur payant ni domaine n'a été créé par ce dossier. Un déploiement seul n'active pas la livraison des messages. Les paramètres ci-dessous se configurent dans Supabase, pas dans GitHub ou le frontend.

## 1. E-mails : SMTP Brevo (recommandation)
1. Ouvrir un compte Brevo et activer son service d'e-mails transactionnels.
2. Ajouter et vérifier l'expéditeur. Pour la production, utiliser un domaine possédé et installer les DNS demandés par Brevo (authentification du domaine). Une adresse vercel.app n'est pas un domaine d'expédition dont vous contrôlez les DNS.
3. Récupérer les paramètres SMTP de votre compte Brevo : hôte, port, identifiant et **clé SMTP**. Ne pas utiliser une clé API à la place d'une clé SMTP.
4. Supabase → Authentication → Email / SMTP Settings : activer le SMTP personnalisé. Copier les valeurs du fournisseur ; choisir « Amana » comme nom d'expéditeur, et l'adresse vérifiée comme adresse d'envoi.
5. Garder la confirmation e-mail activée dans les réglages du fournisseur Email de Supabase Auth.
6. Dans les modèles de confirmation et de récupération, conserver le lien `{{ .ConfirmationURL }}` ; ne pas le remplacer par l'URL brute de l'application.
7. Effectuer une inscription avec votre propre adresse réelle ; vérifier la réception puis cliquer sur le lien. Les messages passent par Supabase Auth → SMTP, sans clé secrète dans le navigateur.

Le lien confirme la création du compte. Aucun second e-mail de bienvenue distinct n'est implémenté. En v3, les employés reçoivent un lien d'invitation privé via la nouvelle Edge Function et choisissent leur propre mot de passe ; le SMTP doit être configuré pour ces invitations également.

Documentation : https://supabase.com/docs/guides/auth/auth-smtp

## 2. SMS : Twilio via Supabase Auth
1. Créer un compte Twilio, vérifier votre compte et provisionner un expéditeur / Messaging Service capable d'envoyer vers les pays visés. Vérifier les règles d'expédition, tarifs, autorisations géographiques et éventuelles restrictions de compte d'essai, notamment pour le Cameroun (+237).
2. Récupérer Account SID, Auth Token et Messaging Service SID dans Twilio.
3. Supabase → Authentication → Sign In / Providers → Phone : activer Phone, sélectionner Twilio et saisir ces valeurs. Garder la vérification du numéro activée (pas d'auto-confirmation).
4. Modèle SMS : `Votre code Amana : {{ .Code }}. Ne le partagez avec personne.`
5. Dans Amana, choisir « Créer mon entreprise » → « Téléphone ». Utiliser le format international, par exemple +237 suivi des neuf chiffres du numéro. Le serveur demande le SMS lors de `signUp`, puis `verifyOtp` valide le code.
6. La connexion ultérieure accepte téléphone + mot de passe. La récupération par téléphone demande un OTP, puis permet de définir un nouveau mot de passe. Aucun code n'est généré ou vérifié uniquement dans le navigateur.

Ne pas laisser des numéros/codes de test actifs en production. L'envoi SMS est un service facturé selon le fournisseur ; il n'est pas rendu gratuit par Vercel ou Supabase. Le code montre l'erreur du fournisseur lorsqu'un envoi échoue.

Documentation : https://supabase.com/docs/guides/auth/phone-login

## 3. Passkeys : empreinte, visage ou code de verrouillage
Le SDK Supabase 2.105.0 est épinglé et embarqué dans le build. L'API passkey est expérimentale ; elle nécessite une activation côté serveur et peut évoluer.

Supabase → Authentication → Passkeys :
- Enable Passkey authentication : ON
- Relying Party Display Name : `Amana`
- Relying Party ID : `amana-project.vercel.app`
- Relying Party Origins : `https://amana-project.vercel.app`

Se connecter avec un compte confirmé, ouvrir **Sécurité**, puis **Ajouter une passkey**. Se déconnecter, puis tester **Se connecter avec une passkey**. Le téléphone propose son mécanisme compatible : empreinte, visage, code de verrouillage ou clé de sécurité. Le site ne peut pas imposer spécifiquement l'empreinte. Aucune empreinte n'est collectée, aucune image biométrique n'est stockée dans la base.

La passkey est une vraie authentification vérifiée par Supabase, pas un déverrouillage cosmétique du navigateur. Le rôle et la révocation restent contrôlés dans PostgreSQL. Elle est liée au domaine : changer de domaine oblige à enregistrer une nouvelle passkey. Les aperçus Vercel et GitHub Pages ne sont pas autorisés à utiliser les passkeys de ce domaine.

Documentation : https://supabase.com/docs/guides/auth/passkeys

## 4. Script local optionnel
Si vous préférez l'API Management au Dashboard, copier `.env.example` en `.env`, remplir les valeurs en local, puis exécuter sous Node 22+ :

```
node --env-file=.env scripts/configure-auth.mjs
```

Le jeton personnel Supabase est à créer dans les paramètres de votre compte. Ce n'est ni la clé publique ni la service_role. Le script n'affiche pas les secrets. Il configure le site et les passkeys, ainsi que SMTP et SMS seulement si les valeurs correspondantes sont renseignées. Il remplace la liste de redirection par l'adresse Vercel de production. Ne jamais publier `.env` ou exécuter ce script dans le navigateur. Après configuration, supprimer le jeton local ou le révoquer s'il n'est plus nécessaire.
