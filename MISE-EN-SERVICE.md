# Mise en service v3

## Auth — URL
Dans Supabase → Authentication → URL Configuration :
- Site URL : `https://amana-project.vercel.app/`
- Redirect URLs : `https://amana-project.vercel.app/` et `https://amana-project.vercel.app/?invitation=1`

Les liens de confirmation, d'invitation et de récupération doivent conserver `{{ .ConfirmationURL }}` dans les templates Supabase. Ne pas mettre une URL de site brute à sa place.

## Fournisseurs et quotas
- Activer le SMTP personnalisé : Brevo est proposé, mais les paramètres viennent de votre compte. Le nom Amana est un nom d'expéditeur, pas une autorisation d'envoyer depuis n'importe quelle adresse. Vérifier l'expéditeur/domaine chez le fournisseur.
- Phone Auth + Twilio seulement si les inscriptions/récupérations par SMS sont souhaitées. Autoriser les destinations et contrôler tarifs, limites et alertes de dépenses, notamment +237. Aucun SMS gratuit ou crédit n'est inclus dans le dossier.
- Ne pas activer l'auto-confirmation e-mail/téléphone pour contourner un défaut de livraison.
- Dans Supabase Auth → Rate Limits, fixer des limites adaptées aux envois et tentatives de vérification, puis tester leur comportement. Les protections de la base sur les reçus/invitations ne remplacent pas les limites d'inscription/OTP, qui sont gérées par le service Auth.

## CAPTCHA côté serveur et côté écran
1. Créer un widget Cloudflare Turnstile pour `amana-project.vercel.app`.
2. Dans Supabase Auth → Protection / CAPTCHA, activer Turnstile et saisir **la clé secrète** uniquement côté Supabase.
3. Dans `config.js`, renseigner **la clé publique** `captchaSiteKey` puis redéployer.
4. Tester inscription, connexion par mot de passe et récupération. Le code transmet le jeton CAPTCHA à Supabase. La vérification du code OTP reste côté Auth.

Si le CAPTCHA est activé côté serveur mais sans clé publique dans le site, les actions d'authentification correspondantes seront refusées. Si seule la clé publique est renseignée sans activer le contrôle côté serveur, un robot peut contourner le widget en appelant l'API directement. Ne pas confondre contrôle visuel et sécurité serveur. Les invitations sont réservées au gérant et limitées en SQL ; les passkeys suivent leur cérémonie WebAuthn native.

## Passkeys
Activer dans Supabase Authentication → Passkeys :
- RP Display Name : Amana
- RP ID : amana-project.vercel.app
- Origins : https://amana-project.vercel.app

Ne pas utiliser `vercel.app` comme RP ID générique. Les domaines de prévisualisation et GitHub Pages sont distincts ; tester sur le domaine final. La fonctionnalité Supabase est expérimentale et dépend du SDK et du navigateur. L'empreinte, le visage ou le code sont choisis par l'appareil ; Amana ne collecte pas la biométrie.

## Invitations
Redéployer impérativement la nouvelle Edge Function. Le gérant ne saisit plus de mot de passe. L'e-mail contient un lien privé géré par Supabase ; l'employé définit son mot de passe puis accède à l'émission de reçus.

« Invitation envoyée » signifie que le service a accepté la demande, pas que la boîte destinataire l'a reçue. Vérifier les journaux du fournisseur SMTP. Les adresses déjà utilisées par un autre compte ne sont pas rattachées automatiquement : un transfert entre entreprises nécessite un processus distinct, non inclus.

## Confidentialité du QR
Le lien agit comme une capacité de lecture limitée. Toute personne qui le reçoit peut voir le total, l'entreprise, le numéro, la date et l'état du reçu. Ne pas publier un QR si ces informations sont confidentielles. Le jeton ne donne pas accès au compte ni aux archives. Le QR ne certifie pas le paiement bancaire ou Mobile Money.

## Retour arrière
Ne pas revenir simplement à l'ancien frontend après migration : l'ancienne API d'émission n'est plus compatible et les droits d'édition ont été retirés. En cas d'incident, afficher une page de maintenance, sauvegarder les informations et corriger le déploiement. Ne pas supprimer les nouvelles tables pour rétablir le site, au risque de perdre audit et liens de correction.
