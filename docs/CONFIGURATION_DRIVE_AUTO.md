# Création automatique des dossiers Google Drive (sans admin connecté)

## Erreur 502 « Application failed to respond »

Le dépôt contient un **Dockerfile** : Railway doit l’utiliser automatiquement au prochain déploiement.

Vérifiez aussi : Railway → service → **Settings** → **Start Command** doit être **vide** (laisser le Dockerfile / `railway.toml` décider).

---

## Erreur 502 (autres causes)

Souvent : le dossier `dist/` n’est **pas** sur GitHub (normal). Si le **build** Railway échoue, `dist/server.cjs` n’existe pas → crash au démarrage.

1. Railway → **Deployments** → dernier déploiement → onglet **Build** (pas seulement Deploy)
2. Cherchez `npm run build` et une ligne **erreur** (esbuild, vite, etc.)
3. Poussez le dernier code (`nixpacks.toml` force `npm install && npm run build`)
4. Après succès : `curl` doit afficher `"build":"railway-express-2026-05-27"`

---

## Railway n’affiche que `{"status":"ok"}` ?

Le code sur **GitHub** est à jour, mais **Railway** n’a pas redéployé le backend.

1. [railway.app](https://railway.app) → projet **Assurance** → service **suivi-assurance-emprunteur**
2. Bouton violet **Apply X changes** (variables) puis **Deploy**
3. Onglet **Deployments** → le commit doit être récent (ex. `railway.toml` ou *Drive auto*)
4. Retest : `curl -s https://assurance-emprunteur.up.railway.app/api/health`  
   → doit contenir `"build":"railway-express-2026-05-27"` et `"driveConfigVersion":3`

---

## Pousser le code sur GitHub (Mac)

Dans le Terminal, allez dans le dossier du projet (adaptez le chemin si besoin) :

```bash
cd ~/suivi-assurance-emprunteur-4
git status
git add .
git commit -m "Drive auto: compte de service et correction dossier parent"
git push origin main
```

Si GitHub demande de vous connecter : utilisez un **Personal Access Token** comme mot de passe, ou connectez-vous via GitHub Desktop.

Railway est en général relié au dépôt `leclubassurance/suivi-assurance-emprunteur` : après le `git push`, le déploiement redémarre tout seul (1–3 min).

---

# Création automatique des dossiers Google Drive (sans admin connecté)

Quand un client envoie le formulaire, le backend Railway crée un sous-dossier dans **« Dossiers Clients Assurance »** via un **compte de service** Google (clé JSON), même si personne n’est connecté dans l’admin.

## 1. Google Cloud Console

1. Ouvrez [Google Cloud Console](https://console.cloud.google.com/) (même projet que Firebase si possible).
2. **APIs & Services** → **Bibliothèque** → activez **Google Drive API**.
3. **APIs & Services** → **Comptes de service** → **Créer un compte de service**
   - Nom : `drive-dossiers-clients` (exemple)
   - Rôle : aucun rôle GCP obligatoire pour Drive (l’accès se fait via le partage Drive)
4. Sur le compte créé → **Clés** → **Ajouter une clé** → **JSON** → téléchargez le fichier.

Notez l’email du compte, du type :

`drive-dossiers-clients@VOTRE-PROJET.iam.gserviceaccount.com`

## 2. Partager le dossier parent dans Google Drive

1. Connectez-vous avec **`assurance@leclubimmobilier.fr`**.
2. Ouvrez le dossier **« Dossiers Clients Assurance »**  
   ID : `1KedZC85KypR6zpr5bZOLIh3eWAxiRz7u`
3. **Partager** → ajoutez l’**email du compte de service** (étape 1).
4. Rôle : **Éditeur** (doit pouvoir créer des sous-dossiers).

Sans cette étape, l’API renverra « File not found » ou « Insufficient permissions ».

## 3. Variables Railway

| Variable | Valeur |
|----------|--------|
| `GOOGLE_DRIVE_PARENT_FOLDER_ID` | `1KedZC85KypR6zpr5bZOLIh3eWAxiRz7u` |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Contenu du fichier JSON encodé en base64 (recommandé) |

### Encoder la clé en base64 (Mac)

Remplacez par le **vrai chemin** du fichier téléchargé (souvent dans Téléchargements) :

```bash
base64 -i ~/Downloads/VOTRE-FICHIER-CLE.json | tr -d '\n' | pbcopy
```

Astuce : tapez `base64 -i ~/Downloads/` puis **Tab** pour auto-compléter le nom du fichier `.json`.

Collez dans Railway → **Variables** → `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` → **Redeploy**.

### Quoi mettre dans `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` ?

| À mettre | Exemple |
|----------|---------|
| ✅ La **sortie** de la commande `base64 -i fichier.json` (une longue ligne, commence souvent par `eyJ...`) | `eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Ii...` |
| ❌ **Pas** le contenu brut du fichier JSON dans cette variable | pas `{ "type": "service_account", ... }` |
| ❌ **Pas** le résultat de `curl .../drive-auto-check` | c’est un **test** après déploiement, pas une variable |

Alternative : variable `GOOGLE_SERVICE_ACCOUNT_JSON` = tout le JSON sur **une seule ligne** (sans base64).

Ou avec le script du projet :

```bash
cd ~/suivi-assurance-emprunteur-4
./scripts/encode-google-sa.sh ~/Downloads/VOTRE-FICHIER-CLE.json | pbcopy
```

Alternative (moins fiable sur Railway) : coller le JSON sur une seule ligne dans `GOOGLE_SERVICE_ACCOUNT_JSON`.

## 4. Redéployer Railway

Poussez le dernier code sur `main` et attendez la fin du déploiement.

## 5. Vérifier

Ouvrez dans le navigateur :

`https://VOTRE-APP.up.railway.app/api/health`

Vous devez voir par exemple :

```json
{
  "status": "ok",
  "driveConfigVersion": 3,
  "effectiveDriveParentId": "1KedZC85KypR6zpr5bZOLIh3eWAxiRz7u",
  "hasServiceAccount": true,
  "serviceAccountEmail": "drive-dossiers-clients@....iam.gserviceaccount.com"
}
```

Puis (dans le navigateur ou avec `curl`) :

`https://assurance-emprunteur.up.railway.app/api/admin/drive-auto-check`

Vous devez voir du **JSON** (pas la page d’accueil du site). Si vous voyez le site → le code n’est pas encore déployé : refaites `git push` et attendez Railway.

- `"ok": true` → le compte de service peut créer des dossiers dans le parent.
- `"ok": false` → vérifiez le partage Drive (étape 2) ou la clé JSON.

## 6. Test réel

Soumettez un dossier test via le formulaire client. Dans l’admin, le dossier doit passer en export Drive (dossier créé sous « Dossiers Clients Assurance »).

Le bouton **Drive** dans l’admin continue d’utiliser **votre connexion Google** (`assurance@…`) ; l’export **automatique** utilise le **compte de service**.
