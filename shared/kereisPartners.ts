/**
 * Compagnies accessibles via le partenaire Kereis Prévoyance (référence interne LCIF).
 * Les codes produits sont pour Camille — ne pas les communiquer au client sauf citation explicite.
 */

export type KereisPartnerInsurer = {
  name: string;
  /** Référence produit interne Kereis */
  productRefs: string;
  /** Alias pour détection dans les mails clients */
  aliases: string[];
};

export const KEREIS_PARTNER_INSURERS: KereisPartnerInsurer[] = [
  { name: "Allianz", productRefs: "5369", aliases: ["allianz"] },
  { name: "Axa", productRefs: "4097", aliases: ["axa"] },
  {
    name: "Cardif",
    productRefs: "CLE 2827/736 et 2828/737",
    aliases: ["cardif", "bnp cardif"],
  },
  { name: "CNP", productRefs: "Premium 2795", aliases: ["cnp", "cnp assurances"] },
  { name: "Generali", productRefs: "7357 et 7358", aliases: ["generali"] },
  {
    name: "Harmonie Mutuelle",
    productRefs: "KREDIT'ASSUR",
    aliases: ["harmonie mutuelle", "harmonie", "kreditassur", "kredit'assur"],
  },
  {
    name: "Malakoff Humanis",
    productRefs: "iNéo Emprunteur QUA25G01602E et QUA2…",
    aliases: ["malakoff humanis", "malakoff", "humanis", "inéo", "ineo"],
  },
  { name: "MNCAP", productRefs: "441066CRD et 441067CI", aliases: ["mncap"] },
  { name: "Mutlog", productRefs: "20259 CI", aliases: ["mutlog"] },
];

export const KEREIS_PARTNER_INSURER_NAMES = KEREIS_PARTNER_INSURERS.map((p) => p.name);

const DEFAULT_EXAMPLE_NAMES = ["Allianz", "Axa", "Cardif", "Generali"];

const PRIVILEGED_TARIFF_LINE =
  `Nous avons des contrats particuliers avec ces compagnies, ce qui nous permet de vous proposer des tarifs privilégiés sur ces assurances emprunteur.`;

const CHARLES_FULL_LIST_LINE =
  `Pour la liste complète de nos assureurs partenaires, Charles reviendra vers vous par la suite pour vous la communiquer.`;

/** Détecte si le client cite une compagnie de la liste Kereis. */
export function detectMentionedKereisPartner(clientMessage?: string): KereisPartnerInsurer | null {
  const msg = String(clientMessage || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!msg.trim()) return null;
  for (const partner of KEREIS_PARTNER_INSURERS) {
    for (const alias of partner.aliases) {
      const a = alias
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      if (a.length >= 3 && msg.includes(a)) return partner;
    }
  }
  return null;
}

export function clientWantsFullInsurerList(clientMessage?: string): boolean {
  const msg = String(clientMessage || "").toLowerCase();
  return /liste\s+(complète|complete|entière|entiere)|toutes?\s+les\s+(compagnies|assureurs)|énumér|enumerer|donnez.moi\s+la\s+liste|quels?\s+sont\s+(tous|toutes)/i.test(
    msg,
  );
}

/** Bloc injecté dans le prompt Camille (prospects). */
export function buildKereisPartnersKnowledgeBlock(): string {
  const internalLines = KEREIS_PARTNER_INSURERS.map(
    (p) => `- ${p.name} (${p.productRefs})`,
  ).join("\n");

  return `
PARTENAIRES ASSUREURS VIA KEREIS PRÉVOYANCE (référence interne — ne pas tout réciter au client) :
${internalLines}

RÈGLES RÉDACTION CLIENT :
- Par défaut : Kereis Prévoyance + 2 à 4 exemples maximum (${DEFAULT_EXAMPLE_NAMES.join(", ")}…) — JAMAIS énumérer l'ensemble des ${KEREIS_PARTNER_INSURER_NAMES.length} compagnies partenaires.
- Toujours rappeler que nous avons des contrats particuliers avec ces assureurs pour proposer des tarifs privilégiés.
- Si le client demande la liste complète : ${CHARLES_FULL_LIST_LINE} — ne jamais donner tous les noms par email automatique.
- Si le client cite une compagnie de la liste : confirmer que Charles peut étudier une solution via Kereis incluant cette compagnie si le profil le permet — sans promettre le contrat.
- Ne jamais communiquer les codes / références produits (5369, CLE, Premium 2795, etc.) au client, sauf s'il les cite lui-même.
- Le choix définitif de la compagnie et du contrat figure uniquement dans l'étude personnalisée de Charles.
`.trim();
}

/** Paragraphe client pour questions assureurs / partenaires (templates prospect). */
export function buildProspectInsurerPartnerReplyParagraph(clientMessage?: string): string {
  const specific = detectMentionedKereisPartner(clientMessage);
  if (specific) {
    return [
      `Oui : via notre partenaire Kereis Prévoyance, Charles peut étudier des solutions incluant ${specific.name} selon votre profil et les garanties équivalentes exigées par votre banque.`,
      PRIVILEGED_TARIFF_LINE,
      `Le choix définitif vous est présenté dans l'étude gratuite — sans engagement.`,
    ].join(" ");
  }
  if (clientWantsFullInsurerList(clientMessage)) {
    return [
      CHARLES_FULL_LIST_LINE,
      `Nous collaborons avec plusieurs grands assureurs partenaires via Kereis Prévoyance.`,
      PRIVILEGED_TARIFF_LINE,
    ].join(" ");
  }
  return [
    `Nous passons par notre partenaire Kereis Prévoyance, avec accès notamment à des solutions ${DEFAULT_EXAMPLE_NAMES.join(", ")} et d'autres assureurs partenaires selon votre profil.`,
    PRIVILEGED_TARIFF_LINE,
    `Charles compare les garanties équivalentes à votre contrat actuel dans l'étude gratuite — sans engagement de votre part.`,
  ].join(" ");
}
