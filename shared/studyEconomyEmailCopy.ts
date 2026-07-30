/**
 * Accroches mail client selon le palier d'économie brute.
 * Ton : subtil, engageant, sans pression commerciale.
 */

export type StudyEconomyTier = "under_2k" | "from_2k" | "from_10k" | "from_20k";

export function resolveStudyEconomyTier(grossSavingsEur: number | null | undefined): StudyEconomyTier | null {
  if (grossSavingsEur == null || !Number.isFinite(grossSavingsEur)) return null;
  const g = Math.round(Number(grossSavingsEur));
  if (g < 2000) return "under_2k";
  if (g < 10000) return "from_2k";
  if (g < 20000) return "from_10k";
  return "from_20k";
}

function eurInt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function buildStudyClientIntroByTier(params: {
  grossSavingsEur: number | null | undefined;
}): { tier: StudyEconomyTier | null; introHtml: string } {
  const tier = resolveStudyEconomyTier(params.grossSavingsEur);
  const x =
    params.grossSavingsEur != null && Number.isFinite(params.grossSavingsEur)
      ? eurInt(Number(params.grossSavingsEur))
      : null;

  if (!tier || !x) {
    return {
      tier: null,
      introHtml:
        "Nous avons finalisé votre <strong>étude d'économies</strong> sur l'assurance emprunteur. Les garanties de la solution proposée sont <strong>équivalentes</strong> à votre contrat actuel.",
    };
  }

  switch (tier) {
    case "under_2k":
      return {
        tier,
        introHtml: `Nous avons finalisé votre étude. Sur votre crédit, l'économie estimée reste <strong>mesurée</strong> (environ <strong>${x}&nbsp;€</strong>), avec des garanties <strong>équivalentes</strong> à votre contrat actuel. Le détail complet est en pièce jointe.`,
      };
    case "from_2k":
      return {
        tier,
        introHtml: `Nous avons finalisé votre étude d'économies. Sur votre crédit, nous estimons une économie d'environ <strong>${x}&nbsp;€</strong> sur la durée restante, à garanties <strong>équivalentes</strong>.`,
      };
    case "from_10k":
      return {
        tier,
        introHtml: `Nous sommes heureux de vous transmettre votre étude. Sur votre crédit, l'analyse fait apparaître une économie <strong>notable</strong>, d'environ <strong>${x}&nbsp;€</strong>, à garanties <strong>équivalentes</strong>.`,
      };
    case "from_20k":
      return {
        tier,
        introHtml: `Nous sommes ravis de vous indiquer que, sur votre crédit, vous pouvez réaliser des <strong>économies importantes</strong> — environ <strong>${x}&nbsp;€</strong> estimés sur la durée restante, à garanties <strong>équivalentes</strong>.`,
      };
  }
}

export function buildStudyClientSubjectByTier(params: {
  clientPrenom?: string;
  grossSavingsEur?: number | null;
}): string {
  const prenom = String(params.clientPrenom || "").trim();
  const hasPrenom = Boolean(prenom) && prenom.toLowerCase() !== "bonjour";
  const tier = resolveStudyEconomyTier(params.grossSavingsEur);

  if (tier === "from_20k") {
    return hasPrenom
      ? `${prenom}, de bonnes nouvelles sur votre assurance emprunteur`
      : "De bonnes nouvelles sur votre assurance emprunteur";
  }
  if (tier === "from_10k") {
    return hasPrenom ? `${prenom}, votre étude d'économies` : "Votre étude d'économies";
  }
  return hasPrenom
    ? `${prenom}, votre étude personnalisée - Assurance Emprunteur`
    : "Votre étude personnalisée - Assurance Emprunteur";
}
