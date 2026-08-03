/**
 * Mappe fiche Kereis (draft) + formData dossier → overrides payload Lab Sésame.
 * Annexe offre changement d'assurance (10157).
 */
import type { Dossier } from "./dossierModel";
import type { KereisDraft, KereisField } from "../shared/kereisDraftTypes";

const STATUT_LABEL_TO_ID: Record<string, number> = {
  "salarié cadre": 10131,
  "salarie cadre": 10131,
  "employé de bureau": 10095,
  "employe de bureau": 10095,
  "salarié non-cadre (hors employé de bureau)": 10132,
  "salarie non-cadre (hors employe de bureau)": 10132,
  "fonctionnaire classe a": 34,
  "fonctionnaire hors classe a": 10135,
  "retraité cadre": 10133,
  "retraite cadre": 10133,
  "retraité non-cadre": 10134,
  "retraite non-cadre": 10134,
  "dirigeant de société": 10136,
  "dirigeant de societe": 10136,
  "profession libérale (hors médical/paramédical)": 10137,
  "profession liberale (hors medical/paramedical)": 10137,
  "profession médicale/pharmacien": 10138,
  "profession medicale/pharmacien": 10138,
  "profession paramédicale": 10139,
  "profession paramedicale": 10139,
  "artisan (hors btp)": 10127,
  "commerçant": 48,
  "commercant": 48,
  "artisan du btp/ouvrier/professions du transport": 10140,
  "artisan du btp / ouvrier / professions du transport": 10140,
  "profession agricole": 10100,
  "saisonnier/étudiant": 10141,
  "saisonnier/etudiant": 10141,
  "sans profession": 22,
};

