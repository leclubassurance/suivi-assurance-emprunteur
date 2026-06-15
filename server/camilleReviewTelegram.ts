import type { Dossier } from "./dossierModel";
import { getPendingReview, type CamillePendingReview } from "./camilleReviewQueue";

/** Détecte une demande d'envoi du brouillon en validation. */
export function looksLikeReviewSendConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 2) return false;
  if (/^(non|annule|stop|pas envoyer|ne pas envoyer)\b/.test(t)) return false;
  if (
    /^(oui|ok|valide|envoie|envoyer|go|c'est bon|c est bon|parfait|d'accord|d accord)\b/.test(t)
  ) {
    return true;
  }
  if (/^(je valide|j'valide|je confirme|j'confirme|je suis d'accord|je suis d accord)\b/.test(t)) {
    return true;
  }
  if (/\b(peux-tu|tu peux|pourrais-tu)\b.*\b(envoyer|lui envoyer|mail)\b/.test(t)) return true;
  if (/\b(envoie(-| )?lui|envoie le mail|envoie ce mail|envoie le brouillon)\b/.test(t)) return true;
  if (/\b(ok|oui|valide)\b.{0,12}\b(envoie|envoyer|envoyez)\b/.test(t)) return true;
  if (/\b(envoie|envoyer|envoyez)\b/.test(t) && t.length < 48) return true;
  return false;
}

export function looksLikeReviewCancel(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(non|annule|annuler|stop|pas envoyer|ne pas envoyer|cancel)\b/.test(t);
}

/** Modification du brouillon — pas une consigne mail libre. */
export function looksLikeReviewRedraft(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/\b(modifie|modifier|revois|revoir|change|changer|corrige|corriger|réécris|reecris|ajuste|ajuster)\b/.test(t)) {
    if (/\b(brouillon|texte|mail|message|réponse|reponse|dernier)\b/.test(t)) return true;
  }
  if (/\b(plutôt|plutot|au lieu de|ne dis pas|ne pas dire|précise|precise|explique|insiste)\b/.test(t) && t.length > 15) {
    return true;
  }
  return false;
}

export function looksLikeMailSentQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(as[- ]tu|tu as|avez[- ]vous|est-ce que tu as)\b.*\b(envoy|expédi|parti)\b/.test(t)
    || /\b(mail|email)\b.*\b(envoy|parti)\b/.test(t);
}

export function findDossierWithReviewReply(
  dossiers: Dossier[],
  chatId: string,
  replyToMessageId?: number,
): Dossier | null {
  if (!replyToMessageId) return null;
  for (const d of dossiers) {
    const r = getPendingReview(d);
    if (!r) continue;
    const sameChat = String(r.telegramChatId) === String(chatId);
    const onQuestion = Number(r.telegramQuestionMessageId) === Number(replyToMessageId);
    const onConfirm = Number(r.telegramConfirmMessageId) === Number(replyToMessageId);
    if (!sameChat) continue;
    if (r.status === "awaiting_staff" && onQuestion) return d;
    if (r.status === "awaiting_confirm" && (onConfirm || onQuestion)) return d;
  }
  return null;
}

export function findDossierWithAwaitingConfirmReview(
  dossiers: Dossier[],
  chatId: string,
): Dossier | null {
  const matches: Dossier[] = [];
  for (const d of dossiers) {
    const r = getPendingReview(d);
    if (!r || r.status !== "awaiting_confirm") continue;
    if (r.telegramChatId && String(r.telegramChatId) !== String(chatId)) continue;
    matches.push(d);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return matches.sort(
      (a, b) =>
        new Date(getPendingReview(b)?.updatedAt || 0).getTime() -
        new Date(getPendingReview(a)?.updatedAt || 0).getTime(),
    )[0];
  }
  return null;
}

export function findDossierWithAwaitingStaffReview(
  dossiers: Dossier[],
  chatId: string,
): Dossier | null {
  const matches: Dossier[] = [];
  for (const d of dossiers) {
    const r = getPendingReview(d);
    if (!r || r.status !== "awaiting_staff") continue;
    if (r.telegramChatId && String(r.telegramChatId) !== String(chatId)) continue;
    matches.push(d);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return matches.sort(
      (a, b) =>
        new Date(getPendingReview(b)?.updatedAt || 0).getTime() -
        new Date(getPendingReview(a)?.updatedAt || 0).getTime(),
    )[0];
  }
  return null;
}

function looksLikeNewClientStaffDirective(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (/^(envoie|écris|ecris|relance|demande|préviens|previens|peux-tu|tu peux|pourrais-tu)\b/i.test(text)) {
    return true;
  }
  if (
    /\b(relancer|relance|signature|signer|signe|espace d.adh[eé]sion|espace adherent|contrat|kereis|docaposte)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\b(monsieur|madame|mme|mr|mle)\b/i.test(lower) &&
    /\b(relancer|signer|signe|mail|écrire|ecrire|relance)\b/i.test(lower)
  ) {
    return true;
  }
  return false;
}

/** Texte libre = consigne de rédaction pour une relecture en cours — pas une nouvelle consigne client. */
export function looksLikeReviewStaffGuidance(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 8) return false;
  if (looksLikeReviewSendConfirmation(t) || looksLikeReviewCancel(t) || looksLikeReviewRedraft(t)) {
    return false;
  }
  if (looksLikeNewClientStaffDirective(text)) return false;
  return true;
}

export function buildFactualMailStatusBlock(dossier: Dossier): string {
  const review = dossier.camillePendingReview as CamillePendingReview | undefined;
  const lines: string[] = [];

  if (review?.status === "awaiting_staff") {
    lines.push("REVIEW en cours : aucun mail client envoyé — en attente de votre consigne.");
  } else if (review?.status === "awaiting_confirm") {
    lines.push(
      "REVIEW : brouillon proposé, PAS ENCORE ENVOYÉ au client — validez ou demandez une modification.",
    );
    if (review.proposedClientPlain) {
      lines.push(`Brouillon en attente (extrait) : « ${review.proposedClientPlain.slice(0, 200)}… »`);
    }
  } else if (review?.status === "sent") {
    lines.push("REVIEW : le mail validé a été envoyé au client.");
  }

  const outbound = (dossier.communications || [])
    .filter((c: any) => c?.direction === "outbound")
    .slice(-5)
    .map((c: any) => {
      const from = c.from || "?";
      const date = c.date?.slice(0, 16) || "?";
      const subj = String(c.subject || "").slice(0, 60);
      const preview = String(c.text || "").replace(/\s+/g, " ").slice(0, 100);
      return `- ${date} | ${from} | ${subj} | « ${preview}… »`;
    });

  lines.push(outbound.length ? `Derniers mails sortants :\n${outbound.join("\n")}` : "Aucun mail sortant enregistré.");

  const kpi = dossier.studyKpi as any;
  if (kpi) {
    lines.push(
      `KPI étude : économie ~${kpi.grossSavingsEur ?? "?"} €, frais courtage LCIF ~${kpi.feesCourtageEur ?? 0} €, frais assureur ~${kpi.feesAssureurEur ?? "?"} €`,
    );
  }

  return lines.join("\n");
}
