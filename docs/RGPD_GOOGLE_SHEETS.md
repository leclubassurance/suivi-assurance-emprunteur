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

L’ID se trouve dans l’URL : `https://docs.google.com/spreadsheets/d/XXXXXXXX/edit` → `XXXXXXXX`.

## Création de la feuille (manuel)

1. Google Drive → Nouveau → Google Sheets.
2. Renommer les onglets (ou laisser l’app créer les onglets manquants au premier envoi).
3. Partager avec le compte de service.
4. Coller l’ID dans `RGPD_GOOGLE_SPREADSHEET_ID`.

## Vérification

- `GET /api/admin/rgpd/status` — ID configuré, version de la politique.
- `POST /api/admin/rgpd/sync-register` — force la mise à jour du registre.

## Côté dossier (Firestore / base)

Chaque dossier contient `privacyConsent` :

- `acceptedAt`, `policyVersion`, `policyLastUpdated`, `labelText`
- `ip`, `userAgent`, `sourceUrl` (côté serveur)
- `sheetsLoggedAt` si la ligne Sheets a été écrite

Un événement `PRIVACY_CONSENT_RECORDED` est ajouté au journal du dossier.
