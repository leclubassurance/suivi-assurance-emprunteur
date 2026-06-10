/** Filtrage central des mails entrants — prospects, clients, et ignorés (facturation, auto). */

export function extractEmailAddress(fromRaw: string): string {
  const m = String(fromRaw || "").match(/<([^>]+)>/);
  if (m?.[1]) return m[1].trim().toLowerCase();
  return String(fromRaw || "").trim().toLowerCase();
}

const IGNORE_LOCAL_RE =
  /^(noreply|no-?reply|mailer-daemon|postmaster|bounce|notifications?|newsletter|hello|notify|invoice|invoices|receipt|receipts|billing|billings|statements?|payments?|facturation|facture|donotreply|do-not-reply|automated|unsubscribe|support\+)/i;

const IGNORE_LOCAL_CONTAINS_RE =
  /(^|[.+])(invoice|invoices|receipt|receipts|statements?|billing|payments?|facturation)([+._-]|$)/i;

const IGNORE_DOMAINS = [
  "@stripe.com",
  "@paypal.com",
  "@railway.app",
  "@notify.railway.app",
  "@leclubimmobilier.fr",
  "@google.com",
  "@accounts.google.com",
  "@mail.cursor.com",
  "@cursor.com",
  "@github.com",
  "@linkedin.com",
  "@facebookmail.com",
  "@amazon.com",
  "@apple.com",
  "@microsoft.com",
  "@office365.com",
  "@intercom.io",
  "@sendgrid.net",
  "@mailgun.org",
  "@postmarkapp.com",
  "@sparkpostmail.com",
  "@vercel.com",
  "@slack.com",
  "@notion.so",
  "@firebase.google.com",
];

const IGNORE_SUBJECT_RE =
  /\b(receipt from|your receipt|receipt\s*#|invoice\s*#|payment (received|confirmed|successful)|paid \$|facture|reçu de paiement|facturation|billing statement|order confirmation)\b/i;

export type InboundEmailClassification = {
  ignore: boolean;
  reason: string;
  category: "human" | "automated" | "internal";
};

export type InboundEmailHeaders = {
  fromRaw?: string;
  toRaw?: string;
  deliveredToRaw?: string;
  subject?: string;
  autoSubmitted?: string;
  precedence?: string;
  listUnsubscribe?: string;
};

function getAssuranceMailbox(): string {
  return String(process.env.GMAIL_USER || "assurance@leclubimmobilier.fr").toLowerCase();
}

export function isAddressedToAssuranceMailbox(headers: InboundEmailHeaders): boolean {
  const target = getAssuranceMailbox();
  const blob = `${headers.toRaw || ""} ${headers.deliveredToRaw || ""}`.toLowerCase();
  if (!blob.trim()) return true;
  return blob.includes(target) || blob.includes("assurance@leclubimmobilier.fr");
}

export function shouldIgnoreAutomatedSender(email: string): boolean {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return true;
  const [local, domain] = e.split("@");
  if (!domain) return true;
  if (IGNORE_LOCAL_RE.test(local || "")) return true;
  if (IGNORE_LOCAL_CONTAINS_RE.test(local || "")) return true;
  if (IGNORE_DOMAINS.some((d) => e.endsWith(d) || `@${domain}`.endsWith(d))) return true;
  return false;
}

function hasAutomatedHeaders(headers: InboundEmailHeaders): string | null {
  const auto = String(headers.autoSubmitted || "").toLowerCase();
  if (auto.includes("auto-generated") || auto.includes("auto-replied")) {
    return "auto-submitted";
  }
  const prec = String(headers.precedence || "").toLowerCase();
  if (prec === "bulk" || prec === "list" || prec === "junk") return `precedence:${prec}`;
  if (headers.listUnsubscribe) return "list-unsubscribe";
  return null;
}

export function classifyInboundEmail(
  headers: InboundEmailHeaders,
  options?: { requireAssuranceMailbox?: boolean },
): InboundEmailClassification {
  const from = extractEmailAddress(headers.fromRaw || "");
  const subject = String(headers.subject || "");

  if (!from || !from.includes("@")) {
    return { ignore: true, reason: "expéditeur invalide", category: "automated" };
  }

  if (shouldIgnoreAutomatedSender(from)) {
    return { ignore: true, reason: `expéditeur automatisé (${from})`, category: "automated" };
  }

  if (IGNORE_SUBJECT_RE.test(subject)) {
    return { ignore: true, reason: `sujet facturation (${subject.slice(0, 60)})`, category: "automated" };
  }

  const autoHdr = hasAutomatedHeaders(headers);
  if (autoHdr) {
    return { ignore: true, reason: `en-tête ${autoHdr}`, category: "automated" };
  }

  if (options?.requireAssuranceMailbox && !isAddressedToAssuranceMailbox(headers)) {
    return { ignore: true, reason: "pas adressé à assurance@", category: "internal" };
  }

  return { ignore: false, reason: "humain", category: "human" };
}

/** @deprecated Utiliser classifyInboundEmail — conservé pour compat. */
export function shouldIgnoreProspectSender(email: string): boolean {
  return shouldIgnoreAutomatedSender(email);
}

export function buildProspectGmailQueryExtras(): string {
  return [
    "-from:stripe.com",
    "-from:notify.railway.app",
    "-from:paypal.com",
    "-subject:receipt",
    "-subject:invoice",
    "-subject:facture",
  ].join(" ");
}
