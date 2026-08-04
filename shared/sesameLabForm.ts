/**
 * Formulaire Sésame partagé (Lab + parcours étude dossier).
 * Source de vérité pour tarification : champs typés → formToOverrides → API.
 * Ne jamais tarifrer depuis des libellés Kereis libres.
 */
import type { KereisDraft, KereisField } from "./kereisDraftTypes";
import {
  extractTauxNominalFromText,
  formatTauxForForm,
  looksLikeLoanCapital,
  looksLikeLoanDurationMonths,
  looksLikeLoanRate,
  parseLoanNumber,
} from "./loanMetricsExtract";

export type PalierForm = {
  duree: string;
  montantEcheance: string;
};

export type PretForm = {
  nature: string;
  capitalRestant: string;
  taux: string;
  typeTaux: string;
  periodicite: string;
  dureeRestante: string;
  dureeDiffere: string;
  natureDiffere: string;
  typeEcheances: string;
  mensualite: string;
  paliers: PalierForm[];
  loyer: string;
  valeurResiduelle: string;
  fraisBancaires: string;
  dureePrefinancement: string;
  datePremiereEcheance: string;
};

export type AssureForm = {
  civilite: string;
  prenom: string;
  nom: string;
  dateNaissance: string;
  email: string;
  telephone: string;
  qualite: string;
  codePostal: string;
  statutPro: string;
  profession: string;
  professionRisque: string;
  professionManuelle: boolean;
  travauxHauteur: boolean;
  deplacementsPro: string;
  fumeur: boolean;
  sportsRisque: boolean;
  selectedSports: string[];
  quotite: string;
};

export type LabForm = {
  dateEffetGaranties: string;
  objetFinancement: string;
  franchise: string;
  formule: string;
  optionKeys: string[];
  remunerationLineairePct: string;
  autresCreditsOui: boolean;
  encoursImmobilierAssure: string;
  banquePreteuse: string;
};

export const EMPTY_PALIER = (): PalierForm => ({ duree: "", montantEcheance: "" });

export const EMPTY_PRET = (): PretForm => ({
  nature: "amortissable",
  capitalRestant: "",
  taux: "",
  typeTaux: "fixe",
  periodicite: "mensuel",
  dureeRestante: "",
  dureeDiffere: "0",
  natureDiffere: "total",
  typeEcheances: "constantes",
  mensualite: "",
  paliers: [EMPTY_PALIER(), EMPTY_PALIER()],
  loyer: "",
  valeurResiduelle: "",
  fraisBancaires: "0",
  dureePrefinancement: "",
  datePremiereEcheance: "",
});

export const EMPTY_ASSURE = (): AssureForm => ({
  civilite: "Monsieur",
  prenom: "",
  nom: "",
  dateNaissance: "",
  email: "",
  telephone: "",
  qualite: "EMPRUNTEUR",
  codePostal: "",
  statutPro: "employe_bureau",
  profession: "",
  professionRisque: "aucun",
  professionManuelle: false,
  travauxHauteur: false,
  deplacementsPro: "< 20000 Km",
  fumeur: false,
  sportsRisque: false,
  selectedSports: [],
  quotite: "100",
});

export const EMPTY_LAB_FORM: LabForm = {
  dateEffetGaranties: new Date(new Date().setMonth(new Date().getMonth() + 3))
    .toISOString()
    .slice(0, 10),
  objetFinancement: "residence_principale",
  franchise: "90",
  formule: "101",
  optionKeys: ["dorsales_psy", "forfaitaire"],
  remunerationLineairePct: "15",
  autresCreditsOui: false,
  encoursImmobilierAssure: "0",
  banquePreteuse: "",
};

export function parseFrNumber(raw: unknown, fallback = 0): number {
  const n = parseLoanNumber(raw);
  return n != null ? n : fallback;
}

export const FORMULE_OPTIONS = [
  { value: "101", label: "Décès-PTIA-ITT/IPT", id: 101 },
  { value: "102", label: "Décès-PTIA-ITT/IPT/IPP", id: 102 },
  { value: "100", label: "Décès-PTIA", id: 100 },
  { value: "103", label: "Décès seul", id: 103 },
];

