# Firebase — tout en ligne (compte assurance@)

L’application utilise **Cloud Firestore** comme base de données des dossiers en production.  
Il n’y a plus de fichier `db.json` persistant sur Railway : les dossiers vivent dans Firestore.

## Comptes

| Compte | Rôle |
|--------|------|
| **assurance@leclubimmobilier.fr** | Connexion admin (Firebase Auth + Google OAuth Gmail/Drive) |
| Propriétaire projet Firebase | Peut être assurance@ (recommandé) ou un autre compte Google Workspace |

## 1. Créer / ouvrir le projet Firebase avec assurance@

1. Connectez-vous à [Firebase Console](https://console.firebase.google.com) avec **assurance@leclubimmobilier.fr**.
2. Créez un projet (ex. `le-club-assurance-emprunteur`) ou ouvrez le projet existant.
3. **Authentication** → Méthode de connexion → activez **Google**.
4. **Firestore Database** → Créez une base en mode **production** (région `europe-west` si possible).
5. Collection utilisée par l’app : **`dossiers`** (créée automatiquement au premier enregistrement).

## 2. Application Web (config pour Vercel + Railway)

1. Paramètres du projet → **Vos applications** → Ajouter une app **Web**.
2. Copiez la config (`apiKey`, `authDomain`, `projectId`, `appId`, etc.).

## 3. Variables d’environnement

### Vercel (frontend)

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=votre-projet.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=votre-projet
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_STORAGE_BUCKET=votre-projet.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_API_URL=https://assurance-emprunteur.up.railway.app
```

### Railway (backend API)

Les **mêmes valeurs** (avec ou sans préfixe `VITE_`) :

```
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_APP_ID=...
DATA_STORE=firestore
FIREBASE_REQUIRED=true
```

Optionnel si vous utilisez une base Firestore **nommée** (pas `(default)`) :

```
FIREBASE_DATABASE_ID=nom-de-la-base
```

## 4. Autoriser assurance@ dans Firebase Auth

Dans **Authentication** → **Settings** → si vous restreignez les domaines, ajoutez `leclubimmobilier.fr`.

L’app refuse tout compte Google autre que **assurance@leclubimmobilier.fr** à la connexion admin.

## 5. Règles Firestore

Le backend Railway écrit dans Firestore via le SDK (règles actuelles permissives pour `dossiers`).  
Les dossiers ne sont **pas** lus directement depuis le navigateur : uniquement via l’API Railway.

Déployez les règles du dépôt si besoin :

```bash
firebase deploy --only firestore:rules
```

## 6. Vérifier que tout est en ligne

Après déploiement Railway :

```bash
curl -s https://assurance-emprunteur.up.railway.app/api/health | jq '.dataStore, .firebase'
```

Attendu :

- `dataStore`: `"firestore"`
- `firebase.ready`: `true`
- `firebase.projectId`: votre projet
- `firebase.dossierCount`: nombre de dossiers

## 7. Migration depuis un ancien fichier local (une fois)

Si vous aviez des dossiers dans `data/db.json` sur votre Mac :

1. Placez le fichier dans `data/db.json` du projet.
2. Sur Railway, ajoutez temporairement `FIREBASE_IMPORT_LOCAL=true`, redéployez, puis **retirez** cette variable.

## 8. Pièces jointes formulaire

Les métadonnées des dossiers sont dans Firestore. Les fichiers uploadés sur Railway restent sur disque **éphémère** (`/tmp`) tant qu’ils ne sont pas exportés vers **Google Drive**.  
Pour une persistance complète des fichiers, utilisez l’export Drive (manuel ou compte de service).

## Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| Admin vide, health `firebase.ready: false` | Variables `FIREBASE_*` manquantes sur Railway |
| `dataStore: local` | Firebase non configuré ou `USE_LOCAL_DB=true` |
| Connexion refusée | Compte Google ≠ assurance@ |
| Données différentes Vercel / Railway | `projectId` différent entre Vercel et Railway |
