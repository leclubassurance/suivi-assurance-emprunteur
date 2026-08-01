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

/** Accepte 3,67 / 3.67 / 69 933,75 — évite taux PDF à 0 quand la saisie FR utilise une virgule. */
function parseFrNumber(raw: unknown, fallback = 0): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function asList(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as any;
    if (Array.isArray(o.liste)) return o.liste;
    if (Array.isArray(o.produits)) return o.produits;
    if (Array.isArray(o.commissionnements)) return o.commissionnements;
    if (Array.isArray(o.items)) return o.items;
  }
  return data ? [data] : [];
}

/** Libellés Kérys → ids options Sésame (env overridables). */
function resolveOptionIds(optionKeys: unknown): number[] {
  const keys = Array.isArray(optionKeys) ? optionKeys.map((k) => String(k)) : [];
  const map: Record<string, number> = {
    dorsales_psy: Math.round(
      parseFrNumber(process.env.SESAME_ID_OPTION_DORSALES_PSY, 55),
    ),
    forfaitaire: Math.round(parseFrNumber(process.env.SESAME_ID_OPTION_FORFAITAIRE, 0)),
  };
  // Fallback liste brute env : SESAME_DEFAULT_ID_OPTIONS=55,56
  const fromEnvDefault = String(process.env.SESAME_DEFAULT_ID_OPTIONS || "")
    .split(/[,;\s]+/)
    .map((x) => Math.round(parseFrNumber(x, 0)))
    .filter((n) => n > 0);

  const out: number[] = [];
  for (const key of keys) {
    const id = map[key];
    if (id && id > 0 && !out.includes(id)) out.push(id);
  }
  // Si forfaitaire coché mais pas d'id connu, on ne l'invente pas.
  if (!out.length && fromEnvDefault.length) return fromEnvDefault;
  return out;
}

function matchCommissionByPct(list: any[], pct: number): { id: string; libelle: string } | null {
  if (!pct || pct <= 0) return null;
  const scored = list
    .map((c) => {
      const id = pickString(c?.id, c?.idCommissionnement, c?.code);
      const libelle = pickString(c?.libelle, c?.label, c?.name);
      if (!id || id === "0") return null;
      const m = libelle.match(/(\d+(?:[.,]\d+)?)\s*%/);
      const libPct = m ? parseFrNumber(m[1], -1) : -1;
      const exact = libPct === pct || new RegExp(`\\bL\\s*${pct}\\b`, "i").test(libelle);
      const soft = libelle.includes(String(pct)) && libelle.includes("%");
      if (!exact && !soft) return null;
      return {
        id,
        libelle: libelle || id,
        score: exact ? 2 : 1,
        defaut: c?.defaut === true ? 1 : 0,
      };
    })
    .filter(Boolean) as Array<{ id: string; libelle: string; score: number; defaut: number }>;
  scored.sort((a, b) => b.score - a.score || b.defaut - a.defaut);
  return scored[0] ? { id: scored[0].id, libelle: scored[0].libelle } : null;
}