export const OPTION_PRESETS = [
  {
    key: "dorsales_psy",
    label: "Affections dorsales et psy sans hospitalisation",
  },
  {
    key: "forfaitaire",
    label: "Indemnisation forfaitaire (non limitée à la perte de salaire)",
  },
];

export const REMUNERATION_OPTIONS = [
  { value: "0", label: "L 0% (sans commission)" },
  { value: "5", label: "L 5%" },
  { value: "10", label: "L 10%" },
  { value: "15", label: "L 15%" },
  { value: "20", label: "L 20%" },
  { value: "25", label: "L 25%" },
];

export const OBJET_OPTIONS = [
  { value: "residence_principale", label: "Résidence principale", id: 8 },
  { value: "residence_secondaire", label: "Résidence secondaire", id: 9 },
  { value: "investissement_locatif", label: "Investissement locatif", id: 10 },
  { value: "autre", label: "Autre", id: 11 },
];

export const NATURE_PRET_OPTIONS = [
  { value: "amortissable", label: "Prêt amortissable", idTypePret: 51 },
  { value: "ptz", label: "Prêt à Taux Zéro (PTZ)", idTypePret: 52 },
  { value: "modulable", label: "Prêt échéances modulables", idTypePret: 53 },
  { value: "in_fine", label: "Prêt In Fine", idTypePret: 54 },
];

export const TYPE_ECHEANCES_OPTIONS = [
  {
    value: "constantes",
    label: "Mensualités / échéances constantes",
    idTypeAmortissement: 100,
  },
  {
    value: "paliers",
    label: "Prêt à paliers (échéances variables)",
    idTypeAmortissement: 100,
  },
  {
    value: "credit_bail",
    label: "Crédit-bail",
    idTypeAmortissement: 4,
  },
];

export const PERIODICITE_OPTIONS = [
  { value: "annuel", label: "Annuelle", id: 1 },
  { value: "semestriel", label: "Semestrielle", id: 2 },
  { value: "mensuel", label: "Mensuelle", id: 3 },
  { value: "trimestriel", label: "Trimestrielle", id: 4 },
];

export const NATURE_DIFFERE_OPTIONS = [
  { value: "partiel", label: "Différé partiel (intérêts seulement)", id: 1 },
  { value: "total", label: "Différé total", id: 2 },
];

export const TYPE_TAUX_OPTIONS = [
  { value: "fixe", label: "Taux fixe" },
  { value: "variable", label: "Taux variable / révisable" },
];

export const FRANCHISE_OPTIONS = [
  { value: "30", label: "30 jours" },
  { value: "60", label: "60 jours" },
  { value: "90", label: "90 jours" },
  { value: "180", label: "180 jours" },
];

export const QUALITE_OPTIONS = [
  { value: "EMPRUNTEUR", label: "Emprunteur" },
  { value: "CAUTION_PP", label: "Caution de personne physique" },
  { value: "CAUTION_PM", label: "Caution ou dirigeant de personne morale" },
];

export const STATUT_PRO_OPTIONS = [
  { value: "salarie_cadre", label: "Salarié Cadre" },
  { value: "employe_bureau", label: "Employé de bureau" },
  { value: "salarie_noncadre", label: "Salarié Non-Cadre" },
  { value: "fonctionnaire_a", label: "Fonctionnaire Classe A" },
  { value: "fonctionnaire_autre", label: "Fonctionnaire hors Classe A" },
  { value: "retraite_cadre", label: "Retraité Cadre" },
  { value: "retraite_noncadre", label: "Retraité Non-Cadre" },
  { value: "dirigeant", label: "Dirigeant de Société" },
  { value: "profession_liberale", label: "Profession Libérale (hors Médical/Paramédical)" },
  { value: "profession_medicale", label: "Profession Médicale/Pharmacien" },
  { value: "profession_paramedical_salarie", label: "Profession Paramédicale (Salarié)" },
  { value: "profession_paramedical_fonctionnaire", label: "Profession Paramédicale (Fonctionnaire)" },
  { value: "profession_paramedical_liberal", label: "Profession Paramédicale (Libéral)" },
  { value: "artisan_nonbtp", label: "Artisan (hors BTP)" },
  { value: "commercant", label: "Commerçant" },
  { value: "artisan_btp", label: "Artisan du BTP/Ouvrier/Professions du Transport" },
  { value: "profession_agricole", label: "Profession agricole" },
  { value: "saisonnier", label: "Saisonnier/Étudiant" },
  { value: "sans_profession", label: "Sans profession" },
  { value: "autre", label: "Autre (saisie manuelle)" },
];

