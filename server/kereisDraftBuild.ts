import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { generateContentWithRetry } from "./geminiClient";
import { extractDocsByCategories } from "./documentTextForAnalysis";
import type {
  KereisDraft,
  KereisField,
  KereisFieldConfidence,
} from "../shared/kereisDraftTypes";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Date d'effet prudentielle = aujourd'hui + 3 mois (règle skill Kereis). */
export function defaultEffectDateIso(from = new Date()): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 3);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatFrDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function field(
  label: string,
  value: string | number | boolean | null | undefined,
  confidence: KereisFieldConfidence,
  source?: string,
  note?: string,
): KereisField {
  let v: string | number | boolean | null = null;
  if (value === undefined || value === null || value === "") v = null;
  else if (typeof value === "boolean" || typeof value === "number") v = value;
  else v = String(value).trim() || null;
  return {
    label,
    value: v,
    confidence: v == null || v === "" ? "missing" : confidence,
    source,
    note,
  };
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function mapProfessionToKereis(raw: string): string {
  const t = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!t) return "";
  if (/cadre/.test(t) && /salarie|salarié/.test(t)) return "Salarié Cadre";
  if (/employe de bureau|employé de bureau/.test(t)) return "Employé de bureau";
  if (/non[- ]?cadre|ouvrier|employe/.test(t)) return "Salarié Non-Cadre (hors employé de bureau)";
  if (/fonctionnaire.*a\b|cat\.?\s*a/.test(t)) return "Fonctionnaire Classe A";
  if (/fonctionnaire/.test(t)) return "Fonctionnaire hors Classe A";
  if (/medic|pharmacien|medecin/.test(t)) return "Profession Médicale/Pharmacien";
  if (/infirm|kine|paramedic/.test(t)) return "Profession Paramédicale";
  if (/liberal|auto[- ]?entrepreneur|independant/.test(t))
    return "Profession Libérale (hors Médical/Paramédical)";
  if (/dirigeant|gerant|chef d.?entreprise/.test(t)) return "Dirigeant de Société";
  if (/btp|transport|ouvrier/.test(t)) return "Artisan du BTP/Ouvrier/Professions du Transport";
  if (/artisan/.test(t)) return "Artisan (hors BTP)";
  if (/commercant/.test(t)) return "Commerçant";
  if (/agricole|agriculteur/.test(t)) return "Profession agricole";
  if (/etudiant|saisonnier/.test(t)) return "Saisonnier/Étudiant";
  if (/sans profession|chomage|retire/.test(t)) return "Sans profession";
  return raw;
}

function mapNaturePret(raw: string): string {
  const t = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/modul|palier|echeance modul/.test(t)) return "Prêt échéances modulables";
  if (/variable|revisable/.test(t)) return "Prêt amort. taux variable";
  if (/\bptz\b|taux zero/.test(t)) return "Prêt à Taux Zéro";
  if (/relais/.test(t)) return "Prêt relais";
  return "Prêt Amortissable";
}

type GeminiKereisSlice = {
  civilite?: string;
  dateNaissance?: string;
  banque?: string;
  agence?: string;
  objetFinancement?: string;
  naturePret?: string;
  capitalRestantDu?: number;
  tauxNominal?: number;
  typeTaux?: string;
  dureeRestanteMois?: number;
  franchiseIttJours?: number;
  quotite?: number;
  fumeur?: boolean | null;
  profession?: string;
  warnings?: string[];
};

async function geminiEnrichFromDocs(params: {
  offreText: string;
  tableauText: string;
  clientHint: string;
  effectDateIso: string;
}): Promise<GeminiKereisSlice | null> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    return null;
  }
  const offre = params.offreText.slice(0, 28_000);
  const tableau = params.tableauText.slice(0, 28_000);
  if (offre.length < 40 && tableau.length < 40) return null;

  const prompt = `Tu es un courtier ADE. Extrais les champs utiles pour saisir Kereis.
Date d'effet cible (J+3 mois) : ${params.effectDateIso} (${formatFrDate(params.effectDateIso)}).
Le Capital Restant Dû doit être celui à la date d'effet (pas aujourd'hui) si l'échéancier le permet.
Client connu : ${params.clientHint}

Réponds UNIQUEMENT en JSON:
{
  "civilite": "M." | "Mme" | "",
  "dateNaissance": "JJ/MM/AAAA" | "",
  "banque": "",
  "agence": "",
  "objetFinancement": "Résidence principale" | "Investissement locatif" | "Résidence secondaire" | "Autre" | "",
  "naturePret": "",
  "capitalRestantDu": number | null,
  "tauxNominal": number | null,
  "typeTaux": "Fixe" | "Variable" | "",
  "dureeRestanteMois": number | null,
  "franchiseIttJours": number | null,
  "quotite": number | null,
  "fumeur": true | false | null,
  "profession": "",
  "warnings": ["..."]
}

OFFRE DE PRÊT:
"""
${offre}
"""

TABLEAU D'AMORTISSEMENT:
"""
${tableau}
"""`;

  try {
    const response = await generateContentWithRetry({
      model: process.env.KEREIS_DRAFT_MODEL || "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", temperature: 0.1 },
    });
    const parsed = JSON.parse(String(response?.text || "{}"));
    return parsed && typeof parsed === "object" ? (parsed as GeminiKereisSlice) : null;
  } catch (e: any) {
    console.warn("[kereis-draft] Gemini:", e?.message || e);
    return null;
  }
}

