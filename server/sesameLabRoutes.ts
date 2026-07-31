/**
 * Routes admin Lab Sésame (environnement test isolé).
 * Aucune écriture sur les dossiers CRM.
 */
import type { Express, Request, Response } from "express";
import {
  getSesameConfigStatus,
  sesameFetchJson,
  sesameFetchPdf,
  assertSesameLabAllowed,
} from "./sesameClient";

type LabLogEntry = {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId?: string;
  ok: boolean;
  error?: string;
};

const labCallLog: LabLogEntry[] = [];
const MAX_LOG = 40;

function pushLog(entry: LabLogEntry) {
  labCallLog.unshift(entry);
  if (labCallLog.length > MAX_LOG) labCallLog.length = MAX_LOG;
}

function defaultConseiller() {
  const codeEntite = String(process.env.SESAME_CODE_ENTITE || "").trim() || "06040";
  return {
    civilite: "Monsieur",
    codeEntiteDistributeur: codeEntite,
    email: String(process.env.SESAME_CONSEILLER_EMAIL || "assurance@leclubimmobilier.fr").trim(),
    listeCodeEntitesDistributeur: [codeEntite],
    nom: String(process.env.SESAME_CONSEILLER_NOM || "VICTOR").trim(),
    prenom: String(process.env.SESAME_CONSEILLER_PRENOM || "Charles").trim(),
    referenceConseiller: String(process.env.SESAME_CONSEILLER_REF || "LCIF-ADMIN").trim(),
    telephone: String(process.env.SESAME_CONSEILLER_TEL || "+33600000000").trim(),
  };
}

/** Payload minimal pour smoke tests (à remplacer par vraies données + codes LCIF). */
export function buildLabSamplePayload(overrides?: Record<string, unknown>) {
  const o = overrides || {};
  const codeOffre =
    String(o.codeOffre || process.env.SESAME_DEFAULT_CODE_OFFRE || "OFFRE 20 SUB").trim();
  const codeProduit = String(o.codeProduit || process.env.SESAME_DEFAULT_CODE_PRODUIT || "7312-CHF").trim();
  const codeBareme = String(o.codeBareme || process.env.SESAME_DEFAULT_CODE_BAREME || "3").trim();
  const idCommissionnement = String(
    o.idCommissionnement ?? process.env.SESAME_DEFAULT_ID_COMMISSIONNEMENT ?? "0",
  ).trim();
  // Substitution ADE : frais / commissionnement client à 0 par défaut (modifiable via env plus tard).
  const fraisDistribution = Number(
    o.fraisDistribution ?? process.env.SESAME_DEFAULT_FRAIS_DISTRIBUTION ?? 0,
  );
  const conseiller = {
    ...defaultConseiller(),
    ...((o.conseiller as object) || {}),
  };

  const civilite = String(o.civilite || "Monsieur").trim() || "Monsieur";
  const nom = String(o.nom || "TEST").trim() || "TEST";
  const prenom = String(o.prenom || "Lab").trim() || "Lab";
  const dateNaissance = String(o.dateNaissance || "1990-01-15").trim();
  const codePostal = String(o.codePostal || o.codePostalResidenceFiscale || "44000").trim();
  const fumeur = o.fumeur === true || o.fumeur === "true" || o.fumeur === 1;
  const quotite = Number(o.quotite ?? 100);
  const franchise = Number(o.franchise ?? 90);
  const idFormule = Number(o.idFormule ?? 101);
  const idStatutProfessionnel = Number(o.idStatutProfessionnel ?? 1);
  const professionLibelle = String(o.professionLibelle || "Employe de bureau").trim();
  const montantPret = Number(o.montantPret ?? o.montant ?? 150000);
  const dureePret = Number(o.dureePret ?? o.duree ?? 240);
  const tauxPret = Number(o.tauxPret ?? o.taux ?? 3.5);
  const idTypePret = Number(o.idTypePret ?? 51);
  const idTypeAmortissement = Number(o.idTypeAmortissement ?? 100);
  const idPeriodiciteEcheancePret = Number(o.idPeriodiciteEcheancePret ?? 3);
  const referencePret = String(o.referencePret || "PRET001").trim() || "PRET001";
  const referenceAssure = String(o.referenceAssure || "ASSURE001").trim() || "ASSURE001";

  const assure: Record<string, unknown> = {
    civilite,
    codeBareme,
    codePostalResidenceFiscale: codePostal,
    codeProduit,
    couvertures: [
      {
        couverture: {
          franchise,
          idFormule,
          idOptions: [],
          idSportsARisque: [],
          quotite,
        },
        referencePret,
        veutEtreCouvert: true,
      },
    ],
    dateNaissance,
    encoursImmobilierAssure: Number(o.encoursImmobilierAssure ?? 0),
    fraisDistribution,
    fumeur,
    idCategorieParticuliere: Number(o.idCategorieParticuliere ?? 0),
    idCommissionnement,
    idQualite: Number(o.idQualite ?? 3),
    idSportsARisque: [],
    nom,
    paysResidenceFiscale: String(o.paysResidenceFiscale || "FR"),
    prenom,
    profession: {
      idStatutProfessionnel,
      libelle: professionLibelle,
      manuelle: o.professionManuelle === true,
      travailAdministratif: o.travailAdministratif !== false && o.professionManuelle !== true,
      travauxEnHauteur: o.travauxEnHauteur === true,
      deplacementsProfessionnels: o.deplacementsProfessionnels === true,
    },
    referenceAssure,
    produitsATarifer: [
      {
        codeBareme,
        codeProduit,
        idCommissionnement,
      },
    ],
  };
  // Poids / taille : jamais demandés au client — omis sauf override explicite (si Kereis l’exige un jour).
  if (o.poids != null && o.poids !== "") assure.poids = Number(o.poids);
  if (o.taille != null && o.taille !== "") assure.taille = Number(o.taille);

  return {
    codeOffre,
    conseiller: {
      codeEntiteDistributeur: conseiller.codeEntiteDistributeur,
      nom: conseiller.nom,
      prenom: conseiller.prenom,
    },
    dateEffetGaranties: String(o.dateEffetGaranties || "2026-11-01"),
    idObjetFinancement: Number(o.idObjetFinancement ?? 8),
    assures: [assure],
    prets: [
      {
        duree: dureePret,
        idPeriodiciteEcheancePret,
        idTypeAmortissement,
        idTypePret,
        montant: montantPret,
        referencePret,
        taux: tauxPret,
      },
    ],
    ...(o.extra && typeof o.extra === "object" ? (o.extra as object) : {}),
  };
}