const MANUAL_STATUT_IDS = new Set([10127, 10140, 48, 10100]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldVal(fields: KereisField[] | undefined, labelPart: string): string {
  if (!fields?.length) return "";
  const want = norm(labelPart);
  const hit = fields.find((f) => norm(String(f.label || "")).includes(want));
  if (!hit || hit.value == null || hit.value === "") return "";
  return String(hit.value).trim();
}

function parseNum(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace("%", "").replace(",", ".");
  // Refuse les libellés (ex. "MARCHANDE" collé par erreur dans le taux).
  if (/[a-zA-Zàâäéèêëïîôùûüç]/.test(cleaned.replace(/[eE][+-]?\d+$/, ""))) return null;
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseDateIso(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  const frLong = s.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (frLong) {
    const months: Record<string, string> = {
      janvier: "01",
      fevrier: "02",
      mars: "03",
      avril: "04",
      mai: "05",
      juin: "06",
      juillet: "07",
      aout: "08",
      septembre: "09",
      octobre: "10",
      novembre: "11",
      decembre: "12",
    };
    const mo = months[norm(frLong[2])];
    if (mo) return `${frLong[3]}-${mo}-${frLong[1].padStart(2, "0")}`;
  }
  return "";
}

function statutIdFromLabel(label: string): number {
  const n = norm(label);
  if (STATUT_LABEL_TO_ID[n] != null) return STATUT_LABEL_TO_ID[n];
  for (const [k, id] of Object.entries(STATUT_LABEL_TO_ID)) {
    if (n.includes(k) || k.includes(n)) return id;
  }
  if (/btp|transport|paysag|ouvrier|manutention/.test(n)) return 10140;
  if (/artisan|chef d.?equipe/.test(n)) return 10127;
  if (/bureau/.test(n)) return 10095;
  if (/cadre/.test(n) && !/non/.test(n)) return 10131;
  return 10095;
}

function civiliteFromAssure(a: any): string {
  const c = String(a?.civilite || "Monsieur").trim();
  if (/^mme|^madame/i.test(c)) return "Madame";
  if (/^mlle|^mademoiselle/i.test(c)) return "Madame";
  return "Monsieur";
}

/**
 * Construit les overrides attendus par buildLabSamplePayload / sesame lab.
 */
export function buildSesameOverridesFromDossier(dossier: Dossier): {
  overrides: Record<string, unknown>;
  warnings: string[];
} {
  const draft = (dossier as any).kereisDraft as KereisDraft | undefined;
  const form = (dossier as any).formData || {};
  const assuresForm = Array.isArray(form.assures) ? form.assures : [];
  const pretsForm = Array.isArray(form.prets) ? form.prets : [];
  const warnings: string[] = [];

  const infos = draft?.steps?.infosPerso || [];
  const coords = draft?.steps?.coordonnees || [];
  const loan0 = draft?.steps?.prets?.[0]?.fields || [];
  const sim = draft?.steps?.simulations || [];

  const effectIso =
    draft?.effectDateIso ||
    parseDateIso(fieldVal(loan0, "date d'effet")) ||
    "";
  if (!effectIso) warnings.push("Date d'effet absente — défaut lab utilisé.");

  const capital =
    parseNum(fieldVal(loan0, "capital restant")) ??
    parseNum(String(pretsForm[0]?.capitalRestantDu || pretsForm[0]?.montant || "")) ??
    null;
  const duree =
    parseNum(fieldVal(loan0, "duree restante")) ??
    parseNum(String(pretsForm[0]?.dureeMois || pretsForm[0]?.duree || "")) ??
    null;
  const taux =
    parseNum(fieldVal(loan0, "taux nominal")) ??
    parseNum(String(pretsForm[0]?.taux || "")) ??
    null;

  if (capital == null) warnings.push("CRD manquant.");
  if (duree == null) warnings.push("Durée restante manquante.");

  const franchise =
    parseNum(fieldVal(sim, "franchise")) ??
    parseNum(String(form.franchiseItt || form.franchise || "90")) ??
    90;
  const quotite =
    parseNum(fieldVal(sim, "quotite")) ??
    parseNum(String(assuresForm[0]?.quotite || "100")) ??
    100;

  const statutLabel =
    fieldVal(infos, "statut professionnel") ||
    String(assuresForm[0]?.statutPro || "") ||
    "Employé de bureau";
  const idStatut = statutIdFromLabel(statutLabel);
  const professionLibelle =
    fieldVal(infos, "profession") ||
    String(assuresForm[0]?.profession || statutLabel).trim() ||
    statutLabel;

  const cp =
    fieldVal(coords, "code postal") ||
    String(form.codePostal || assuresForm[0]?.codePostal || "44000").trim() ||
    "44000";

  const assures = (assuresForm.length ? assuresForm : [{}]).map((a: any, i: number) => {
    const birth =
      parseDateIso(String(a?.dateNaissance || "")) ||
      parseDateIso(fieldVal(infos, "date de naissance")) ||
      "1990-01-15";
    const manuelle =
      MANUAL_STATUT_IDS.has(idStatut) ||
      /oui|true/i.test(fieldVal(infos, "profession manuelle")) ||
      Boolean(a?.professionManuelle);
    return {
      civilite: civiliteFromAssure(a),
      prenom: String(a?.prenom || fieldVal(coords, "prenom") || "Lab").trim(),
      nom: String(a?.nom || fieldVal(coords, "nom") || "TEST").trim(),
      dateNaissance: birth,
      codePostal: cp,
      fumeur: a?.fumeur === true || /oui|true/i.test(fieldVal(infos, "fumeur")),
      professionLibelle: i === 0 ? professionLibelle : String(a?.profession || professionLibelle),
      statutProfessionnelLibelle: statutLabel,
      idStatutProfessionnel: idStatut,
      idQualite: 3,
      professionManuelle: manuelle,
      travailAdministratif: !manuelle && idStatut === 10095,
      travauxEnHauteur:
        a?.travauxHauteur === true || /oui|true/i.test(fieldVal(infos, "hauteur")),
      deplacementsProfessionnels: false,
      quotite: parseNum(String(a?.quotite || "")) || quotite,
      referenceAssure: `ASSURE${String(i + 1).padStart(3, "0")}`,
      encoursImmobilierAssure: 0,
    };
  });

  const overrides: Record<string, unknown> = {
    dateEffetGaranties: effectIso || undefined,
    idObjetFinancement: 8,
    franchise,
    idFormule: 101,
    optionKeys: ["dorsales_psy", "forfaitaire"],
    remunerationLineairePct: 15,
    fraisDistribution: 0,
    baseMontantPret: "crd",
    encoursImmobilierAssure: 0,
    reductionCouple: assures.length >= 2,
    assures,
    prets: [
      {
        capitalRestant: capital ?? 0,
        montant: capital ?? 0,
        taux: taux ?? 0,
        duree: duree ?? 240,
        differe: 0,
        idTypePret: 51,
        idPeriodiciteEcheancePret: 3,
        idTypeAmortissement: 100,
        referencePret: "PRET001",
      },
    ],
  };

  return { overrides, warnings };
}
