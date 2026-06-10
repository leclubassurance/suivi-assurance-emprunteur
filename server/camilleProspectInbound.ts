import { addEvent } from "./dossierModel";
import {
  collectKnownCorrespondenceEmails,
  findNonLeadDossierByCorrespondenceEmail,
  getDossierClientEmails,
} from "./gmailAttachments";
import { isCamilleTestMode } from "./businessHours";
import { getAssurancePlatformUrl } from "../shared/lcifLegalIdentity";
import {
  buildProspectGmailQueryExtras,
  classifyInboundEmail,
  extractEmailAddress,
} from "./inboundEmailClassifier";

function extractSenderEmail(fromRaw: string): string {
  return extractEmailAddress(fromRaw);
}

export { shouldIgnoreProspectSender } from "./inboundEmailClassifier";
import { isLeadDossier } from "./leadDossierMerge";

export function isProspectInboundEnabled(): boolean {
  const raw = String(process.env.CAMILLE_PROSPECT_INBOUND_ENABLED ?? "").toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return isCamilleTestMode();
}

export function collectKnownClientEmails(db: { dossiers: any[] }): Set<string> {
  return collectKnownCorrespondenceEmails(db);
}

export function findLeadDossierByEmail(db: { dossiers: any[] }, email: string) {
  const e = email.toLowerCase();
  return (
    db.dossiers.find(
      (d) => isLeadDossier(d) && getDossierClientEmails(d).some((ce) => ce === e),
    ) || null
  );
}

function parseDisplayName(fromRaw: string): { prenom: string; nom: string } {
  const raw = String(fromRaw || "").trim();
  const withoutEmail = raw.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "");
  if (!withoutEmail || withoutEmail.includes("@")) {
    return { prenom: "", nom: "Prospect" };
  }
  const parts = withoutEmail.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { prenom: parts[0], nom: "Prospect" };
  return { prenom: parts[0], nom: parts.slice(1).join(" ") };
}