function handleLabError(res: Response, err: any) {
  const msg = err?.message || String(err);
  console.warn("[SesameLab]", msg);
  const status = /désactivé|production/i.test(msg) ? 403 : /manquants|Credentials/i.test(msg) ? 503 : 500;
  return res.status(status).json({ ok: false, error: msg });
}

export function registerSesameLabRoutes(app: Express) {
  app.get("/api/admin/sesame-lab/status", async (_req, res) => {
    try {
      const status = getSesameConfigStatus();
      res.json({
        ok: true,
        ...status,
        recentCalls: labCallLog.slice(0, 15),
        checklist: {
          basicAuth: status.basicAuthConfigured,
          codeEntite: Boolean(status.codeEntite),
          labAllowed: status.labAllowed,
        },
      });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.get("/api/admin/sesame-lab/referentiel/frais-distribution", async (req, res) => {
    try {
      assertSesameLabAllowed();
      const codeEntite =
        String(req.query.codeEntite || process.env.SESAME_CODE_ENTITE || "").trim() || undefined;
      const result = await sesameFetchJson({
        method: "GET",
        path: "/referentiel/frais-distribution",
        query: { codeEntite },
      });
      pushLog({
        at: new Date().toISOString(),
        method: "GET",
        path: "/referentiel/frais-distribution",
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.get("/api/admin/sesame-lab/referentiel/offres", async (_req, res) => {
    try {
      assertSesameLabAllowed();
      const result = await sesameFetchJson({
        method: "GET",
        path: "/referentiel/offre",
      });
      pushLog({
        at: new Date().toISOString(),
        method: "GET",
        path: "/referentiel/offre",
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.get("/api/admin/sesame-lab/referentiel/offre/:codeOffre/produits", async (req, res) => {
    try {
      assertSesameLabAllowed();
      const codeOffre = encodeURIComponent(String(req.params.codeOffre || "").trim());
      const result = await sesameFetchJson({
        method: "GET",
        path: `/referentiel/offre/${codeOffre}/produit`,
      });
      pushLog({
        at: new Date().toISOString(),
        method: "GET",
        path: `/referentiel/offre/${req.params.codeOffre}/produit`,
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.get("/api/admin/sesame-lab/referentiel/offre/:codeOffre/assureurs", async (req, res) => {
    try {
      assertSesameLabAllowed();
      const codeOffre = encodeURIComponent(String(req.params.codeOffre || "").trim());
      const result = await sesameFetchJson({
        method: "GET",
        path: `/referentiel/offre/${codeOffre}/assureur`,
      });
      pushLog({
        at: new Date().toISOString(),
        method: "GET",
        path: `/referentiel/offre/${req.params.codeOffre}/assureur`,
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.post("/api/admin/sesame-lab/tarification", async (req: Request, res: Response) => {
    try {
      assertSesameLabAllowed();
      const body =
        req.body?.payload ||
        (req.body?.codeOffre && Array.isArray(req.body?.assures) ? req.body : null) ||
        buildLabSamplePayload(req.body?.overrides);
      const echeancier = String(req.query.echeancier || req.body?.echeancier || "").trim() || undefined;
      const result = await sesameFetchJson({
        method: "POST",
        path: "/tarification",
        query: {
          echeancier,
          reductionCouple:
            req.body?.reductionCouple != null ? String(req.body.reductionCouple) : undefined,
        },
        body,
        timeoutMs: 90_000,
      });
      pushLog({
        at: new Date().toISOString(),
        method: "POST",
        path: "/tarification",
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, requestPayloadPreview: summarizePayload(body), ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.post("/api/admin/sesame-lab/devis", async (req: Request, res: Response) => {
    try {
      assertSesameLabAllowed();
      const raw = req.body || {};
      const body =
        raw.payload ||
        (raw.codeOffre && Array.isArray(raw.assures) ? raw : null) ||
        buildLabSamplePayload(raw.overrides);
      // Devis : produit sur l'assuré (pas produitsATarifer)
      if (Array.isArray(body.assures)) {
        for (const a of body.assures) {
          if (a.produitsATarifer?.[0]) {
            a.codeProduit = a.codeProduit || a.produitsATarifer[0].codeProduit;
            a.codeBareme = a.codeBareme || a.produitsATarifer[0].codeBareme;
            a.idCommissionnement = a.idCommissionnement || a.produitsATarifer[0].idCommissionnement;
          }
          delete a.produitsATarifer;
        }
      }
      const result = await sesameFetchPdf({
        path: "/devis",
        body,
        timeoutMs: 90_000,
      });
      pushLog({
        at: new Date().toISOString(),
        method: "POST",
        path: "/devis",
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      if (result.ok && result.binaryBase64) {
        return res.json({
          ok: true,
          status: result.status,
          durationMs: result.durationMs,
          requestId: result.requestId,
          contentType: result.contentType || "application/pdf",
          pdfBase64: result.binaryBase64,
          fileName: `sesame-lab-devis-${Date.now()}.pdf`,
        });
      }
      res.status(502).json({ ok: false, ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.post("/api/admin/sesame-lab/connexion", async (req: Request, res: Response) => {
    try {
      assertSesameLabAllowed();
      const conseiller = { ...defaultConseiller(), ...(req.body?.conseiller || {}) };
      const result = await sesameFetchJson({
        method: "POST",
        path: "/connexion",
        body: { conseiller },
      });
      pushLog({
        at: new Date().toISOString(),
        method: "POST",
        path: "/connexion",
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.post("/api/admin/sesame-lab/dossier/creation", async (req: Request, res: Response) => {
    try {
      assertSesameLabAllowed();
      const sample = buildLabSamplePayload(req.body?.overrides);
      const conseiller = { ...defaultConseiller(), ...(req.body?.conseiller || {}) };
      const body = req.body?.payload || {
        ...sample,
        conseiller,
        referenceDossier: String(req.body?.referenceDossier || `LAB-${Date.now()}`).slice(0, 40),
        emprunteur: req.body?.emprunteur || {
          adresse: {
            codePostal: "44000",
            ligne4: "17 Passage Leroy",
            pays: "FR",
            ville: "NANTES",
          },
          idTypeEmprunteur: 4,
          paiementCotisation: false,
        },
      };
      delete body.assures?.[0]?.produitsATarifer;
      const result = await sesameFetchJson({
        method: "POST",
        path: "/dossier/creation",
        query: { type: "parcours-detaille" },
        body,
        timeoutMs: 90_000,
      });
      pushLog({
        at: new Date().toISOString(),
        method: "POST",
        path: "/dossier/creation",
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.post("/api/admin/sesame-lab/dossier/ouverture", async (req: Request, res: Response) => {
    try {
      assertSesameLabAllowed();
      const idDossier = Number(req.body?.idDossier);
      if (!Number.isFinite(idDossier) || idDossier <= 0) {
        return res.status(400).json({ ok: false, error: "idDossier numérique requis" });
      }
      const conseiller = { ...defaultConseiller(), ...(req.body?.conseiller || {}) };
      const body = {
        conseiller,
        idDossier,
        referenceAssure: String(req.body?.referenceAssure || "ASSURE001"),
      };
      const result = await sesameFetchJson({
        method: "POST",
        path: "/dossier/ouverture",
        query: { type: "parcours-detaille" },
        body,
      });
      pushLog({
        at: new Date().toISOString(),
        method: "POST",
        path: "/dossier/ouverture",
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        ok: result.ok,
        error: result.error,
      });
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, ...result });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  const samplePayloadHandler = (req: Request, res: Response) => {
    try {
      assertSesameLabAllowed();
    } catch {
      /* sample still useful even if auth missing */
    }
    const overrides =
      (req.body && typeof req.body === "object" && req.body.overrides) ||
      (req.body && typeof req.body === "object" && Object.keys(req.body).length ? req.body : undefined);
    res.json({
      ok: true,
      payload: buildLabSamplePayload(overrides),
      note: "Payload construit depuis le formulaire lab (ou exemple si champs vides).",
    });
  };
  app.get("/api/admin/sesame-lab/sample-payload", samplePayloadHandler);
  app.post("/api/admin/sesame-lab/sample-payload", samplePayloadHandler);
}

function summarizePayload(body: any) {
  return {
    codeOffre: body?.codeOffre,
    assures: Array.isArray(body?.assures) ? body.assures.length : 0,
    prets: Array.isArray(body?.prets) ? body.prets.length : 0,
    codeEntite: body?.conseiller?.codeEntiteDistributeur,
  };
}