async function resolveLineaireCommissionnement(
  codeOffre: string,
  codeProduit: string,
  pct: number,
): Promise<{ id?: string; libelle?: string; note?: string }> {
  if (!pct || pct <= 0) return { note: "L 0% — pas de commissionnement" };
  if (!codeOffre || !codeProduit) {
    return { note: `L ${pct}% demandé mais offre/produit manquants pour résoudre le commissionnement` };
  }
  const path = `/referentiel/offre/${encodeURIComponent(codeOffre)}/produit/${encodeURIComponent(codeProduit)}/commission-distributeur`;
  const res = await sesameFetchJson({ method: "GET", path });
  pushLog({
    at: new Date().toISOString(),
    method: "GET",
    path,
    status: res.status,
    durationMs: res.durationMs,
    requestId: res.requestId,
    ok: res.ok,
    error: res.error,
  });
  if (!res.ok) {
    // Fallback barème déprécié
    const pathBar = `/referentiel/offre/${encodeURIComponent(codeOffre)}/produit/${encodeURIComponent(codeProduit)}/bareme-commission`;
    const bar = await sesameFetchJson({ method: "GET", path: pathBar });
    pushLog({
      at: new Date().toISOString(),
      method: "GET",
      path: pathBar,
      status: bar.status,
      durationMs: bar.durationMs,
      requestId: bar.requestId,
      ok: bar.ok,
      error: bar.error,
    });
    if (bar.ok) {
      const list = asList(bar.data);
      const hit = matchCommissionByPct(
        list.map((b) => ({ id: pickString(b?.code, b?.id), libelle: pickString(b?.libelle, b?.code, `${pct}%`) })),
        pct,
      );
      if (hit) return { id: hit.id, libelle: hit.libelle, note: `barème (deprecated) L ${pct}% → ${hit.id}` };
    }
    return { note: `Impossible de lister les commissionnements (${res.error || res.status})` };
  }
  const hit = matchCommissionByPct(asList(res.data), pct);
  if (!hit) {
    const libs = asList(res.data)
      .map((c) => pickString(c?.libelle, c?.id))
      .filter(Boolean)
      .slice(0, 8);
    return {
      note: `Aucun commissionnement « L ${pct}% » trouvé. Dispo: ${libs.join(" | ") || "—"}`,
    };
  }
  return { id: hit.id, libelle: hit.libelle, note: `L ${pct}% → ${hit.libelle} (${hit.id})` };
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
    // On tente de résoudre un produit (utile pour devis). Tarification peut s'en passer.
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
      codeBareme = bars[0] || "";
      if (codeBareme) resolved.codeBareme = codeBareme;
    }
  }

  if (!codeProduit) {
    console.warn(
      "[SesameLab] Aucun codeProduit résolu — tarification sur tous les produits de l'offre ; devis nécessitera un produit.",
    );
  }

  // Rémunération linéaire Kérys (L 15%) → idCommissionnement
  const lineairePct = Math.round(parseFrNumber(next.remunerationLineairePct, 0));
  if (lineairePct > 0 && (!pickString(next.idCommissionnement) || pickString(next.idCommissionnement) === "0")) {
    const found = await resolveLineaireCommissionnement(codeOffre, codeProduit, lineairePct);
    if (found.id) {
      idCommissionnement = found.id;
      resolved.idCommissionnement = found.id;
      if (found.libelle) resolved.commissionLibelle = found.libelle;
    }
    if (found.note) resolved.commissionNote = found.note;
  } else if (lineairePct <= 0) {
    idCommissionnement = "0";
    resolved.commissionNote = "L 0% — commissionnement omis";
  }

  // Options Kérys (cases) → idOptions numériques
  if (!Array.isArray(next.idOptions) || !(next.idOptions as any[]).length) {
    const fromKeys = resolveOptionIds(next.optionKeys);
    if (fromKeys.length) {
      next.idOptions = fromKeys;
      resolved.idOptions = fromKeys.join(",");
    }
  }

  next.codeOffre = codeOffre;
  // Produit résolu pour le devis ; en tarification on omet produitsATarifer → toutes les propositions.
  if (codeProduit) next.codeProduit = codeProduit;
  // Ne jamais pousser codeBareme + idCommissionnement ensemble.
  const comm = pickString(idCommissionnement);
  if (comm && comm !== "0") {
    next.idCommissionnement = comm;
    delete next.codeBareme;
  } else if (codeBareme) {
    next.codeBareme = codeBareme;
    delete next.idCommissionnement;
  } else {
    delete next.codeBareme;
    delete next.idCommissionnement;
  }
  if (next.fraisDistribution == null) {
    next.fraisDistribution = Number(process.env.SESAME_DEFAULT_FRAIS_DISTRIBUTION || 0);
  }

  // Pour tarifer TOUS les produits AVEC la même rémunération L x%, on remplit produitsATarifer.
  if (comm && comm !== "0" && codeOffre) {
    try {
      const produits = await sesameFetchJson({
        method: "GET",
        path: `/referentiel/offre/${encodeURIComponent(codeOffre)}/produit`,
      });
      if (produits.ok) {
        const codes: string[] = [];
        walkCollect(produits.data, ["codeProduit"], codes);
        if (codes.length) {
          next.produitsATarifer = codes.map((cp) => ({
            codeProduit: cp,
            idCommissionnement: comm,
          }));
          resolved.produitsATarifer = String(codes.length);
        }
      }
    } catch {
      /* non bloquant */
    }
  }

  const note =
    Object.keys(resolved).length > 0
      ? `Catalogue auto (équivalent propositions Kérys) : ${JSON.stringify(resolved)}`
      : "Catalogue déjà fourni via env Railway.";
  console.log("[SesameLab]", note);
  return { overrides: next, resolved, note };
}

