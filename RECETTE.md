# Recette réelle avant lancement

## Installation
- [ ] Sauvegarde DB et copie du dépôt.
- [ ] Vérifier migrations 001/002, appliquer 003 si manquante, puis 004 et 005 une seule fois.
- [ ] Redéployer amana-employees v3 ; ne pas conserver l'ancienne fonction avec mot de passe choisi par le gérant.
- [ ] Déployer frontend via GitHub/Vercel et vérifier le formulaire sans erreurs 404.
- [ ] Vérifier amana_health dans votre projet et le blocage si Supabase ne répond pas.

## Authentification et protections
- [ ] SMTP réel + expéditeur vérifié, lien de confirmation et récupération e-mail fonctionnels.
- [ ] Phone Auth/Twilio + destinations autorisées, réception et validation réelle du SMS ; tester un code faux/expiré.
- [ ] Ne pas désactiver la confirmation pour contourner les problèmes SMTP/SMS.
- [ ] Configurer limites Auth, quotas et alertes de coût SMS ; vérifier refus après dépassement.
- [ ] Turnstile : secret côté Supabase + clé publique dans config.js ; tester qu'un jeton manquant/incorrect est refusé par Auth, pas seulement par l'écran.
- [ ] Passkey sur appareil réel et domaine final ; repli sur mot de passe, suppression et récupération.

## Employés et isolation
- [ ] Deux entreprises distinctes : aucune lecture ou écriture croisée via interface ou appels API.
- [ ] Invitation d'une nouvelle adresse : réception du lien, définition privée du mot de passe et connexion employé.
- [ ] Tester adresse déjà utilisée : aucun rattachement silencieux.
- [ ] Tester les limites 2 minutes/adresse et 10 invitations/heure/entreprise.
- [ ] Révoquer l'employé connecté : nouvelles requêtes bloquées immédiatement et interface déconnectée dans les 20 secondes.
- [ ] Vérifier sessions et refresh tokens sur votre service Auth distant après révocation. Les JWT déjà délivrés restent potentiellement valides, mais les politiques DB doivent refuser les données d'entreprise.
- [ ] Vérifier journal d'audit gérant et refus d'édition/suppression du journal via rôle applicatif.

## Reçus et corrections
- [ ] Double clic et perte de réponse après validation : un seul reçu, même clé à la nouvelle tentative.
- [ ] Même TxID, espaces/casse différents : refus du doublon dans une entreprise.
- [ ] Total serveur différent d'un total falsifié côté navigateur.
- [ ] Valeurs nulles, articles invalides, q négative, prix négatif : refus.
- [ ] Employé sans archives ni pouvoirs de correction, mais aperçu et remise du reçu courant.
- [ ] Signalement, ouverture gérant, motif, annulation/remplacement atomique ; vérifier lien et conservation de l'ancien.
- [ ] Refus d'un remplacement invalide : l'original ne doit pas être annulé par cette tentative.
- [ ] Vérifier refus de modification/suppression directe du reçu y compris par le gérant.
- [ ] Totaux du tableau de bord et synthèse Excel excluent les reçus annulés.

## Remise au client
- [ ] PDF A4 et ticket : noms longs, accents, 100 articles, plusieurs pages, logo et total.
- [ ] Impression réelle sur votre imprimante thermique 80 mm.
- [ ] Partage PDF sur votre téléphone (WhatsApp via feuille de partage si disponible) ; téléchargement de repli.
- [ ] Scan du QR avec un autre téléphone, sans connexion au compte.
- [ ] Aucun nom client/article/contact/TxID sur la page publique ; statut d'annulation/remplacement à jour.
- [ ] Ancien PDF déjà remis : le QR montre le statut courant, même si le document ne peut pas être rappelé.
- [ ] Perte Internet : écran bloqué ; restauration Internet : contrôle serveur avant reprise.