export const PROFESSION_RISQUE_OPTIONS = [
  { value: "aucun", label: "N'exerce aucune de ces professions" },
  { value: "marin_pecheur", label: "Marin pêcheur" },
  { value: "aviation", label: "Métier de l'aviation hors lignes régulières" },
  { value: "armee_police", label: "Métiers de l'armée, police, gendarmerie" },
  { value: "securite", label: "Métiers de la sécurité (agent, vigile)" },
  { value: "cirque", label: "Métiers du cirque, cascadeurs, intermittents du spectacle" },
  { value: "plongeur", label: "Plongeur avec appareil autonome" },
  { value: "pompier", label: "Pompier, Secouriste, Sauveteur" },
  { value: "missions_humanitaires", label: "Missions humanitaires hors UE" },
  { value: "sportif_pro", label: "Sportif professionnel" },
  { value: "transport_explosifs", label: "Transport d'explosifs/matières dangereuses" },
  { value: "manipulation_explosifs", label: "Manipulation d'explosifs/substances chimiques" },
  { value: "travail_hauteur", label: "Travail en hauteur > 20m" },
  { value: "travail_souterrain", label: "Travail souterrain/Mineur" },
  { value: "travail_site_specifique", label: "Travail site on-shore/volcanique/archéologique/minière/forestière/pétrolière/nucléaire" },
];

export const DEPLACEMENTS_PRO_OPTIONS = [
  { value: "< 20000 Km", label: "< 20 000 Km" },
  { value: "20000-50000 Km", label: "20 000 - 50 000 Km" },
  { value: "> 50000 Km", label: "> 50 000 Km" },
];

/** Annexe 10157 idStatutProfessionnel. */
export const STATUT_PRO_TO_SESAME_ID: Record<string, number> = {
  salarie_cadre: 10131,
  employe_bureau: 10095,
  salarie_noncadre: 10132,
  fonctionnaire_a: 34,
  fonctionnaire_autre: 10135,
  retraite_cadre: 10133,
  retraite_noncadre: 10134,
  dirigeant: 10136,
  profession_liberale: 10137,
  profession_medicale: 10138,
  profession_paramedical_salarie: 10139,
  profession_paramedical_fonctionnaire: 10139,
  profession_paramedical_liberal: 10139,
  artisan_nonbtp: 10127,
  commercant: 48,
  artisan_btp: 10140,
  profession_agricole: 10100,
  saisonnier: 10141,
  sans_profession: 22,
  autre: 10095,
};

export const PROFESSION_RISQUE_TO_SESAME_ID: Record<string, number> = {
  aucun: 0,
  marin_pecheur: 596,
  aviation: 592,
  armee_police: 590,
  securite: 591,
  cirque: 588,
  plongeur: 595,
  pompier: 593,
  missions_humanitaires: 589,
  sportif_pro: 594,
  transport_explosifs: 584,
  manipulation_explosifs: 583,
  travail_hauteur: 587,
  travail_souterrain: 585,
  travail_site_specifique: 586,
};

export const QUALITE_TO_SESAME_ID: Record<string, number> = {
  EMPRUNTEUR: 3,
  CAUTION_PP: 4,
  CAUTION_PM: 5,
};

