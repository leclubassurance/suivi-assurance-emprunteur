import type { Dossier } from "./dossierModel";
import {
  ensureClientPortalToken,
  getClientPortalAbsoluteUrl,
  resolvePublicAppBaseUrl,
} from "./clientPortal";
import { resolveAssurancePublicSiteUrl } from "../shared/platformUrls";
import { isLeadDossier } from "../shared/leadDossierStatus";
import { hasStudyBeenSent } from "./dossierLifecycle";

/** URL publique du formulaire de dépôt (page d'accueil SPA). */
export function resolveClientFormPublicUrl(): string {
  const explicit = String(process.env.CLIENT_FORM_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const fromHelper = resolveAssurancePublicSiteUrl();
  if (fromHelper.startsWith("http")) return fromHelper;

  const railway = resolvePublicAppBaseUrl();
  return railway || fromHelper;
}

export type CamilleClientLinks = {
  formUrl: string;
  portalUrl: string | null;
  formSubmitted: boolean;
  isProspectLead: boolean;
  studySent: boolean;
  preferredLinkKind: "form" | "portal" | "none";
};

export function resolveCamilleClientLinks(dossier: Dossier): CamilleClientLinks {
  const formUrl = resolveClientFormPublicUrl();
  const isProspectLead = isLeadDossier(dossier);
  const formSubmitted = Boolean(dossier.leadPromotedAt) || (!isProspectLead && Boolean(dossier.formData?.assures?.[0]?.email));
  const studySent = hasStudyBeenSent(dossier);

  let portalUrl: string | null = null;
  if (!isProspectLead && formSubmitted) {
    const token = ensureClientPortalToken(dossier);
    portalUrl = getClientPortalAbsoluteUrl(token, resolvePublicAppBaseUrl());
    if (!portalUrl.startsWith("http")) portalUrl = null;
  }

  const preferredLinkKind: CamilleClientLinks["preferredLinkKind"] = isProspectLead
    ? "form"
    : formSubmitted
      ? "portal"
      : "form";

  return { formUrl, portalUrl, formSubmitted, isProspectLead, studySent, preferredLinkKind };
}

const FORM_JOURNEY_STEPS = `
PARCOURS FORMULAIRE EN LIGNE (6 écrans, une session, sans mot de passe) :
1. Accueil — présentation ; bouton « Commencer mon étude ».
2. Préparation — rappel des pièces : offre de prêt + tableau d'amortissement en PDF (depuis l'espace banque).
3. Projet — objet du financement, montants, assureur actuel.
4. Coordonnées — email et téléphone de l'emprunteur principal.
5. Infos personnelles — identité, date de naissance, situation (fumeur, etc.), co-emprunteur si besoin.
6. Documents — dépôt des PDF (offre, tableau, contrat/devis si assurance externe) + case consentement RGPD + validation finale.

Après validation : email de confirmation de Charles avec le numéro LCIF + lien personnel de suivi (/suivi/…).
Ensuite : échanges par email avec Camille ; les pièces complémentaires se envoient en répondant à ce fil (pas besoin de refaire tout le formulaire).
`.trim();

export function buildCamilleFormJourneyPromptBlock(dossier: Dossier): string {
  const links = resolveCamilleClientLinks(dossier);
  const lines = [
    "LIENS ET PARCOURS CLIENT (source de vérité — ne jamais inventer d'autre URL)",
    "",
    `URL formulaire dépôt (page d'accueil) : ${links.formUrl}`,
    links.portalUrl
      ? `URL suivi dossier (après formulaire déposé) : ${links.portalUrl}`
      : "URL suivi dossier : pas encore disponible (formulaire non validé)",
    "",
    `État : ${links.isProspectLead ? "prospect pré-formulaire" : "dossier client"} | formulaire déposé : ${links.formSubmitted ? "OUI" : "NON"} | étude envoyée : ${links.studySent ? "OUI" : "NON"}`,
    "",
    "Règles liens dans messageToClient :",
    links.isProspectLead || !links.formSubmitted
      ? "- Client demande le lien / comment déposer → donner l'URL formulaire ci-dessus (une seule URL, copier exactement)."
      : "- Client demande le lien formulaire alors que dossier déjà déposé → indiquer le lien de SUIVI (portal), pas un nouveau formulaire.",
    links.formSubmitted && links.portalUrl
      ? "- Client demande où en est son dossier / suivi → donner l'URL suivi ci-dessus."
      : "",
    links.studySent
      ? "- Après étude envoyée : ne pas renvoyer au formulaire pour déposer offre/tableau — répondre par email avec PDF en PJ si besoin."
      : "- Avant étude : priorité offre + tableau (formulaire ou PJ mail).",
    "",
    FORM_JOURNEY_STEPS,
  ];

  return lines.filter(Boolean).join("\n");
}

/** Si le client demande un lien et la réponse n'en contient pas, ajoute l'URL correcte. */
export function ensureClientLinksInCamilleReply(
  plain: string,
  dossier: Dossier,
  clientMessage?: string,
): string {
  const text = String(plain || "").trim();
  if (!text) return text;

  const blob = `${clientMessage || ""} ${text}`.toLowerCase();
  const asksLink =
    /\b(lien|url|adresse|page|site|formulaire|déposer|deposer|acc[eè]s|comment (faire|remplir|déposer))\b/i.test(
      blob,
    );
  if (!asksLink) return text;

  const links = resolveCamilleClientLinks(dossier);
  const hasHttp = /https?:\/\/[^\s]+/i.test(text);
  const hasCorrectForm = links.formUrl && text.includes(links.formUrl);
  const hasCorrectPortal = links.portalUrl && text.includes(links.portalUrl);

  if (hasHttp && (hasCorrectForm || hasCorrectPortal)) return text;

  const targetUrl =
    links.preferredLinkKind === "portal" && links.portalUrl
      ? links.portalUrl
      : links.formUrl;

  const label =
    links.preferredLinkKind === "portal"
      ? "Voici votre lien de suivi personnel"
      : "Voici le lien pour déposer votre dossier en ligne";

  if (hasHttp && !hasCorrectForm && !hasCorrectPortal) {
    return text.replace(/https?:\/\/[^\s<]+/gi, targetUrl);
  }

  return `${text}\n\n${label} :\n${targetUrl}`;
}