function buildCopyText(draft: Omit<KereisDraft, "copyText">): string {
  const lines: string[] = [];
  lines.push(`## DOSSIER KEREIS — ${draft.clientName || "?"}`);
  lines.push(`Date d'effet : ${draft.effectDateLabel} (${draft.effectDateIso})`);
  lines.push("");
  const dump = (title: string, fields: KereisField[]) => {
    lines.push(`### ${title}`);
    for (const f of fields) {
      const v = f.value == null || f.value === "" ? "—" : String(f.value);
      const flag = f.confidence === "missing" ? " ⚠️" : f.confidence === "low" ? " ?" : "";
      lines.push(`- ${f.label} : ${v}${flag}`);
    }
    lines.push("");
  };
  dump("ÉTAPE 1 — COORDONNÉES", draft.steps.coordonnees);
  dump("ÉTAPE 2 — INFORMATIONS PERSONNELLES", draft.steps.infosPerso);
  lines.push("### ÉTAPE 3 — PRÊTS");
  for (const loan of draft.steps.prets) {
    lines.push(`#### ${loan.label}`);
    for (const f of loan.fields) {
      const v = f.value == null || f.value === "" ? "—" : String(f.value);
      lines.push(`- ${f.label} : ${v}`);
    }
    lines.push("");
  }
  dump("ÉTAPE 4 — PRÊTEUR", draft.steps.preteur);
  dump("ÉTAPE 5 — SIMULATIONS", draft.steps.simulations);
  if (draft.missing.length) {
    lines.push("### À COMPLÉTER");
    for (const m of draft.missing) lines.push(`- ${m}`);
  }
  if (draft.warnings.length) {
    lines.push("### ALERTES");
    for (const w of draft.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}

/** Applique des patches manuels (libellé → valeur) et recalcule missing + copyText. */
export function applyKereisDraftPatches(
  draft: KereisDraft,
  patches: Record<string, string | number | boolean>,
): KereisDraft {
  if (!draft || !patches || !Object.keys(patches).length) return draft;

  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const patchEntries = Object.entries(patches).map(([k, v]) => [norm(k), v, k] as const);

  const patchField = (f: KereisField): KereisField => {
    const fn = norm(f.label);
    const hit = patchEntries.find(([pn]) => pn === fn || fn.includes(pn) || pn.includes(fn));
    if (!hit) return f;
    const value = hit[1];
    return {
      ...f,
      value,
      confidence: "high",
      source: "assistant ADE",
      note: f.note ? `${f.note} · confirmé assistant` : "Confirmé via assistant ADE",
    };
  };

  const next: Omit<KereisDraft, "copyText"> = {
    ...draft,
    steps: {
      coordonnees: draft.steps.coordonnees.map(patchField),
      infosPerso: draft.steps.infosPerso.map(patchField),
      prets: draft.steps.prets.map((loan) => ({
        ...loan,
        fields: loan.fields.map(patchField),
      })),
      preteur: draft.steps.preteur.map(patchField),
      simulations: draft.steps.simulations.map(patchField),
    },
    missing: [],
    warnings: [...(draft.warnings || [])],
  };

  const missing: string[] = [];
  for (const group of [
    next.steps.coordonnees,
    next.steps.infosPerso,
    ...next.steps.prets.map((p) => p.fields),
    next.steps.preteur,
    next.steps.simulations,
  ]) {
    for (const f of group) {
      if (f.confidence === "missing" || f.value == null || f.value === "") missing.push(f.label);
    }
  }
  next.missing = [...new Set(missing)];
  next.computedAt = new Date().toISOString();

  return { ...next, copyText: buildCopyText(next) };
}

/** Construit la fiche Kereis à partir du dossier + documents. */
export async function buildKereisDraftForDossier(params: {
  dossier: Dossier;
  uploadsDir: string;
  actorLabel?: string;
}): Promise<KereisDraft> {
  const { dossier, uploadsDir } = params;
  const effectDateIso = defaultEffectDateIso();
  const effectDateLabel = formatFrDate(effectDateIso);
  const assures = (dossier.formData?.assures || []) as any[];
  const a0 = assures[0] || {};
  const prets = (dossier.formData?.prets || []) as any[];
  const p0 = prets[0] || {};

  const docs = await extractDocsByCategories(dossier, uploadsDir, ["offre", "tableau"]);
  const offreText = docs.filter((d) => d.category === "offre").map((d) => d.text).join("\n\n");
  const tableauText = docs.filter((d) => d.category === "tableau").map((d) => d.text).join("\n\n");

  const clientHint = [a0.civilite, a0.prenom, a0.nom, a0.email, a0.telephone]
    .filter(Boolean)
    .join(" ");

  const ai = await geminiEnrichFromDocs({
    offreText,
    tableauText,
    clientHint,
    effectDateIso,
  });

  const warnings: string[] = [...(ai?.warnings || [])].map(String);
  if (!offreText) warnings.push("Offre de prêt absente ou illisible — champs limités au formulaire.");
  if (!tableauText) warnings.push("Tableau d'amortissement absent ou illisible — CRD / durée à vérifier.");

  const civilite = str(ai?.civilite) || str(a0.civilite) || "";
  const nom = str(a0.nom);
  const prenom = str(a0.prenom);
  const clientName = [civilite, prenom, nom].filter(Boolean).join(" ") || dossier.id;

  const capital =
    num(ai?.capitalRestantDu) ??
    num(p0.capitalRestant) ??
    num(p0.capitalRestantDu) ??
    null;
  const duree =
    num(ai?.dureeRestanteMois) ??
    num(p0.dureeRestante) ??
    null;
  const taux = num(ai?.tauxNominal) ?? num(p0.taux) ?? null;
  const banque = str(ai?.banque) || str(p0.banquePreteuse) || "";
  const nature =
    mapNaturePret(str(ai?.naturePret) || str(p0.naturePret) || str(p0.modaliteRemboursement)) ||
    "Prêt Amortissable";
  const professionRaw = str(ai?.profession) || str(a0.profession) || str(a0.statutProfessionnel) || "";
  const professionKereis = professionRaw ? mapProfessionToKereis(professionRaw) : "";
  const objet =
    str(ai?.objetFinancement) ||
    str(p0.objetFinancement) ||
    "Résidence principale";
  const franchise = num(ai?.franchiseIttJours) ?? 90;
  const quotite = num(ai?.quotite) ?? (assures.length > 1 ? null : 100);

  const lemoineEligible = capital != null && capital <= 200_000;

  const coordonnees: KereisField[] = [
    field("Civilité", civilite || null, civilite ? "medium" : "missing", ai?.civilite ? "ia" : "formulaire"),
    field("Nom", nom || null, nom ? "high" : "missing", "formulaire"),
    field("Prénom", prenom || null, prenom ? "high" : "missing", "formulaire"),
    field(
      "Date de naissance",
      str(ai?.dateNaissance) || str(a0.dateNaissance) || null,
      ai?.dateNaissance || a0.dateNaissance ? "medium" : "missing",
      ai?.dateNaissance ? "ia" : "formulaire",
    ),
    field("Email", str(a0.email) || null, a0.email ? "high" : "missing", "formulaire"),
    field("Téléphone", str(a0.telephone) || null, a0.telephone ? "high" : "missing", "formulaire"),
    field(
      "Co-assuré",
      assures.length > 1 ? `${assures.length} assurés` : "Emprunteur seul",
      "high",
      "formulaire",
    ),
  ];

  const infosPerso: KereisField[] = [
    field("Qualité", "Emprunteur", "medium", "défaut"),
    field(
      "Résidence fiscale",
      str(a0.codePostal) ? `France — ${a0.codePostal}` : "France",
      a0.codePostal ? "high" : "medium",
      "formulaire",
    ),
    field(
      "Statut professionnel (Kereis)",
      professionKereis || null,
      professionKereis ? "medium" : "missing",
      professionRaw ? "ia/formulaire" : undefined,
      professionRaw && professionRaw !== professionKereis ? `Brut : ${professionRaw}` : undefined,
    ),
    field("Profession à risque", "N'exerce aucune de ces professions", "low", "défaut", "À confirmer avec le client"),
    field("Profession manuelle", "Non", "low", "défaut"),
    field("Travaux en hauteur", "Non", "low", "défaut"),
    field("Déplacements pro / an", "< 20 000 km", "low", "défaut"),
    field(
      "Fumeur",
      ai?.fumeur == null ? null : ai.fumeur ? "Oui" : "Non",
      ai?.fumeur == null ? "missing" : "medium",
      "ia",
      "Fumeur = tabac dans les 2 dernières années",
    ),
  ];

  const loanFields: KereisField[] = [
    field("Date d'effet", effectDateLabel, "high", "règle J+3 mois"),
    field("Objet du financement", objet, objet ? "medium" : "missing", ai?.objetFinancement ? "ia" : "formulaire"),
    field("Nature du prêt", nature, "medium", ai?.naturePret ? "ia" : "formulaire"),
    field(
      "Capital restant dû (à la date d'effet)",
      capital,
      capital != null ? (ai?.capitalRestantDu != null ? "medium" : "low") : "missing",
      ai?.capitalRestantDu != null ? "ia+échéancier" : "formulaire",
      "Vérifier la ligne de l'échéancier à la date d'effet",
    ),
    field("Taux nominal (hors assurance)", taux, taux != null ? "medium" : "missing", ai?.tauxNominal != null ? "ia" : "formulaire"),
    field(
      "Type de taux",
      str(ai?.typeTaux) || str(p0.typeTaux) || null,
      ai?.typeTaux || p0.typeTaux ? "medium" : "missing",
    ),
    field("Type d'échéances", str(p0.modaliteRemboursement) || "Constantes", "low", "formulaire/défaut"),
    field("Périodicité", str(p0.periodicite) || "Mensuel", "medium", "formulaire"),
    field("Durée restante (mois)", duree, duree != null ? "medium" : "missing", ai?.dureeRestanteMois != null ? "ia" : "formulaire"),
    field("Durée différé", num(p0.differeAmortissement) ?? 0, "low", "formulaire"),
  ];

  const preteur: KereisField[] = [
    field("Banque", banque || null, banque ? "medium" : "missing", ai?.banque ? "ia" : "formulaire"),
    field("Agence / détail", str(ai?.agence) || null, ai?.agence ? "low" : "missing", "ia"),
  ];

  const simulations: KereisField[] = [
    field("Garanties", "DC-PTIA-ITT/IPT/IPP", "high", "standard"),
    field("Quotité", quotite != null ? `${quotite} %` : null, quotite != null ? "medium" : "missing", "ia/défaut"),
    field("Franchise ITT", `${franchise} jours`, "medium", ai?.franchiseIttJours != null ? "ia" : "défaut 90j"),
    field("Options", "Affections dorsales/psy sans hospit + Indemnisation forfaitaire", "high", "standard"),
    field(
      "Loi Lemoine — questionnaire santé",
      lemoineEligible ? "NON requis (encours ≤ 200 000 € / assuré)" : "Questionnaire probable (encours > 200 000 €)",
      capital != null ? "medium" : "low",
      "règle Lemoine",
    ),
    field("Autres crédits immobiliers en cours", "NON (sauf indication contraire)", "low", "défaut"),
  ];

  const missing: string[] = [];
  for (const group of [coordonnees, infosPerso, loanFields, preteur, simulations]) {
    for (const f of group) {
      if (f.confidence === "missing") missing.push(f.label);
    }
  }

  const provider: KereisDraft["provider"] =
    ai && (offreText || tableauText) ? "mixed" : ai ? "gemini" : "heuristic";

  const base: Omit<KereisDraft, "copyText"> = {
    computedAt: new Date().toISOString(),
    effectDateIso,
    effectDateLabel,
    clientName,
    steps: {
      coordonnees,
      infosPerso,
      prets: [{ label: `Prêt 1 — ${nature}`, fields: loanFields }],
      preteur,
      simulations,
    },
    missing: [...new Set(missing)],
    warnings,
    sourceDocs: docs.map((d) => ({
      category: d.category,
      name: d.name,
      chars: d.chars,
    })),
    provider,
  };

  const draft: KereisDraft = { ...base, copyText: buildCopyText(base) };

  (dossier as any).kereisDraft = draft;
  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "SYSTEM", label: params.actorLabel || "Kereis draft" },
    message: `Fiche Kereis générée (${draft.provider}) — effet ${draft.effectDateLabel}, ${draft.missing.length} champ(s) à compléter.`,
    meta: { template: "KEREIS_DRAFT", missing: draft.missing.length, provider: draft.provider },
  });
  dossier.updatedAt = new Date().toISOString();

  return draft;
}
