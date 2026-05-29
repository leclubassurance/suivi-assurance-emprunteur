# Registre RGPD & journal des consentements (Google Sheets)

## Objectif

1. **Journal des consentements** — une ligne par dossier envoyé (preuve RGPD).
2. **Registre des traitements** (art. 30 RGPD) — tableau maintenu par l’application, onglet dédié.

## Prérequis

- Compte de service Google (`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`) **ou** OAuth serveur avec accès Sheets.
- La feuille Google doit être **partagée en éditeur** avec :
  - l’email du compte de service (`client_email` dans le JSON), **ou**
  - `assurance@leclubimmobilier.fr` si vous utilisez l’OAuth admin.

## Configuration Railway

```env
RGPD_GOOGLE_SPREADSHEET_ID="votre_id_de_feuille"
RGPD_SHEET_REGISTER="Registre traitements"
RGPD_SHEET_CONSENTS="Journal consentements"
RGPD_REGISTER_SYNC_ON_START="true"
```

L’ID se trouve dans l’URL : `https://docs.google.com/spreadsheets/d/XXXXXXXX/edit` → `XXXXXXXX` uniquement.

Ne collez pas les paramètres après `?` (ex. lien Drive `…/d/XXX?dmr=1…`) : l’app nettoie l’ID, mais sur Railway mettez de préférence **uniquement** `XXXXXXXX`.

## Création de la feuille (manuel)

1. Google Drive → Nouveau → Google Sheets.
2. Renommer les onglets (ou laisser l’app créer les onglets manquants au premier envoi).
3. Partager avec le compte de service.
4. Coller l’ID dans `RGPD_GOOGLE_SPREADSHEET_ID`.

## Vérification

- `GET /api/admin/rgpd/status` — ID configuré, version de la politique.
- `GET /api/admin/rgpd/diagnose` — vérifie que l’ID est bien une **Google Sheet** (pas un dossier / Excel) et que le compte de service y accède.
- `GET` ou `POST /api/admin/rgpd/sync-register` — force la mise à jour du registre (GET utilisable depuis le navigateur).

### Erreur « Request contains an invalid argument »

1. L’ID Railway doit venir de **`https://docs.google.com/spreadsheets/d/XXXX/edit`**, pas d’un lien Drive `…/open?id=…` ou `…/d/XXX?dmr=…`.
2. Le fichier doit être une **Google Sheets native** (menu Fichier → Nouveau → Google Sheets), pas un `.xlsx` uploadé seul.
3. Partager la feuille en **Éditeur** avec l’email du **compte de service** (`client_email` dans le JSON Railway).

## Côté dossier (Firestore / base)

Chaque dossier contient `privacyConsent` :

- `acceptedAt`, `policyVersion`, `policyLastUpdated`, `labelText`
- `ip`, `userAgent`, `sourceUrl` (côté serveur)
- `sheetsLoggedAt` si la ligne Sheets a été écrite

Un événement `PRIVACY_CONSENT_RECORDED` est ajouté au journal du dossier.