async function buildPayloadFromRequest(req: Request, mode: "tarification" | "devis" = "tarification") {
  const rawOverrides =
    (req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : null) ||
    {};
  const { overrides, resolved, note } = await autoResolveCatalogCodes(rawOverrides);
  const body =
    req.body?.payload ||
    (req.body?.codeOffre && Array.isArray(req.body?.assures) ? req.body : null) ||
    buildLabSamplePayload(overrides, { mode });
  return { body, resolved, note, overrides };
}

/** Payload aligné saisie Kérys + règles API PartenaireTarification v2026.7.4. */
export function buildLabSamplePayload(
  overrides?: Record<string, unknown>,
  opts?: { mode?: "tarification" | "devis" },
) {
  const o = overrides || {};
  const mode = opts?.mode || "tarification";
  const codeOffre = String(o.codeOffre || process.env.SESAME_DEFAULT_CODE_OFFRE || "").trim();
  const codeProduit = String(o.codeProduit || process.env.SESAME_DEFAULT_CODE_PRODUIT || "").trim();
  // codeBareme et idCommissionnement sont MUTUELLEMENT EXCLUSIFS (API). Préférer idCommissionnement.
  const idCommissionnementRaw = String(
    o.idCommissionnement ?? process.env.SESAME_DEFAULT_ID_COMMISSIONNEMENT ?? "",
  ).trim();
  // "0" n'est pas un id commissionnement Kereis valide → on omet (frais à 0 restent via fraisDistribution).
  const idCommissionnement =
    idCommissionnementRaw && idCommissionnementRaw !== "0" ? idCommissionnementRaw : "";
  const codeBareme = idCommissionnement
    ? ""
    : String(o.codeBareme || process.env.SESAME_DEFAULT_CODE_BAREME || "").trim();
  const fraisDistribution = Number(
    o.fraisDistribution ?? process.env.SESAME_DEFAULT_FRAIS_DISTRIBUTION ?? 0,
  );
  const conseiller = {
    ...defaultConseiller(),
    ...((o.conseiller as object) || {}),
  };

  const franchise = Math.round(parseFrNumber(o.franchise, 90));
  const idFormule = Math.round(
    parseFrNumber(o.idFormule ?? process.env.SESAME_DEFAULT_ID_FORMULE, 101),
  );
  let idOptions = Array.isArray(o.idOptions)
    ? (o.idOptions as unknown[]).map((x) => Math.round(parseFrNumber(x, 0))).filter((n) => n > 0)
    : [];
  if (!idOptions.length) {
    idOptions = resolveOptionIds(o.optionKeys);
  }

  const pretsInput =
    Array.isArray(o.prets) && o.prets.length
      ? (o.prets as any[])
      : [
          {
            montant: parseFrNumber(o.montantPret ?? o.montant, 150000),
            duree: Math.round(parseFrNumber(o.dureePret ?? o.duree, 240)),
            taux: parseFrNumber(o.tauxPret ?? o.taux, 3.5),
            idTypePret: Number(o.idTypePret ?? 51),
            idTypeAmortissement: Number(o.idTypeAmortissement ?? 100),
            idPeriodiciteEcheancePret: Number(o.idPeriodiciteEcheancePret ?? 3),
            differe: Math.round(parseFrNumber(o.differe ?? o.dureeDiffere, 0)),
          },
        ];

  const prets = pretsInput.map((p, i) => {
    const referencePret = String(p.referencePret || `PRET${String(i + 1).padStart(3, "0")}`);
    const idTypeAmortissement = Number(p.idTypeAmortissement ?? 100);
    const differe = Math.round(parseFrNumber(p.differe ?? p.dureeDiffere, 0));
    const pret: Record<string, unknown> = {
      duree: Math.round(parseFrNumber(p.duree ?? p.dureeRestante, 240)),
      idPeriodiciteEcheancePret: Number(p.idPeriodiciteEcheancePret ?? 3),
      idTypeAmortissement,
      idTypePret: Number(p.idTypePret ?? 51),
      montant: parseFrNumber(p.montant ?? p.capitalRestant, 0),
      referencePret,
      taux: parseFrNumber(p.taux, 0),
    };
    if (p.fraisBancaires != null && p.fraisBancaires !== "") {
      pret.fraisBancaires = parseFrNumber(p.fraisBancaires, 0);
    }
    if (p.dureePrefinancement != null && p.dureePrefinancement !== "") {
      const pref = Math.round(parseFrNumber(p.dureePrefinancement, 0));
      if (pref > 0) pret.dureePrefinancement = pref;
    }
    if (Array.isArray(p.paliers) && p.paliers.length) {
      pret.paliers = p.paliers
        .map((pal: any) => ({
          duree: Math.round(parseFrNumber(pal?.duree, 0)),
          montantEcheance: parseFrNumber(pal?.montantEcheance, 0),
        }))
        .filter((pal: { duree: number; montantEcheance: number }) => pal.duree > 0);
    }
    if (idTypeAmortissement !== 4) {
      pret.differe = Number.isFinite(differe) ? differe : 0;
      if (Number(pret.differe) > 0) {
        pret.idNatureDiffere = Number(p.idNatureDiffere ?? 2);
      }
    } else {
      if (p.loyer != null) pret.loyer = parseFrNumber(p.loyer, 0);
      if (p.valeurResiduelle != null) pret.valeurResiduelle = parseFrNumber(p.valeurResiduelle, 0);
    }
    return pret;
  });

  const produitsATariferOverride = Array.isArray(o.produitsATarifer)
    ? (o.produitsATarifer as any[])
        .map((p) => {
          const cp = pickString(p?.codeProduit, p?.code);
          if (!cp) return null;
          const row: Record<string, unknown> = { codeProduit: cp };
          const idc = pickString(p?.idCommissionnement, idCommissionnement);
          const cb = pickString(p?.codeBareme, codeBareme);
          if (idc && idc !== "0") row.idCommissionnement = idc;
          else if (cb) row.codeBareme = cb;
          return row;
        })
        .filter(Boolean)
    : null;

  const couverturesFor = (opts: { quotite: number; idSportsARisque?: number[] }) =>
    prets.map((p) => {
      const sports = (opts.idSportsARisque || []).filter((n) => Number.isFinite(n) && n > 0);
      const couverture: Record<string, unknown> = {
        franchise,
        idFormule,
        quotite: opts.quotite,
      };
      // Pas de tableaux vides : certaines validations devis R1 les rejettent en 422.
      if (idOptions.length) couverture.idOptions = idOptions;
      if (sports.length) couverture.idSportsARisque = sports;
      return {
        couverture,
        referencePret: p.referencePret,
        veutEtreCouvert: true,
      };
    });

  function buildAssure(src: Record<string, unknown>, index: number): Record<string, unknown> {
    const idStatutProfessionnel = Number(src.idStatutProfessionnel ?? o.idStatutProfessionnel ?? 1);
    const professionLibelle = String(
      src.professionLibelle ||
        src.statutProfessionnelLibelle ||
        o.professionLibelle ||
        o.statutProfessionnelLibelle ||
        "",
    ).trim();
    const idSportsARisque = Array.isArray(src.idSportsARisque)
      ? (src.idSportsARisque as number[])
      : Array.isArray(o.idSportsARisque)
        ? (o.idSportsARisque as number[])
        : [];
    const idProfessionARisque =
      src.idProfessionARisque != null
        ? Number(src.idProfessionARisque)
        : o.idProfessionARisque != null
          ? Number(o.idProfessionARisque)
          : undefined;
    const quotite = Number(src.quotite ?? o.quotite ?? 100);

    const professionManuelle =
      src.professionManuelle === true ||
      o.professionManuelle === true ||
      // Ids annexe manuels / indépendants (6) — ne jamais forcer « administratif ».
      idStatutProfessionnel === 6;
    // IMPORTANT : l’ancien défaut `!== false` → true faisait afficher « Employé de bureau »
    // sur le PDF Cardif même avec statut artisan (id 6) correctement sélectionné.
    const travailAdministratif = professionManuelle
      ? false
      : typeof src.travailAdministratif === "boolean"
        ? src.travailAdministratif
        : typeof o.travailAdministratif === "boolean"
          ? (o.travailAdministratif as boolean)
          : idStatutProfessionnel === 1;

    const assure: Record<string, unknown> = {
      civilite: String(src.civilite || o.civilite || "Monsieur").trim() || "Monsieur",
      codePostalResidenceFiscale: String(
        src.codePostal || src.codePostalResidenceFiscale || o.codePostal || "44000",
      ).trim(),
      couvertures: couverturesFor({ quotite, idSportsARisque }),
      dateNaissance: String(src.dateNaissance || o.dateNaissance || "1990-01-15").trim(),
      encoursImmobilierAssure: Number(src.encoursImmobilierAssure ?? o.encoursImmobilierAssure ?? 0),
      fraisDistribution,
      fumeur: src.fumeur === true || src.fumeur === "true" || o.fumeur === true,
      idCategorieParticuliere: Number(src.idCategorieParticuliere ?? o.idCategorieParticuliere ?? 0),
      idQualite: Number(src.idQualite ?? o.idQualite ?? 3),
      nom: String(src.nom || o.nom || "TEST").trim() || "TEST",
      paysResidenceFiscale: String(src.paysResidenceFiscale || o.paysResidenceFiscale || "FR"),
      prenom: String(src.prenom || o.prenom || "Lab").trim() || "Lab",
      // IMC optionnel mais attendu sur certaines offres devis.
      poids: Math.round(parseFrNumber(src.poids ?? o.poids, 70)),
      taille: Math.round(parseFrNumber(src.taille ?? o.taille, 175)),
      profession: {
        idStatutProfessionnel,
        ...(professionLibelle ? { libelle: professionLibelle.slice(0, 50) } : {}),
        manuelle: professionManuelle,
        travailAdministratif,
        travauxEnHauteur: src.travauxEnHauteur === true || o.travauxEnHauteur === true,
        deplacementsProfessionnels:
          src.deplacementsProfessionnels === true || o.deplacementsProfessionnels === true,
        ...(idProfessionARisque != null && Number.isFinite(idProfessionARisque) && idProfessionARisque > 0
          ? { idProfessionARisque }
          : {}),
      },
      referenceAssure: String(src.referenceAssure || `ASSURE${String(index + 1).padStart(3, "0")}`),
    };
    const sportsOk = idSportsARisque.filter((n) => Number.isFinite(n) && n > 0);
    if (sportsOk.length) assure.idSportsARisque = sportsOk;

    // Produit : priorité au code de cet assuré (colonnes couple), sinon fallback global.
    const codeProduitAssure = String(src.codeProduit || "").trim() || codeProduit;

    if (mode === "tarification") {
      if (produitsATariferOverride?.length) {
        assure.produitsATarifer = produitsATariferOverride;
      } else if (codeProduitAssure && o.forceProduitUnique === true) {
        const produit: Record<string, unknown> = { codeProduit: codeProduitAssure };
        if (idCommissionnement) produit.idCommissionnement = idCommissionnement;
        else if (codeBareme) produit.codeBareme = codeBareme;
        assure.produitsATarifer = [produit];
      }
      // Même en tarification multi-produits : porter la rémunération sur l'assuré si l'API l'accepte.
      if (idCommissionnement) assure.idCommissionnement = idCommissionnement;
      else if (codeBareme) assure.codeBareme = codeBareme;
    } else {
      if (codeProduitAssure) assure.codeProduit = codeProduitAssure;
      if (idCommissionnement) assure.idCommissionnement = idCommissionnement;
      else if (codeBareme) assure.codeBareme = codeBareme;
    }
    return assure;
  }

  const assuresInput =
    Array.isArray(o.assures) && o.assures.length
      ? (o.assures as Record<string, unknown>[])
      : [o as Record<string, unknown>];
  const assures = assuresInput.map((a, i) => buildAssure(a, i));

  return {
    codeOffre,
    conseiller: {
      codeEntiteDistributeur: conseiller.codeEntiteDistributeur,
      nom: conseiller.nom,
      prenom: conseiller.prenom,
    },
    dateEffetGaranties: String(o.dateEffetGaranties || "2026-11-01"),
    idObjetFinancement: Number(o.idObjetFinancement ?? 8),
    assures,
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
    codeProduit: body?.assures?.[0]?.codeProduit || body?.assures?.[0]?.produitsATarifer?.[0]?.codeProduit,
    codeBareme: body?.assures?.[0]?.codeBareme || body?.assures?.[0]?.produitsATarifer?.[0]?.codeBareme,
    idCommissionnement:
      body?.assures?.[0]?.idCommissionnement || body?.assures?.[0]?.produitsATarifer?.[0]?.idCommissionnement,
    produitsATarifer: body?.assures?.[0]?.produitsATarifer,
    pret0: body?.prets?.[0]
      ? {
          differe: body.prets[0].differe,
          idTypeAmortissement: body.prets[0].idTypeAmortissement,
          idPeriodiciteEcheancePret: body.prets[0].idPeriodiciteEcheancePret,
          idNatureDiffere: body.prets[0].idNatureDiffere,
          montant: body.prets[0].montant,
          duree: body.prets[0].duree,
          taux: body.prets[0].taux,
          paliers: Array.isArray(body.prets[0].paliers) ? body.prets[0].paliers.length : 0,
          loyer: body.prets[0].loyer,
          valeurResiduelle: body.prets[0].valeurResiduelle,
        }
      : null,
    couverture0: body?.assures?.[0]?.couvertures?.[0]?.couverture
      ? {
          franchise: body.assures[0].couvertures[0].couverture.franchise,
          idFormule: body.assures[0].couvertures[0].couverture.idFormule,
          idOptions: body.assures[0].couvertures[0].couverture.idOptions,
          quotite: body.assures[0].couvertures[0].couverture.quotite,
        }
      : null,
    remuneration: {
      idCommissionnement:
        body?.assures?.[0]?.idCommissionnement ||
        body?.assures?.[0]?.produitsATarifer?.[0]?.idCommissionnement,
      codeBareme: body?.assures?.[0]?.codeBareme || body?.assures?.[0]?.produitsATarifer?.[0]?.codeBareme,
      produitsATarifer: Array.isArray(body?.assures?.[0]?.produitsATarifer)
        ? body.assures[0].produitsATarifer.length
        : 0,
    },
    assures: Array.isArray(body?.assures) ? body.assures.length : 0,
    assure0Profession: body?.assures?.[0]?.profession
      ? {
          idStatutProfessionnel: body.assures[0].profession.idStatutProfessionnel,
          libelle: body.assures[0].profession.libelle,
          manuelle: body.assures[0].profession.manuelle,
          travailAdministratif: body.assures[0].profession.travailAdministratif,
          travauxEnHauteur: body.assures[0].profession.travauxEnHauteur,
        }
      : null,
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
      const { body, resolved, note } = await buildPayloadFromRequest(req, "tarification");
      const echeancier = String(req.query.echeancier || req.body?.echeancier || "").trim() || undefined;
      const result = await sesameFetchJson({
        method: "POST",
        path: "/tarification",
        query: {
          echeancier,
          reductionCouple: (() => {
            const raw =
              req.body?.reductionCouple ??
              req.body?.overrides?.reductionCouple ??
              (Array.isArray(req.body?.overrides?.assures) && req.body.overrides.assures.length >= 2
                ? true
                : undefined);
            return raw != null ? String(raw) : undefined;
          })(),
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
      const { body, resolved, note } = await buildPayloadFromRequest(req, "devis");
      const missingProduit = Array.isArray(body?.assures)
        ? body.assures.findIndex((a: any) => !a?.codeProduit)
        : 0;
      if (!body?.assures?.length || missingProduit >= 0) {
        return res.status(400).json({
          ok: false,
          error:
            missingProduit > 0
              ? `Assuré ${missingProduit + 1} : sélectionne un produit avant d'exporter le devis.`
              : "Aucun code produit résolu pour le devis. Sélectionne une proposition par assuré.",
          catalogAuto: { resolved, note },
        });
      }
      // Devis : pas de produitsATarifer
      if (Array.isArray(body.assures)) {
        for (const a of body.assures) {
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
          fileName: `sesame-devis-${body?.assures?.[0]?.codeProduit || "lab"}-${Date.now()}.pdf`,
          catalogAuto: { resolved, note },
          requestPayloadPreview: summarizePayload(body),
        });
      }
      res.status(result.status >= 400 && result.status < 600 ? result.status : 502).json({
        ok: false,
        catalogAuto: { resolved, note },
        requestPayloadPreview: summarizePayload(body),
        ...result,
      });
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
      const { body: sample, resolved, note } = await buildPayloadFromRequest(req, "devis");
      const missingProduit = Array.isArray(sample?.assures)
        ? sample.assures.findIndex((a: any) => !a?.codeProduit)
        : 0;
      if (!sample?.assures?.length || missingProduit >= 0) {
        return res.status(400).json({
          ok: false,
          error:
            missingProduit > 0
              ? `Assuré ${missingProduit + 1} : sélectionne un produit avant d'ouvrir le parcours.`
              : "Aucun code produit résolu. Sélectionne une proposition par assuré.",
          catalogAuto: { resolved, note },
        });
      }
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
      // Parcours : comme le devis — produit choisi, pas de liste produitsATarifer
      if (Array.isArray(body.assures)) {
        for (const a of body.assures) {
          delete a.produitsATarifer;
        }
      }
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
      const payload = (result.data || {}) as Record<string, unknown>;
      const lienSesame =
        typeof payload.lienSesame === "string" ? payload.lienSesame : undefined;
      const idDossier =
        typeof payload.id === "number"
          ? payload.id
          : typeof payload.idDossier === "number"
            ? payload.idDossier
            : undefined;
      res.status(result.ok ? 200 : 502).json({
        ok: result.ok,
        catalogAuto: { resolved, note },
        lienSesame,
        idDossier,
        ...result,
      });
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
      const mode = String(req.body?.mode || "tarification") === "devis" ? "devis" : "tarification";
      const { body, resolved, note } = await buildPayloadFromRequest(req, mode);
      res.json({ ok: true, payload: body, catalogAuto: { resolved, note } });
    } catch (err: any) {
      handleLabError(res, err);
    }
  });
}
