/**
 * Routes admin Lab Sésame (environnement test isolé).
 * UX alignée Kérys : codes offre/produit/barème résolus en coulisses (pas saisis).
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

function pickString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function walkCollect(node: unknown, keys: string[], out: string[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkCollect(n, keys, out));
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const k of keys) {
    const s = pickString(o[k]);
    if (s && !out.includes(s)) out.push(s);
  }
  Object.values(o).forEach((v) => walkCollect(v, keys, out));
}

/**
 * Dans Kérys UI, les codes sont invisibles (propositions CARDIF…).
 * Via API partenaires ils sont obligatoires : résolution auto depuis le référentiel.
 */
export async function autoResolveCatalogCodes(
  overrides: Record<string, unknown> = {},
): Promise<{ overrides: Record<string, unknown>; resolved: Record<string, string>; note: string }> {
  const next = { ...overrides };
  const resolved: Record<string, string> = {};

  let codeOffre = pickString(next.codeOffre, process.env.SESAME_DEFAULT_CODE_OFFRE);
  let codeProduit = pickString(next.codeProduit, process.env.SESAME_DEFAULT_CODE_PRODUIT);
  let codeBareme = pickString(next.codeBareme, process.env.SESAME_DEFAULT_CODE_BAREME);
  let idCommissionnement = pickString(
    next.idCommissionnement,
    process.env.SESAME_DEFAULT_ID_COMMISSIONNEMENT,
    "0",
  );

  if (!codeOffre) {
    const offres = await sesameFetchJson({ method: "GET", path: "/referentiel/offre" });
    pushLog({
      at: new Date().toISOString(),
      method: "GET",
      path: "/referentiel/offre",
      status: offres.status,
      durationMs: offres.durationMs,
      requestId: offres.requestId,
      ok: offres.ok,
      error: offres.error,
    });
    if (!offres.ok) {
      throw new Error(
        `Impossible de récupérer les offres Kereis (${offres.error || offres.status}). Vérifie Basic Auth.`,
      );
    }
    const codes: string[] = [];
    walkCollect(offres.data, ["codeOffre", "code"], codes);
    const prefer = codes.find((c) => /sub/i.test(c)) || codes.find((c) => /20/i.test(c)) || codes[0];
    if (!prefer) throw new Error("Aucune offre trouvée dans le référentiel Sésame pour ce compte.");
    codeOffre = prefer;
    resolved.codeOffre = codeOffre;
    if (codes.length) resolved.offresDisponibles = codes.slice(0, 12).join(" | ");
  }

  if (!codeProduit || !codeBareme) {
    const produits = await sesameFetchJson({
      method: "GET",
      path: `/referentiel/offre/${encodeURIComponent(codeOffre)}/produit`,
    });
    pushLog({
      at: new Date().toISOString(),
      method: "GET",
      path: `/referentiel/offre/${codeOffre}/produit`,
      status: produits.status,
      durationMs: produits.durationMs,
      requestId: produits.requestId,
      ok: produits.ok,
      error: produits.error,
    });
    if (!produits.ok) {
      throw new Error(
        `Impossible de récupérer les produits pour l'offre ${codeOffre} (${produits.error || produits.status}).`,
      );
    }
    const list = Array.isArray(produits.data)
      ? produits.data
      : Array.isArray((produits.data as any)?.produits)
        ? (produits.data as any).produits
        : Array.isArray((produits.data as any)?.liste)
          ? (produits.data as any).liste
          : [produits.data];
    const first = (list.find((p: any) => p && typeof p === "object") || {}) as Record<string, unknown>;
    if (!codeProduit) {
      codeProduit = pickString(first.codeProduit, first.code, first.produit);
      if (codeProduit) resolved.codeProduit = codeProduit;
    }
    if (!codeBareme) {
      codeBareme = pickString(first.codeBareme, first.bareme);
      if (codeBareme) resolved.codeBareme = codeBareme;
    }
    if (!pickString(next.idCommissionnement) && !process.env.SESAME_DEFAULT_ID_COMMISSIONNEMENT) {
      const fromProd = pickString(first.idCommissionnement, first.commissionnement);
      if (fromProd) {
        idCommissionnement = fromProd;
        resolved.idCommissionnement = fromProd;
      }
    }
    if (!codeProduit) {
      const prods: string[] = [];
      walkCollect(produits.data, ["codeProduit"], prods);
      codeProduit = prods[0] || "";
      if (codeProduit) resolved.codeProduit = codeProduit;
    }
    if (!codeBareme) {
      const bars: string[] = [];
      walkCollect(produits.data, ["codeBareme", "bareme"], bars);
      codeBareme = bars[0] || "3";
      resolved.codeBareme = codeBareme;
    }
  }

  if (!codeProduit) {
    throw new Error(
      `Offre trouvée (${codeOffre}) mais aucun code produit dans le référentiel. Contacte Kereis / vérifie l'habilitation.`,
    );
  }

  next.codeOffre = codeOffre;
  next.codeProduit = codeProduit;
  next.codeBareme = codeBareme || "3";
  next.idCommissionnement = idCommissionnement || "0";
  if (next.fraisDistribution == null) {
    next.fraisDistribution = Number(process.env.SESAME_DEFAULT_FRAIS_DISTRIBUTION || 0);
  }

  const note =
    Object.keys(resolved).length > 0
      ? `Catalogue auto (équivalent propositions Kérys) : ${JSON.stringify(resolved)}`
      : "Catalogue déjà fourni via env Railway.";
  console.log("[SesameLab]", note);
  return { overrides: next, resolved, note };
}

