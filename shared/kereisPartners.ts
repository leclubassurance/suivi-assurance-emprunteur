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
- Par défaut : mentionner Kereis Prévoyance comme partenaire courtier ; éventuellement 2 à 4 exemples (${DEFAULT_EXAMPLE_NAMES.join(", ")}…) — PAS la liste complète sauf demande explicite.
- Si le client demande la liste complète des compagnies : énumérer les noms uniquement (${KEREIS_PARTNER_INSURER_NAMES.join(", ")}), sans les codes produits internes.
- Si le client cite une compagnie de la liste : confirmer que Charles peut étudier une solution via Kereis incluant cette compagnie si le profil le permet — sans promettre le contrat ni garantir le choix final.
- Ne jamais communiquer les codes / références produits (5369, CLE, Premium 2795, etc.) au client, sauf s'il les cite lui-même.
- Le choix définitif de la compagnie et du contrat figure uniquement dans l'étude personnalisée de Charles.
`.trim();
}

/** Paragraphe client pour questions assureurs / partenaires (templates prospect). */
export function buildProspectInsurerPartnerReplyParagraph(clientMessage?: string): string {
  const specific = detectMentionedKereisPartner(clientMessage);
  if (specific) {
    return `Oui : via notre partenaire Kereis Prévoyance, Charles peut étudier des solutions incluant ${specific.name} selon votre profil et les garanties équivalentes exigées par votre banque. Le choix définitif vous est présenté dans l'étude gratuite — sans engagement.`;
  }
  if (clientWantsFullInsurerList(clientMessage)) {
    return `Via notre partenaire Kereis Prévoyance, nous pouvons accéder à des contrats parmi les compagnies suivantes selon votre dossier : ${KEREIS_PARTNER_INSURER_NAMES.join(", ")}. Charles sélectionne celle la plus adaptée à votre profil dans l'étude gratuite.`;
  }
  return `Nous passons par notre partenaire Kereis Prévoyance, qui nous donne accès notamment à des solutions ${DEFAULT_EXAMPLE_NAMES.join(", ")} et d'autres grands assureurs partenaires selon votre profil. Charles compare les garanties équivalentes à votre contrat actuel dans l'étude gratuite — sans engagement de votre part.`;
}
