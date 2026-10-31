# RENDEVO — Psychologie

Site de réservation en français, responsive, avec parcours en cinq étapes, services adaptés à un cabinet de psychologie, disponibilité en direct et confirmation immédiate après validation côté serveur.

## Fonctions prévues

- Consultation initiale, suivi, gestion du stress, soutien émotionnel, adolescent, parental, couple et autre motif.
- Créneaux calculés selon les horaires configurés, la durée du service, les rendez-vous déjà enregistrés et les événements Google Calendar.
- Vérification anti-double réservation au moment de l'enregistrement.
- Google Sheets : rendez-vous, paramètres et journal d'audit.
- Création d'un événement Google Calendar.
- E-mail de confirmation au patient et notification au cabinet.
- Lien d'annulation sécurisé envoyé dans l'e-mail de confirmation ; l'annulation met à jour Sheets et supprime l'événement Calendar.
- Rappel automatique environ 24 h avant le rendez-vous (vérification horaire).
- Les notes libres du formulaire ne sont volontairement pas enregistrées ni ajoutées aux e-mails ou événements Calendar. Demander aux patients de ne pas y saisir de détails sensibles.

## 1. Préparer Google Sheets et Apps Script

1. Dans Google Drive, créez un nouveau classeur Google Sheets privé nommé `RENDEVO — Psychologie`.
2. Ouvrez le classeur puis **Extensions → Apps Script**.
3. Dans Apps Script, ouvrez `Code.gs`, supprimez son contenu et collez le code complet du fichier [apps-script/Code.gs](apps-script/Code.gs) de ce dépôt.
4. Ouvrez **Paramètres du projet → Propriétés du script** et ajoutez :
   - `SPREADSHEET_ID` = l'identifiant du classeur, entre `/d/` et `/edit` dans son URL.
   - `ADMIN_EMAIL` = adresse qui reçoit les notifications du cabinet.
   - `CLINIC_NAME` = nom affiché du cabinet (facultatif).
   - `CALENDAR_ID` = identifiant Google Calendar à utiliser (facultatif ; vide = calendrier principal du compte Apps Script).
5. Dans **Paramètres du projet**, réglez le fuseau horaire sur **Africa/Algiers**.
6. Enregistrez. Dans la liste des fonctions, choisissez `setup`, puis cliquez sur **Exécuter**. Acceptez les autorisations Sheets, Calendar, Mail et déclencheurs.
7. La fonction `setup` crée les onglets `Appointments`, `Settings`, `AuditLog` et installe un déclencheur horaire pour les rappels.

## 2. Configurer les horaires

Dans l'onglet `Settings`, modifiez la colonne `Value` selon les horaires réels du cabinet :

| Clé | Valeur initiale | Signification |
|---|---:|---|
| `OPEN_TIME` | `09:00` | Heure d'ouverture |
| `CLOSE_TIME` | `17:00` | Heure de fermeture |
| `WORKING_DAYS` | `1,2,3,4,5,6` | Jours ouverts : 1=lundi … 6=samedi, 0=dimanche |
| `SLOT_STEP_MINUTES` | `30` | Intervalle entre les heures proposées |
| `BUFFER_MINUTES` | `10` | Temps de battement entre deux séances |
| `ADVANCE_DAYS` | `90` | Horizon maximal de réservation |

Durées par défaut : première consultation et couple 60 minutes ; autres motifs 50 minutes. Modifiez ces durées dans l'objet `SERVICES` au début du code si nécessaire.

## 3. Déployer l'application Web

1. Cliquez sur **Déployer → Nouveau déploiement**.
2. Type : **Application Web**.
3. **Exécuter en tant que** : votre compte Google.
4. Accès : **Tout le monde** pour permettre aux patients d'envoyer une demande sans compte Google (cela rend l'URL accessible publiquement).
5. Cliquez sur **Déployer**, autorisez si demandé, puis copiez l'URL se terminant par `/exec`.

Ne publiez jamais l'identifiant du classeur, les propriétés du script, ni les données des patients.

## 4. Connecter le site GitHub Pages

Dans le dépôt, ouvrez `config.js`, cliquez sur le crayon, puis remplacez la valeur vide de `appsScriptUrl` par l'URL Web App `/exec`. Exemple :

```js
window.BOOKING_CONFIG = Object.freeze({
  clinicName: "Cabinet de psychologie",
  clinicPhone: "",
  appsScriptUrl: "COLLER_ICI_URL_EXEC"
});
```

Enregistrez avec **Commit changes**. Attendez la mise à jour GitHub Pages.

## 5. Vérifier avant toute utilisation réelle

- Ouvrez l'URL `/exec` : le service doit répondre avec `success: true`.
- Testez le site avec des coordonnées fictives.
- Vérifiez qu'un créneau est affiché, qu'une seule ligne est créée dans `Appointments`, qu'un événement apparaît dans Google Calendar et que les e-mails arrivent.
- Testez une deuxième réservation sur le même créneau : elle doit être refusée.
- Ouvrez le lien d'annulation reçu par e-mail : le statut doit devenir `CANCELLED` et l'événement Calendar doit disparaître.
- Pour tester le rappel, utilisez un rendez-vous de test situé dans les prochaines 24 heures et vérifiez les exécutions Apps Script.

Si vous modifiez le code Apps Script après le déploiement, ouvrez **Déployer → Gérer les déploiements → Modifier**, choisissez **Nouvelle version**, puis redéployez. L'URL `/exec` reste normalement la même.

## Confidentialité et limites

Le site recueille les coordonnées et le motif général nécessaires à la réservation. Le champ libre n'est pas conservé côté serveur. N'utilisez pas de vraies données de patients avant que le cabinet ait validé ses obligations de confidentialité, de conservation et de suppression, et limité l'accès au classeur et au calendrier aux personnes autorisées. Le service de réservation n'est pas un canal d'urgence.