export function createLeadDossierFromInbound(
  db: { dossiers: any[] },
  senderEmail: string,
  fromRaw?: string,
) {
  const { prenom, nom } = parseDisplayName(fromRaw || "");
  const leadId = `LCIF-${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
  const now = new Date().toISOString();
  const lead = {
    id: leadId,
    status: "PROSPECT",
    createdAt: now,
    updatedAt: now,
    isLead: true,
    leadSource: "gmail_inbound",
    formData: {
      assures: [{ prenom, nom, email: senderEmail.toLowerCase() }],
      documents: [],
      prets: [],
    },
    communications: [],
    tasks: [],
    emails: [],
    notes: [],
    eventLog: [],
    processedGmailIds: [],
  } as any;

  addEvent(lead, {
    type: "DOSSIER_CREATED",
    actor: { kind: "SYSTEM", label: "Camille" },
    message: `Prospect créé automatiquement — premier mail entrant (${senderEmail}).`,
    meta: { leadSource: "gmail_inbound" },
  });

  db.dossiers.push(lead);
  return lead;
}

export function buildProspectLeadPromptBlock(dossier: any): string {
  const formUrl = getAssurancePlatformUrl();
  return `
MODE PROSPECT / PRÉ-ÉTUDE (isLead=true — pas encore de dossier formulaire)
- Ce contact a écrit à assurance@ SANS avoir rempli le formulaire en ligne.
- Répondre aux questions générales (gratuité de l'étude, Loi Lemoine, délais indicatifs, fonctionnement de l'étude d'économie).
- ÉTAPE SUIVANTE OBLIGATOIRE : inviter à démarrer via le formulaire en ligne : ${formUrl}
- Le formulaire recueille les informations du projet ET permet de déposer l'offre de prêt et le tableau d'amortissement (PDF).
- INTERDIT ABSOLU : demander d'envoyer offre de prêt, tableau d'amortissement, CNI ou RIB par réponse email ou pièce jointe mail.
- INTERDIT : promettre une étude chiffrée avant réception du formulaire complété.
- Le lien formulaire (${formUrl}) doit apparaître clairement dans la réponse (URL cliquable).
- NE PAS parler d'étude déjà envoyée, Kereis, espace adhésion.
- Ton accueillant, pédagogique. Référence interne : ${dossier.id}.
`.trim();
}

/** Réponse prospect fiable (sans LLM) — accueil + lien formulaire uniquement. */
export function buildProspectWelcomeReplyPlain(dossier: any, clientMessage?: string): string {
  const formUrl = getAssurancePlatformUrl();
  const msg = String(clientMessage || "").trim().toLowerCase();
  const isOnlyGreeting =
    !msg ||
    /^(bonjour|bonsoir|salut|hello|bonne journ[ée]e|bonne soir[ée]e|info|renseignement|question)[\s!.?]*$/i.test(
      msg,
    );
  const lines = [
    `Merci pour votre message et l'intérêt que vous portez à notre étude d'assurance emprunteur.`,
    `L'étude d'économie est gratuite et sans engagement.`,
  ];
  if (!isOnlyGreeting && msg.length > 3) {
    lines.push(
      `Nous avons bien noté votre demande ; le formulaire en ligne permet de nous transmettre les éléments de votre projet pour que Charles puisse préparer une étude personnalisée.`,
    );
  }
  lines.push(
    `Pour démarrer, complétez le formulaire sécurisé (quelques minutes) :`,
    formUrl,
    `Vous pourrez y déposer l'offre de prêt et le tableau d'amortissement en PDF — pas besoin de les envoyer en pièce jointe par email.`,
    `Référence interne : ${dossier.id}.`,
  );
  return lines.join("\n\n");
}

/** Salutation courte sans question métier → réponse template (pas de LLM). */
export function isSimpleProspectGreeting(clientMessage?: string): boolean {
  const msg = String(clientMessage || "").trim().toLowerCase();
  if (!msg) return true;
  if (msg.length > 120) return false;
  if (/\?/.test(msg) && /(lemoine|économ|econom|gratuit|tarif|délai|delai|comment|pourquoi|assurance|prêt|pret|fonctionne)/i.test(msg)) {
    return false;
  }
  return /^(bonjour|bonsoir|salut|hello|bonne journ[ée]e|bonne soir[ée]e|info|renseignement|question|coucou|bonjour[,!\s].{0,40})[\s!.?]*$/i.test(
    msg,
  );
}

/** Bloque les demandes de documents par mail dans une réponse prospect. */
export function enforceProspectReplyPlain(plain: string, dossier: any): string {
  const formUrl = getAssurancePlatformUrl();
  let text = String(plain || "").trim();
  const asksDocsByEmail =
    /(offre de prêt|tableau d.amortissement|échéancier|echeancier|cni|rib).{0,80}(envoy|joindre|transmettre|pi[eè]ce jointe|par mail|par email)/i.test(
      text,
    ) ||
    /(envoy|joindre|transmettre).{0,80}(offre de prêt|tableau d.amortissement|cni|rib)/i.test(text);
  if (asksDocsByEmail) {
    text = buildProspectWelcomeReplyPlain(dossier, "");
  }
  if (!text.includes(formUrl)) {
    text = `${text}\n\nPour démarrer votre étude, complétez le formulaire en ligne : ${formUrl}`;
  }
  return text;
}

function headerValue(headers: any[] | undefined, name: string): string {
  const h = headers?.find((x: any) => String(x.name || "").toLowerCase() === name.toLowerCase());
  return String(h?.value || "");
}

/** Scan des mails entrants vers assurance@ de personnes inconnues → pré-dossier + réponse Camille. */
export async function syncProspectInboundFromGmail(
  gmail: any,
  db: { dossiers: any[] },
  deps: {
    processedIds: Set<string>;
    accessToken: string | null;
    aiCallback: Function;
    markDossierDirty: (d: any) => void;
    persistLead?: (d: any) => Promise<boolean>;
    upsertCommunication: (d: any, msg: any) => boolean;
    getProcessedIds: (d: any) => Set<string>;
    markProcessed: (d: any, id: string) => boolean;
    decodeEmailBodies: (payload: any) => { text: string; html: string };
    isAiAutoReplyEnabled: () => boolean;
    canCamilleEmailClient: (
      d: any,
      o?: { allowIfUnansweredInbound?: boolean },
    ) => { ok: boolean; reason?: string };
    acquireCamilleClientEmailLock: (id: string) => boolean;
    releaseCamilleClientEmailLock: (id: string) => void;
    sendEmailReplyWithGmailAPI: (
      token: string | null,
      to: string,
      subject: string,
      html: string,
    ) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
    getCamilleReplyDelayMs: () => number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<{ inbound: number; aiReplies: number; leadsCreated: number }> {
  if (!isProspectInboundEnabled()) {
    if (isCamilleTestMode()) {
      console.warn(
        "[Camille prospect] désactivé — CAMILLE_TEST_MODE ou CAMILLE_PROSPECT_INBOUND_ENABLED requis.",
      );
    }
    return { inbound: 0, aiReplies: 0, leadsCreated: 0 };
  }

  const gmailUser = String(process.env.GMAIL_USER || "assurance@leclubimmobilier.fr").toLowerCase();
  const known = collectKnownCorrespondenceEmails(db);
  const scanDays = Number(
    process.env.CAMILLE_PROSPECT_SCAN_DAYS || (isCamilleTestMode() ? "7" : "2"),
  );
  const maxLeadAgeH = Number(
    process.env.CAMILLE_PROSPECT_MAX_LEAD_AGE_H || (isCamilleTestMode() ? "72" : "48"),
  );
  const maxReplyAgeH = Number(process.env.CAMILLE_PROSPECT_MAX_REPLY_AGE_H || "24");
  const q = `(to:${gmailUser} OR deliveredto:${gmailUser}) newer_than:${scanDays}d -in:spam -in:trash ${buildProspectGmailQueryExtras()}`;
  if (isCamilleTestMode()) {
    console.log(`[Camille prospect] scan start mailbox=${gmailUser} q="${q}" knownEmails=${known.size}`);
  }

  const messageIds: string[] = [];
  let pageToken: string | undefined;
  const maxScan = Number(process.env.CAMILLE_PROSPECT_SCAN_MAX || "40");
  while (messageIds.length < maxScan) {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(50, maxScan - messageIds.length),
      pageToken,
    });
    for (const m of listRes.data.messages || []) {
      if (m.id) messageIds.push(m.id);
    }
    pageToken = listRes.data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  const messages = messageIds.map((id) => ({ id }));

  let inbound = 0;
  let aiReplies = 0;
  let leadsCreated = 0;
  const maxProspectsPerCycle = Number(process.env.CAMILLE_PROSPECT_MAX_PER_SYNC || "3");
  let prospectsHandled = 0;
  const skipReasons = {
    alreadySynced: 0,
    sent: 0,
    ignoredSender: 0,
    automated: 0,
    knownClient: 0,
    fullDossier: 0,
    tooOld: 0,
    sendGateBlocked: 0,
    aiDisabled: 0,
    replyTooOld: 0,
  };

  for (const msgMeta of messages) {
    if (!msgMeta.id || deps.processedIds.has(msgMeta.id)) {
      if (msgMeta.id) skipReasons.alreadySynced += 1;
      continue;
    }

    const metaRes = await gmail.users.messages.get({
      userId: "me",
      id: msgMeta.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "To", "Delivered-To", "Auto-Submitted", "Precedence", "List-Unsubscribe"],
    });
    const metaPayload = metaRes.data.payload;
    const metaLabelIds = metaRes.data.labelIds || [];
    if (metaLabelIds.includes("SENT")) {
      skipReasons.sent += 1;
      continue;
    }
    const metaHeaders = metaPayload?.headers || [];
    const fromHeaderMeta = metaHeaders.find((h: any) => h.name?.toLowerCase() === "from");
    const senderEmailMeta = extractSenderEmail(fromHeaderMeta?.value || "");
    const metaClass = classifyInboundEmail(
      {
        fromRaw: fromHeaderMeta?.value,
        toRaw: headerValue(metaHeaders, "To"),
        deliveredToRaw: headerValue(metaHeaders, "Delivered-To"),
        subject: headerValue(metaHeaders, "Subject"),
        autoSubmitted: headerValue(metaHeaders, "Auto-Submitted"),
        precedence: headerValue(metaHeaders, "Precedence"),
        listUnsubscribe: headerValue(metaHeaders, "List-Unsubscribe"),
      },
      { requireAssuranceMailbox: true },
    );
    if (!senderEmailMeta || metaClass.ignore) {
      if (metaClass.category === "automated") skipReasons.automated += 1;
      else skipReasons.ignoredSender += 1;
      if (isCamilleTestMode() && metaClass.ignore) {
        console.log(`[Camille prospect] ignoré (${metaClass.reason})`);
      }
      continue;
    }
    if (known.has(senderEmailMeta)) {
      skipReasons.knownClient += 1;
      continue;
    }

    const msgRes = await gmail.users.messages.get({
      userId: "me",
      id: msgMeta.id,
      format: "full",
    });
    const payload = msgRes.data.payload;
    if (!payload?.headers) continue;

    const labelIds = msgRes.data.labelIds || [];
    if (labelIds.includes("SENT")) {
      skipReasons.sent += 1;
      continue;
    }

    const fromHeader = payload.headers.find((h: any) => h.name?.toLowerCase() === "from");
    const subjectHeader = payload.headers.find((h: any) => h.name?.toLowerCase() === "subject");
    const fromRaw = fromHeader?.value || "";
    const senderEmail = extractSenderEmail(fromRaw);
    const subject = subjectHeader?.value || "";
    const fullClass = classifyInboundEmail(
      {
        fromRaw,
        toRaw: headerValue(payload.headers, "To"),
        deliveredToRaw: headerValue(payload.headers, "Delivered-To"),
        subject,
        autoSubmitted: headerValue(payload.headers, "Auto-Submitted"),
        precedence: headerValue(payload.headers, "Precedence"),
        listUnsubscribe: headerValue(payload.headers, "List-Unsubscribe"),
      },
      { requireAssuranceMailbox: true },
    );

    if (!senderEmail || fullClass.ignore) {
      if (fullClass.category === "automated") skipReasons.automated += 1;
      else skipReasons.ignoredSender += 1;
      continue;
    }
    if (known.has(senderEmail)) {
      skipReasons.knownClient += 1;
      if (isCamilleTestMode()) {
        console.log(`[Camille prospect] ignoré (client connu): ${senderEmail}`);
      }
      continue;
    }

    deps.processedIds.add(msgMeta.id);

    const msgDate = new Date(Number(msgRes.data.internalDate || Date.now())).toISOString();
    const msgAgeH = (Date.now() - new Date(msgDate).getTime()) / (3600 * 1000);

    const linkedFull = findNonLeadDossierByCorrespondenceEmail(db, senderEmail);
    if (linkedFull) {
      skipReasons.fullDossier += 1;
      if (isCamilleTestMode()) {
        console.log(
          `[Camille prospect] ignoré (dossier client ${linkedFull.id}): ${senderEmail}`,
        );
      }
      continue;
    }

    let dossier = findLeadDossierByEmail(db, senderEmail);
    if (!dossier && msgAgeH > maxLeadAgeH) {
      skipReasons.tooOld += 1;
      continue;
    }

    if (!dossier) {
      dossier = createLeadDossierFromInbound(db, senderEmail, fromRaw);
      known.add(senderEmail);
      leadsCreated += 1;
      deps.markDossierDirty(dossier);
      if (deps.persistLead) {
        await deps.persistLead(dossier);
      }
      if (isCamilleTestMode()) {
        console.log(`[Camille prospect] nouveau prospect ${dossier.id} (${senderEmail})`);
      }
    }

    prospectsHandled += 1;

    const { text, html } = deps.decodeEmailBodies(payload);

    let msgChanged = false;
    if (
      deps.upsertCommunication(dossier, {
        id: `msg_${msgMeta.id}`,
        gmailId: msgMeta.id,
        direction: "inbound",
        from: senderEmail,
        subject,
        text,
        html: html || undefined,
        date: msgDate,
      })
    ) {
      msgChanged = true;
    }

    const alreadyHandled = deps.getProcessedIds(dossier).has(msgMeta.id);
    const allowAutoReply = msgAgeH <= maxReplyAgeH;
    if (!allowAutoReply && !alreadyHandled) {
      skipReasons.replyTooOld += 1;
      deps.markProcessed(dossier, msgMeta.id);
      msgChanged = true;
    }
    if (!alreadyHandled && !deps.isAiAutoReplyEnabled()) {
      skipReasons.aiDisabled += 1;
    }
    if (!alreadyHandled && allowAutoReply && deps.isAiAutoReplyEnabled()) {
      inbound += 1;
      const sendGate = deps.canCamilleEmailClient(dossier, { allowIfUnansweredInbound: true });
      if (sendGate.ok && deps.acquireCamilleClientEmailLock(dossier.id)) {
        try {
          await deps.sleep(deps.getCamilleReplyDelayMs());
          const aiDecision = await deps.aiCallback(dossier, text, senderEmail, {
            emailSubject: subject,
            allDossiers: db.dossiers,
            gmailId: msgMeta.id,
            isProspectLead: true,
          });

          if (aiDecision?.status === "replied" && aiDecision.text) {
            const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
            const sent = await deps.sendEmailReplyWithGmailAPI(
              deps.accessToken,
              senderEmail,
              replySubject,
              aiDecision.text,
            );
            if (sent.ok) {
              deps.markProcessed(dossier, msgMeta.id);
              msgChanged = true;
              aiReplies += 1;
              dossier.status = "PROSPECT";
              (dossier as any).isLead = true;
              deps.upsertCommunication(dossier, {
                id: `msg_camille_${msgMeta.id}`,
                gmailId: sent.messageId,
                direction: "outbound",
                from: "Camille (IA)",
                to: senderEmail,
                subject: replySubject,
                text: aiDecision.replyPlain || "",
                date: new Date().toISOString(),
              });
              addEvent(dossier, {
                type: "AI_DECISION",
                actor: { kind: "AI", label: "Camille" },
                message: "Réponse prospect pré-étude envoyée.",
                meta: { gmailId: msgMeta.id, lead: true },
              });
            }
          } else if (aiDecision?.status === "review" || aiDecision?.status === "escalated") {
            deps.markProcessed(dossier, msgMeta.id);
            msgChanged = true;
          }
        } finally {
          deps.releaseCamilleClientEmailLock(dossier.id);
        }
      } else if (!alreadyHandled) {
        skipReasons.sendGateBlocked += 1;
        if (isCamilleTestMode()) {
          console.log(
            `[Camille prospect] pas de réponse (${sendGate.reason || "gate"}): ${senderEmail} → ${dossier.id}`,
          );
        }
        deps.markProcessed(dossier, msgMeta.id);
        msgChanged = true;
      }
    } else if (!alreadyHandled) {
      deps.markProcessed(dossier, msgMeta.id);
      msgChanged = true;
    }

    if (msgChanged) {
      deps.markDossierDirty(dossier);
      if (deps.persistLead) {
        await deps.persistLead(dossier);
      }
    }

    if (prospectsHandled >= maxProspectsPerCycle) {
      if (isCamilleTestMode()) {
        console.log(`[Camille prospect] limite ${maxProspectsPerCycle} prospect(s)/cycle — suite au prochain sync`);
      }
      break;
    }
  }

  if (leadsCreated > 0 || inbound > 0 || isCamilleTestMode()) {
    console.log(
      `[Camille prospect] scanned=${messages.length} inbound=${inbound} leadsCreated=${leadsCreated} aiReplies=${aiReplies} skips=${JSON.stringify(skipReasons)}`,
    );
  } else if (skipReasons.knownClient === messages.length && messages.length > 0) {
    console.log(
      `[Camille prospect] scanned=${messages.length} — tous expéditeurs déjà connus (supprimez le dossier ou renvoyez un mail test).`,
    );
  }

  return { inbound, aiReplies, leadsCreated };
}