async function buildPayloadFromRequest(req: Request) {
  const rawOverrides =
    (req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : null) ||
    {};
  const { overrides, resolved, note } = await autoResolveCatalogCodes(rawOverrides);
  const body =
    req.body?.payload ||
    (req.body?.codeOffre && Array.isArray(req.body?.assures) ? req.body : null) ||
    buildLabSamplePayload(overrides);
  return { body, resolved, note, overrides };
}

/** Payload aligné saisie Kérys (codes techniques injectés en coulisses). */
export function buildLabSamplePayload(overrides?: Record<string, unknown>) {
  const o = overrides || {};
  const codeOffre = String(o.codeOffre || process.env.SESAME_DEFAULT_CODE_OFFRE || "").trim();
  const codeProduit = String(o.codeProduit || process.env.SESAME_DEFAULT_CODE_PRODUIT || "").trim();
  const codeBareme = String(o.codeBareme || process.env.SESAME_DEFAULT_CODE_BAREME || "3").trim();
  const idCommissionnement = String(
    o.idCommissionnement ?? process.env.SESAME_DEFAULT_ID_COMMISSIONNEMENT ?? "0",
  ).trim();
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
  const idOptions = Array.isArray(o.idOptions) ? o.idOptions : [];

  const pretsInput =
    Array.isArray(o.prets) && o.prets.length
      ? (o.prets as any[])
      : [
          {
            montant: Number(o.montantPret ?? o.montant ?? 150000),
            duree: Number(o.dureePret ?? o.duree ?? 240),
            taux: Number(o.tauxPret ?? o.taux ?? 3.5),
            idTypePret: Number(o.idTypePret ?? 51),
            idTypeAmortissement: Number(o.idTypeAmortissement ?? 100),
            idPeriodiciteEcheancePret: Number(o.idPeriodiciteEcheancePret ?? 3),
            dureeDiffere: Number(o.dureeDiffere ?? 0),
          },
        ];

  const prets = pretsInput.map((p, i) => {
    const referencePret = String(p.referencePret || `PRET${String(i + 1).padStart(3, "0")}`);
    return {
      duree: Number(p.duree ?? p.dureeRestante ?? 240),
      idPeriodiciteEcheancePret: Number(p.idPeriodiciteEcheancePret ?? 3),
      idTypeAmortissement: Number(p.idTypeAmortissement ?? 100),
      idTypePret: Number(p.idTypePret ?? 51),
      montant: Number(p.montant ?? p.capitalRestant ?? 0),
      referencePret,
      taux: Number(p.taux ?? 0),
      ...(Number(p.dureeDiffere ?? 0) > 0 ? { dureeDiffere: Number(p.dureeDiffere) } : {}),
    };
  });

  const couvertures = prets.map((p) => ({
    couverture: {
      franchise,
      idFormule,
      idOptions,
      idSportsARisque: [],
      quotite,
    },
    referencePret: p.referencePret,
    veutEtreCouvert: true,
  }));

  const assure: Record<string, unknown> = {
    civilite,
    codeBareme,
    codePostalResidenceFiscale: codePostal,
    codeProduit,
    couvertures,
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
    referenceAssure: String(o.referenceAssure || "ASSURE001"),
    produitsATarifer: [{ codeBareme, codeProduit, idCommissionnement }],
  };

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
    prets,
    ...(o.extra && typeof o.extra === "object" ? (o.extra as object) : {}),
  };
}

function handleLabError(res: Response, err: any) {
  const msg = err?.message || String(err);
  console.warn("[SesameLab]", msg);
  const status = /désactivé|production/i.test(msg) ? 403 : /manquants|Credentials/i.test(msg) ? 503 : 500;
  return res.status(status).json({ ok: false, error: msg });
}

function summarizePayload(body: any) {
  return {
    codeOffre: body?.codeOffre,
    codeProduit: body?.assures?.[0]?.codeProduit,
    codeBareme: body?.assures?.[0]?.codeBareme,
    assures: Array.isArray(body?.assures) ? body.assures.length : 0,
    prets: Array.isArray(body?.prets) ? body.prets.length : 0,
    codeEntite: body?.conseiller?.codeEntiteDistributeur,
  };
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

  app.post("/api/admin/sesame-lab/tarification", async (req: Request, res: Response) => {
    try {
      assertSesameLabAllowed();
      const { body, resolved, note } = await buildPayloadFromRequest(req);
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
      res.status(result.ok ? 200 : 502).json({
        ok: result.ok,
        catalogAuto: { resolved, note },
        requestPayloadPreview: summarizePayload(body),
        ...result,
      });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });

  app.post("/api/admin/sesame-lab/devis", async (req: Request, res: Response) => {
    try {
      assertSesameLabAllowed();
      const { body, resolved, note } = await buildPayloadFromRequest(req);
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
      const result = await sesameFetchPdf({ path: "/devis", body, timeoutMs: 90_000 });
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
          catalogAuto: { resolved, note },
        });
      }
      res.status(502).json({ ok: false, catalogAuto: { resolved, note }, ...result });
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
      const { body: sample, resolved, note } = await buildPayloadFromRequest(req);
      const conseiller = { ...defaultConseiller(), ...(req.body?.conseiller || {}) };
      const body = req.body?.payload || {
        ...sample,
        conseiller,
        referenceDossier: String(req.body?.referenceDossier || `LAB-${Date.now()}`).slice(0, 40),
        emprunteur: req.body?.emprunteur || {
          adresse: {
            codePostal: String(req.body?.overrides?.codePostal || "44000"),
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
      res.status(result.ok ? 200 : 502).json({ ok: result.ok, catalogAuto: { resolved, note }, ...result });
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

  app.post("/api/admin/sesame-lab/sample-payload", async (req, res) => {
    try {
      assertSesameLabAllowed();
      const { body, resolved, note } = await buildPayloadFromRequest(req);
      res.json({ ok: true, payload: body, catalogAuto: { resolved, note } });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });
}
