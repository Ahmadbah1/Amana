# Amana Business v3 — dossier complet GitHub → Vercel + Supabase

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
