# Lab Sésame (Kereis) — environnement test admin

Espace admin isolé pour tester l’API partenaires Sésame **avant** de brancher les appels sur les dossiers CRM prod.

- UI : bouton **Lab Sésame (test)** → `/admin/lab-sesame`
- API : `/api/admin/sesame-lab/*` (auth admin existante)
- Aucune écriture Firestore / dossiers depuis le lab

## Variables d’environnement (Railway)

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `SESAME_ENV` | oui (garde-fou) | `test` pour le lab. Si `production`, toutes les routes lab renvoient 403. |
| `SESAME_BASE_URL` | non | Défaut : `https://wwwsesame-r1.cbp-solutions.fr` |
| `SESAME_BASIC_USER` | oui | Login Basic Auth partenaire (compte R1) |
| `SESAME_BASIC_PASSWORD` | oui | Mot de passe Basic Auth (jamais renvoyé à l’UI) |
| `SESAME_CODE_ENTITE` | oui | `codeEntiteDistributeur` LCIF |
| `SESAME_DEFAULT_CODE_OFFRE` | non | Préremplit le lab / payload exemple |
| `SESAME_DEFAULT_CODE_PRODUIT` | non | Ex. code produit substitution |
| `SESAME_DEFAULT_CODE_BAREME` | non | `codeBareme` |
| `SESAME_DEFAULT_ID_COMMISSIONNEMENT` | non | Id commissionnement distributeur |
| `SESAME_CONSEILLER_NOM` / `_PRENOM` / `_EMAIL` / `_TEL` / `_REF` | non | Identité conseiller pour connexion / parcours |

Exemple minimal Railway :

```bash
SESAME_ENV=test
SESAME_BASE_URL=https://wwwsesame-r1.cbp-solutions.fr
SESAME_BASIC_USER=...
SESAME_BASIC_PASSWORD=...
SESAME_CODE_ENTITE=06040
SESAME_DEFAULT_CODE_OFFRE=...
```

## Checklist — éléments à fournir (Rémi / Kereis)

### Accès API (bloquant)

- [ ] Login + mot de passe **Basic Auth** compte test / R1
- [ ] Confirmation URL de base recette (si ≠ `https://wwwsesame-r1.cbp-solutions.fr`)
- [ ] Compte habilité sur les services `partenaires/*`

### Paramétrage métier LCIF (bloquant pour appels utiles)

- [ ] `codeEntiteDistributeur` LCIF
- [ ] Code(s) **offre** substitution autorisés
- [ ] Code(s) **produit** + **barème** (`codeBareme`) + **idCommissionnement**
- [ ] Annexes / tables d’ids : formules, options, types de prêt, enseignes prêteur, statuts pro

### Identité conseiller côté Sésame

- [ ] Civilité, nom, prénom, email, téléphone
- [ ] `referenceConseiller` (si imposée par Kereis)

### Optionnel

- [ ] Dossier client « cobaye » (données fictives / anonymisées)
- [ ] Contact DSI Kereis si whitelist IP : `dsi-emprunteurs-adhesions-api@kereis.com`

Sans Basic Auth + codes entité/offre/produit : le lab UI + client HTTP fonctionnent, mais pas de tests R1 réels.

## Critères de tests concluants

1. GET offres OK avec le compte R1  
2. POST tarification renvoie des cotisations (pas seulement « Non assurable »)  
3. POST devis renvoie un PDF lisible  
4. POST création parcours renvoie un `lienSesame` ouvrable  

Ensuite seulement : boutons tarifer / devis / ouvrir contrat sur le dossier admin prod.

## Formulaire lab (aligné Kérys)

- **Assurés** : 1 ou 2 (couple). Quotité, métier / sports à risque = **optionnels** (déclaratif ; ids Sésame non envoyés tant que l’annexe Kereis n’est pas branchée).
- **Prêts** : montant = **capital restant dû (CRD)** (base substitution).
- **Propositions** : badge + filtre **Tous / CRD / Capital initial** (heuristique sur le code produit, ex. `CLEUICD` vs `CLEUICI`).

## Endpoints lab

| Méthode | Chemin | Sésame |
|---------|--------|--------|
| GET | `/api/admin/sesame-lab/status` | config (sans secrets) |
| GET | `/api/admin/sesame-lab/referentiel/offres` | GET `/referentiel/offre` |
| GET | `/api/admin/sesame-lab/referentiel/offre/:code/produits` | GET produits |
| GET | `/api/admin/sesame-lab/referentiel/frais-distribution` | GET frais |
| POST | `/api/admin/sesame-lab/tarification` | POST `/tarification` |
| POST | `/api/admin/sesame-lab/devis` | POST `/devis` (PDF base64) |
| POST | `/api/admin/sesame-lab/connexion` | POST `/connexion` |
| POST | `/api/admin/sesame-lab/dossier/creation` | POST création parcours détaillé |
| POST | `/api/admin/sesame-lab/dossier/ouverture` | POST ouverture |
| GET | `/api/admin/sesame-lab/sample-payload` | payload d’exemple |

Logs serveur préfixés `[SesameLab]`.