/** Même mapper que le Lab Sésame — unique source pour tarifer. */
export function formToOverrides(
  form: LabForm,
  assures: AssureForm[],
  prets: PretForm[],
): Record<string, unknown> {
  const objet = OBJET_OPTIONS.find((o) => o.value === form.objetFinancement);
  const formule = FORMULE_OPTIONS.find((f) => f.value === form.formule) || FORMULE_OPTIONS[0];
  return {
    dateEffetGaranties: form.dateEffetGaranties || undefined,
    idObjetFinancement: objet?.id ?? 8,
    franchise: Math.round(parseFrNumber(form.franchise, 90)),
    idFormule: formule.id,
    optionKeys: form.optionKeys,
    remunerationLineairePct: Math.round(parseFrNumber(form.remunerationLineairePct, 15)),
    fraisDistribution: 0,
    baseMontantPret: "crd",
    encoursImmobilierAssure: form.autresCreditsOui
      ? parseFrNumber(form.encoursImmobilierAssure, 0)
      : 0,
    reductionCouple: assures.length >= 2,
    assures: assures.map((a, i) => {
      const statutLabel =
        STATUT_PRO_OPTIONS.find((o) => o.value === a.statutPro)?.label || a.statutPro;
      const idStatutProfessionnel = STATUT_PRO_TO_SESAME_ID[a.statutPro] ?? 10095;
      const isOfficeStatut =
        a.statutPro === "employe_bureau" ||
        a.statutPro === "salarie_cadre" ||
        a.statutPro === "salarie_noncadre";
      const isManualStatut =
        a.statutPro === "artisan_btp" ||
        a.statutPro === "artisan_nonbtp" ||
        a.statutPro === "profession_agricole" ||
        a.statutPro === "commercant";
      const professionManuelle = a.professionManuelle || isManualStatut;
      const idProfessionARisque = PROFESSION_RISQUE_TO_SESAME_ID[a.professionRisque];
      return {
        civilite: a.civilite === "M." ? "Monsieur" : a.civilite === "Mme" ? "Madame" : a.civilite,
        prenom: a.prenom.trim() || undefined,
        nom: a.nom.trim() || undefined,
        dateNaissance: a.dateNaissance || undefined,
        codePostal: a.codePostal.trim() || undefined,
        fumeur: a.fumeur,
        professionLibelle: a.profession.trim() || statutLabel,
        statutProfessionnelLibelle: statutLabel,
        idStatutProfessionnel,
        idQualite: QUALITE_TO_SESAME_ID[a.qualite] ?? 3,
        professionManuelle,
        travailAdministratif: isOfficeStatut && !professionManuelle,
        travauxEnHauteur: a.travauxHauteur,
        deplacementsProfessionnels: a.deplacementsPro !== "< 20000 Km",
        ...(idProfessionARisque != null && idProfessionARisque > 0
          ? { idProfessionARisque }
          : {}),
        professionRisque: a.professionRisque,
        sportsRisque: a.sportsRisque,
        selectedSports: a.sportsRisque ? a.selectedSports : [],
        quotite: parseFrNumber(a.quotite, 100),
        referenceAssure: `ASSURE${String(i + 1).padStart(3, "0")}`,
        encoursImmobilierAssure: form.autresCreditsOui
          ? parseFrNumber(form.encoursImmobilierAssure, 0)
          : 0,
      };
    }),
    prets: prets
      .filter((p) => p.capitalRestant.trim() || (p.typeEcheances === "credit_bail" && p.loyer.trim()))
      .map((p) => {
        const nature = NATURE_PRET_OPTIONS.find((n) => n.value === p.nature);
        const echeances = TYPE_ECHEANCES_OPTIONS.find((n) => n.value === p.typeEcheances);
        const periodicite = PERIODICITE_OPTIONS.find((n) => n.value === p.periodicite);
        const natureDiffere = NATURE_DIFFERE_OPTIONS.find((n) => n.value === p.natureDiffere);
        const differe = Math.round(parseFrNumber(p.dureeDiffere, 0));
        const idTypeAmortissement = echeances?.idTypeAmortissement ?? 100;
        const out: Record<string, unknown> = {
          capitalRestant: parseFrNumber(p.capitalRestant, 0),
          montant: parseFrNumber(p.capitalRestant, 0),
          taux: parseFrNumber(p.taux, 0),
          duree: Math.round(parseFrNumber(p.dureeRestante, 240)),
          differe,
          idTypePret: nature?.idTypePret ?? 51,
          idPeriodiciteEcheancePret: periodicite?.id ?? 3,
          idTypeAmortissement,
          typeTaux: p.typeTaux,
          mensualite: p.mensualite.trim() ? parseFrNumber(p.mensualite, 0) : undefined,
          datePremiereEcheance: p.datePremiereEcheance || undefined,
        };
        if (differe > 0 && idTypeAmortissement !== 4) {
          out.idNatureDiffere = natureDiffere?.id ?? 2;
        }
        if (p.fraisBancaires.trim()) out.fraisBancaires = parseFrNumber(p.fraisBancaires, 0);
        if (p.dureePrefinancement.trim()) {
          out.dureePrefinancement = Math.round(parseFrNumber(p.dureePrefinancement, 0));
        }
        if (p.typeEcheances === "paliers") {
          out.paliers = p.paliers
            .filter((pal) => pal.duree.trim() && pal.montantEcheance.trim())
            .map((pal) => ({
              duree: Math.round(parseFrNumber(pal.duree, 0)),
              montantEcheance: parseFrNumber(pal.montantEcheance, 0),
            }));
        }
        if (p.typeEcheances === "credit_bail") {
          out.loyer = parseFrNumber(p.loyer, 0);
          out.valeurResiduelle = parseFrNumber(p.valeurResiduelle, 0);
        }
        return out;
      }),
  };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function draftField(fields: KereisField[] | undefined, ...labels: string[]): string {
  if (!fields?.length) return "";
  for (const want of labels) {
    const w = norm(want);
    const exact = fields.find((f) => norm(String(f.label || "")) === w);
    if (exact?.value != null && exact.value !== "") return String(exact.value).trim();
  }
  for (const want of labels) {
    const w = norm(want);
    if (w.length < 8) continue;
    const soft = fields.find((f) => norm(String(f.label || "")).startsWith(w));
    if (soft?.value != null && soft.value !== "") return String(soft.value).trim();
  }
  return "";
}

function toIsoDate(raw: string): string {
  const s = String(raw || "").replace(/\s/g, "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return "";
}

function looksLikeMoney(raw: string): boolean {
  return looksLikeLoanCapital(raw);
}

function looksLikeRate(raw: string): boolean {
  return looksLikeLoanRate(raw);
}

function mapStatutToValue(raw: string): string {
  const n = norm(raw);
  if (!n) return "employe_bureau";
  const byLabel = STATUT_PRO_OPTIONS.find((o) => norm(o.label) === n || norm(o.value) === n);
  if (byLabel) return byLabel.value;
  if (/paysag|btp|transport|ouvrier|manutention|chef d.?equipe/.test(n)) return "artisan_btp";
  if (/artisan/.test(n)) return "artisan_nonbtp";
  if (/commercant/.test(n)) return "commercant";
  if (/cadre/.test(n) && !/non/.test(n)) return "salarie_cadre";
  if (/bureau/.test(n)) return "employe_bureau";
  if (/non.?cadre|employe/.test(n)) return "salarie_noncadre";
  if (/dirigeant|gerant/.test(n)) return "dirigeant";
  if (/agricole/.test(n)) return "profession_agricole";
  return "autre";
}

function mapProfessionRisque(raw: string): string {
  const n = norm(raw);
  if (!n || /aucune|aucun|n.exerce/.test(n)) return "aucun";
  const hit = PROFESSION_RISQUE_OPTIONS.find(
    (o) => norm(o.label) === n || norm(o.value) === n || norm(o.label).includes(n),
  );
  return hit?.value || "aucun";
}

function mapDeplacements(raw: string): string {
  const n = norm(raw);
  if (/50000|>\s*50/.test(n)) return "> 50000 Km";
  if (/20000|20\s*000/.test(n) && /50/.test(n)) return "20000-50000 Km";
  const hit = DEPLACEMENTS_PRO_OPTIONS.find((o) => norm(o.value) === n || norm(o.label) === n);
  return hit?.value || "< 20000 Km";
}

function ouiNon(raw: string): boolean {
  return /^oui|^true|^1/i.test(String(raw || "").trim());
}

/**
 * Initialise le formulaire Lab depuis dossier CRM + fiche Kereis (seed uniquement).
 * Les champs numériques invalides (date, nom…) sont ignorés au profit de formData.
 */
export function seedLabFormFromDossier(dossier: any): {
  form: LabForm;
  assures: AssureForm[];
  prets: PretForm[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const draft = dossier?.kereisDraft as KereisDraft | undefined;
  const fd = dossier?.formData || {};
  const assuresFd = Array.isArray(fd.assures) ? fd.assures : [];
  const pretsFd = Array.isArray(fd.prets) ? fd.prets : [];

  const coords = draft?.steps?.coordonnees || [];
  const infos = draft?.steps?.infosPerso || [];
  const loan0 = draft?.steps?.prets?.[0]?.fields || [];
  const sim = draft?.steps?.simulations || [];
  const preteur = draft?.steps?.preteur || [];

  const form: LabForm = { ...EMPTY_LAB_FORM };
  if (draft?.effectDateIso && /^\d{4}-\d{2}-\d{2}$/.test(draft.effectDateIso)) {
    form.dateEffetGaranties = draft.effectDateIso;
  } else {
    const d = toIsoDate(draftField(loan0, "date d'effet"));
    if (d) form.dateEffetGaranties = d;
  }
  form.banquePreteuse = draftField(preteur, "banque") || String(pretsFd[0]?.banquePreteuse || "");

  const franchiseRaw = draftField(sim, "franchise itt", "franchise");
  const frN = parseFrNumber(franchiseRaw.replace(/jours?/i, ""), NaN);
  if ([30, 60, 90, 180].includes(frN)) form.franchise = String(frN);

  const quotiteDraft = draftField(sim, "quotite");

  if (fd.autresCreditsImmobiliers === "oui") {
    form.autresCreditsOui = true;
    form.encoursImmobilierAssure = String(fd.autresCreditsMontant || "0");
  }

  const listAssures = (assuresFd.length ? assuresFd : [{}]).map((a: any, i: number) => {
    const base = EMPTY_ASSURE();
    const civRaw = String(a?.civilite || (i === 0 ? draftField(coords, "civilite") : "") || "Monsieur");
    base.civilite = /^mme|^madame/i.test(civRaw) ? "Madame" : "Monsieur";
    base.prenom = String(a?.prenom || (i === 0 ? draftField(coords, "prenom") : "") || "").trim();
    base.nom = String(a?.nom || (i === 0 ? draftField(coords, "nom") : "") || "").trim();
    base.dateNaissance =
      toIsoDate(String(a?.dateNaissance || "")) ||
      (i === 0 ? toIsoDate(draftField(coords, "date de naissance")) : "") ||
      "";
    base.email = String(a?.email || (i === 0 ? draftField(coords, "email") : "") || "").trim();
    base.telephone = String(a?.telephone || (i === 0 ? draftField(coords, "telephone") : "") || "").trim();
    const q = String(a?.qualite || "EMPRUNTEUR").toUpperCase();
    base.qualite = QUALITE_OPTIONS.some((o) => o.value === q) ? q : "EMPRUNTEUR";
    base.codePostal = String(
      a?.cpResidence || a?.codePostal || (i === 0 ? draftField(coords, "code postal") : "") || "",
    )
      .replace(/\D/g, "")
      .slice(0, 5);
    const statutRaw =
      String(a?.statutPro || "") ||
      (i === 0 ? draftField(infos, "statut professionnel (kereis)", "statut professionnel") : "");
    base.statutPro = mapStatutToValue(statutRaw);
    // Profession libre ≠ statut : éviter de coller le statut dans profession
    const profRaw = String(a?.profession || "").trim();
    base.profession = STATUT_PRO_OPTIONS.some((o) => norm(o.label) === norm(profRaw))
      ? ""
      : profRaw;
    base.professionRisque = mapProfessionRisque(
      String(a?.professionRisque || (i === 0 ? draftField(infos, "profession a risque") : "") || "aucun"),
    );
    base.professionManuelle =
      a?.professionManuelle === true ||
      (i === 0 && ouiNon(draftField(infos, "profession manuelle")));
    base.travauxHauteur =
      a?.travauxHauteur === true || (i === 0 && ouiNon(draftField(infos, "travaux en hauteur")));
    base.deplacementsPro = mapDeplacements(
      String(a?.deplacementsPro || (i === 0 ? draftField(infos, "deplacements pro") : "") || "< 20000 Km"),
    );
    base.fumeur = a?.fumeur === true || (i === 0 && ouiNon(draftField(infos, "fumeur")));
    base.quotite = String(a?.quotite || parseFrNumber(quotiteDraft, 100) || 100);
    if (base.statutPro === "artisan_btp" || base.statutPro === "artisan_nonbtp") {
      base.professionManuelle = true;
    }
    return base;
  });

  const capitalDraft = draftField(loan0, "capital restant du", "capital restant");
  const capitalForm = String(
    pretsFd[0]?.capitalRestantDu || pretsFd[0]?.capitalRestant || pretsFd[0]?.montant || "",
  );
  let capital = "";
  if (looksLikeMoney(capitalForm)) capital = String(Math.round(parseFrNumber(capitalForm, 0)));
  else if (looksLikeMoney(capitalDraft)) capital = String(Math.round(parseFrNumber(capitalDraft, 0)));
  else if (capitalDraft) warnings.push(`CRD fiche ignoré (« ${capitalDraft} ») — saisissez le capital manuellement.`);

  const tauxDraft = draftField(loan0, "taux nominal");
  const tauxForm = String(pretsFd[0]?.taux ?? pretsFd[0]?.tauxNominal ?? "");
  let taux = "";
  // Préférer formData valide (souvent syncée après extraction) au brouillon corrompu.
  if (looksLikeRate(tauxForm)) taux = formatTauxForForm(parseFrNumber(tauxForm, 0));
  else if (looksLikeRate(tauxDraft)) taux = formatTauxForForm(parseFrNumber(tauxDraft, 0));
  else {
    const fromCopy = extractTauxNominalFromText(String(draft?.copyText || ""));
    if (fromCopy != null) {
      taux = formatTauxForForm(fromCopy);
      warnings.push(`Taux repris du texte fiche : ${taux} %.`);
    } else if (tauxDraft) {
      warnings.push(`Taux fiche ignoré (« ${tauxDraft} ») — saisissez le taux manuellement.`);
    } else {
      warnings.push("Taux nominal manquant — lancez « Régénérer extraction » ou saisissez-le.");
    }
  }

  const dureeDraft = draftField(loan0, "duree restante");
  const dureeForm = String(
    pretsFd[0]?.dureeRestante || pretsFd[0]?.dureeMois || pretsFd[0]?.duree || "",
  );
  let duree = "";
  if (looksLikeLoanDurationMonths(dureeForm)) duree = String(Math.round(parseFrNumber(dureeForm, 0)));
  else if (looksLikeLoanDurationMonths(dureeDraft)) duree = String(Math.round(parseFrNumber(dureeDraft, 0)));

  const pret: PretForm = {
    ...EMPTY_PRET(),
    capitalRestant: capital && Number(capital) > 0 ? capital : "",
    taux,
    dureeRestante: duree && Number(duree) > 0 ? duree : "",
    typeTaux: /var/i.test(draftField(loan0, "type de taux") || String(pretsFd[0]?.typeTaux || ""))
      ? "variable"
      : "fixe",
    dureeDiffere: String(
      parseFrNumber(draftField(loan0, "duree differe"), parseFrNumber(pretsFd[0]?.differeAmortissement, 0)),
    ),
  };

  return { form, assures: listAssures, prets: [pret], warnings };
}

/** Valide le minimum pour appeler Sésame. */
export function validateLabFormForTarif(
  form: LabForm,
  assures: AssureForm[],
  prets: PretForm[],
): string | null {
  if (!form.dateEffetGaranties) return "Date d'effet manquante.";
  const pret = prets[0];
  if (!pret) return "Aucun prêt.";
  const crd = parseFrNumber(pret.capitalRestant, 0);
  const taux = parseFrNumber(pret.taux, 0);
  const duree = parseFrNumber(pret.dureeRestante, 0);
  if (crd < 1000) return `Capital restant dû invalide (${crd || 0} €) — saisissez le CRD (≥ 1 000 €).`;
  if (taux <= 0 || taux > 25) return `Taux nominal invalide (${taux || 0} %) — ex. 3,45.`;
  if (duree < 1 || duree > 600) return `Durée restante invalide (${duree || 0} mois).`;
  const a0 = assures[0];
  if (!a0?.dateNaissance) return "Date de naissance de l'assuré manquante.";
  if (!a0?.statutPro) return "Statut professionnel manquant.";
  return null;
}
