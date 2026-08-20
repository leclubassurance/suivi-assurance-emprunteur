import { CONSEILLER_PROSPECTION_DISCLAIMER } from "./apporteurCompliance";
import type { ApporteurContractDocument, ApporteurContractSection } from "./apporteurContract";
import type { Apporteur } from "./apporteurTypes";
import {
  apporteurProfileToContractPartyBlock,
  companyInCreationRemunerationClause,
  formatApporteurDisplayName,
  resolveApporteurTypeLabel,
} from "./apporteurProfile";
import {
  formatBrokerageShareForContract,
  resolveBrokerageSharePercent,
} from "./apporteurBrokerageShare";
import { CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC } from "./conseillerImmoClub";
import { LCIF_LEGAL } from "./lcifLegalIdentity";

/** Incrémenter à chaque révision substantielle du contrat conseiller assurance. */
export const CONSEILLER_ASSURANCE_CONTRACT_VERSION = "2026-08-conseiller-v6";

const CLUB = "Le Club Immobilier Français";
const SOCIETE = LCIF_LEGAL.companyName;

function clubIdentityBlock(): string {
  return [
    `${SOCIETE}, ${LCIF_LEGAL.legalForm} au capital social de ${LCIF_LEGAL.shareCapitalEur} euros,`,
    `immatriculée au Registre du commerce et des sociétés de ${LCIF_LEGAL.rcsCity} sous le numéro ${LCIF_LEGAL.rcsNumber},`,
    `numéro SIREN ${LCIF_LEGAL.siren}, numéro SIRET ${LCIF_LEGAL.siretEstablishment},`,
    `dont le siège social est situé ${LCIF_LEGAL.registeredOffice},`,
    `représentée par ${LCIF_LEGAL.legalRepresentative}, en qualité de ${LCIF_LEGAL.legalRepresentativeTitle},`,
    `exerçant une activité de ${LCIF_LEGAL.insuranceActivity},`,
    `immatriculée au registre unique des intermédiaires en assurance, banque et finance (ORIAS) sous le numéro ${LCIF_LEGAL.oriasNumber} (consultable sur ${LCIF_LEGAL.oriasUrl}),`,
    `titulaire de la carte professionnelle d'agent immobilier ${LCIF_LEGAL.cpiNumber}, délivrée le ${LCIF_LEGAL.cpiIssuedAt} par ${LCIF_LEGAL.cpiAuthority},`,
    `assurée en responsabilité civile professionnelle auprès de ${LCIF_LEGAL.professionalInsurance.insurer}, ${LCIF_LEGAL.professionalInsurance.address}, police n° ${LCIF_LEGAL.professionalInsurance.policyNumber}.`,
  ].join("\n");
}

function buildPlatformFeeArticleBody(): string {
  return `6.1 — Nature et objet
L'accès à l'espace conseiller assurance emprunteur, aux outils associés (lien de recommandation, suivi des dossiers, validation des frais de courtage le cas échéant) est soumis au paiement d'une cotisation annuelle de ${CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC} euros toutes taxes comprises.

Cette cotisation constitue une redevance B2B d'accès à la plateforme et aux services associés ; elle ne constitue pas une prestation de formation au sens du Code de la consommation.

6.2 — Modalités de paiement et prise d'effet
Le paiement s'effectue selon les modalités indiquées par la Société (lien de paiement sécurisé). L'accès est ouvert après validation du paiement par ${CLUB}, qui en accuse réception sur l'espace ou par email.

6.3 — Durée et renouvellement
La cotisation couvre une période de douze (12) mois à compter de la date de validation du paiement. Elle se renouvelle tacitement chaque année à la date anniversaire, sous réserve du paiement de la cotisation en vigueur et de la non-résiliation du Contrat.

6.4 — Absence de droit de rétractation (B2B)
Le Contrat est conclu entre professionnels. Le Conseiller reconnaît que le droit de rétractation de quatorze (14) jours prévu pour les contrats de prestation de services conclus à distance avec des consommateurs ne lui est pas applicable au titre de la cotisation plateforme.

6.5 — Résiliation et remboursement
En cas de résiliation par le Conseiller (article 11), aucun remboursement au prorata de la cotisation en cours n'est dû : la période déjà payée reste acquise jusqu'à son terme, sous réserve de la suspension d'accès en cas de manquement grave.

En cas de résiliation par la Société sans manquement grave du Conseiller, un remboursement au prorata des mois non écoulés de la période en cours pourra être accordé, sur demande écrite adressée à ${LCIF_LEGAL.contactEmail} dans les trente (30) jours suivant la prise d'effet de la résiliation.

En cas de suspension ou de résiliation pour manquement grave, fraude ou impayé, aucun remboursement n'est dû.

6.6 — Société ou activité en cours de création
Si le Conseiller a déclaré une société ou activité en cours de création au moment de la signature et qu'aucune immatriculation valide (SIRET ou SIREN) n'a été communiquée à la Société dans un délai de six (6) mois suivant la signature, le Conseiller peut demander par email le remboursement intégral de la dernière cotisation plateforme versée, dans un délai de trente (30) jours à compter de l'expiration de ce délai de six mois, sous réserve qu'aucune rétrocession n'ait été due au titre de l'article 5 sur un dossier conclu entre-temps. ${CLUB} procède au remboursement sous trente (30) jours ouvrés si la demande est fondée.

6.7 — Suspension pour impayé
En cas de non-paiement à l'échéance annuelle ou après relance restée sans effet dans un délai de quinze (15) jours, ${CLUB} peut suspendre l'accès sans préjudice des sommes dues et sans remboursement de la période expirée.`;
}

export function buildConseillerAssuranceContractDocument(
  conseiller: Pick<
    Apporteur,
    | "contactName"
    | "contactPrenom"
    | "contactNom"
    | "companyName"
    | "companyLegalName"
    | "email"
    | "phone"
    | "addressLine"
    | "postalCode"
    | "city"
    | "siret"
    | "siren"
    | "legalForm"
    | "legalFormOther"
    | "type"
    | "typeCustomLabel"
    | "companyInCreation"
    | "brokerageSharePercent"
  >,
): ApporteurContractDocument {
  const contactName = formatApporteurDisplayName(conseiller);
  const typeLabel = resolveApporteurTypeLabel(conseiller);
  const partnerBlock = apporteurProfileToContractPartyBlock(conseiller);
  const share = formatBrokerageShareForContract(resolveBrokerageSharePercent(conseiller));
  const examplePayout = Math.round(300 * (share.percentInt / 100));

  const sections: ApporteurContractSection[] = [
    {
      heading: "1. Objet — identification des parties — nature des relations",
      body: `Le présent contrat de collaboration commerciale — activité assurance emprunteur (ci-après le « Contrat ») est conclu entre :

D'une part,
${clubIdentityBlock()}

Ci-après dénommée « ${CLUB} » ou « la Société ».

D'autre part,
${partnerBlock}
(ci-après le « Conseiller »).

1.1 — Objet
Le Contrat encadre l'activité de recommandation commerciale en assurance emprunteur exercée par le Conseiller, mandataire ou collaborateur immobilier du réseau ${CLUB}, dans le respect de la réglementation applicable et des modalités opérationnelles définies à l'article 3.

1.2 — Mission du Conseiller
Le Conseiller recommande des contacts susceptibles de bénéficier d'une étude comparative d'assurance emprunteur (loi n° 2022-270 du 28 février 2022 — « loi Lemoine »). Il informe ses contacts de l'existence d'un service d'étude gratuite et sans engagement, sans préqualifier médicalement, sans analyser les garanties, sans comparer les contrats et sans conseiller en investissement ou en crédit au-delà de la stricte orientation vers ${CLUB}.

1.3 — Mission réservée à la Société
Seule la Société (par l'intermédiaire de ses conseillers habilités ORIAS) est autorisée à : instruire les dossiers ; établir les études d'économies ; présenter les propositions ; gérer la relation avec les assureurs et les établissements prêteurs ; procéder seule à la souscription des contrats d'assurance emprunteur ; percevoir les commissions d'assureur et les frais de courtage le cas échéant.

Le Conseiller n'est pas habilité à souscrire des contrats d'assurance, à accéder aux portails ou extranets des compagnies d'assurance, ni à effectuer pour le compte du client ou de la Société une quelconque démarche de souscription sur ces portails.

1.4 — Absence de lien de subordination
Le Contrat n'emporte ni contrat de travail salarié, ni mandat d'intermédiaire en assurance au sens du code des assurances au titre du Conseiller. Le Conseiller organise librement son activité commerciale dans le cadre défini au présent Contrat.`,
    },
    {
      heading: "2. Accès — identité numérique — espace en ligne",
      body: `2.1 — Compte
L'accès à l'espace conseiller est créé par ${CLUB} (pas d'auto-inscription). Le Conseiller se connecte via son compte Google professionnel dont l'adresse email se termine par @leclubimmobilier.fr.

2.2 — Usage
Le Conseiller s'engage à préserver la confidentialité de ses identifiants, à n'utiliser l'espace qu'aux fins du Contrat et à ne pas communiquer ses accès à des tiers.

2.3 — Suspension
${CLUB} peut suspendre l'accès en cas de manquement grave, d'impayé de la cotisation annuelle plateforme (article 6) ou de cessation du Contrat.`,
    },
    {
      heading: "3. Modalités opérationnelles",
      body: `3.1 — Recommandation
Le Conseiller recommande des contacts via son lien personnel ou le formulaire en ligne mis à disposition.

3.2 — Instruction par la Société
${CLUB} assure l'instruction complète des dossiers, les échanges opérationnels avec les clients (notamment via assurance@leclubimmobilier.fr), l'établissement et l'envoi des études personnalisées, la validation des frais de courtage avec le Conseiller lorsque applicable, ainsi que la souscription des contrats d'assurance emprunteur auprès des assureurs partenaires.

3.3 — Suivi
Le Conseiller suit l'avancement des dossiers qu'il a apportés dans son espace en ligne. Il n'est pas l'interlocuteur réglementaire du client pour la distribution d'assurance et ne présente pas les propositions au nom de la Société.

3.4 — Interdictions
Le Conseiller ne souscrit pas de contrats d'assurance, n'accède pas aux portails ou extranets des compagnies d'assurance et ne collecte pas de questionnaires de santé ni de données médicales hors les canaux ${CLUB}.`,
    },
    {
      heading: "4. Obligations du Conseiller",
      body: `Le Conseiller s'engage à :
— recommander ${CLUB} avec loyauté et transparence (script de rémunération en cas de changement effectif, sans surcoût pour le client) ;
— orienter les contacts vers le formulaire en ligne ou le lien personnel ;
— ne pas promettre de résultat (montant d'économies, acceptation, délai garanti) ;
— respecter la prospection : ${CONSEILLER_PROSPECTION_DISCLAIMER}
— ne pas accéder aux portails de souscription des compagnies d'assurance ni conclure de contrat d'assurance au nom du client ou de la Société ;
— ne pas collecter de questionnaires de santé ni de données médicales hors canaux ${CLUB} ;
— ne pas percevoir de fonds pour le compte de la Société ou des clients ;
— maintenir une assurance responsabilité civile professionnelle adaptée et la justifier sur demande.`,
    },
    {
      heading: "5. Rémunération — barème — conditions de déclenchement",
      body: `5.1 — Principe de rétrocession
Pour chaque dossier d'assurance emprunteur effectivement conclu par un client apporté par le Conseiller et dont la commission assureur est encaissée par la Société, le Conseiller perçoit une rétrocession égale à ${share.label} des frais de courtage effectivement perçus par ${CLUB} sur ce dossier.

Les frais de courtage visés ci-dessus sont ceux facturés au client par la Société au titre de la mise en place du changement d'assurance (honoraires de courtage), et non la commission versée par l'assureur à la Société.

5.2 — Barème des frais de courtage (base de calcul)
Sauf mention contraire sur l'étude personnalisée transmise au client, les frais de courtage sont calculés selon le barème suivant, exprimés en euros toutes taxes comprises (TTC) par assuré :
— dix pour cent (10 %) de l'économie totale réalisée sur la durée de l'emprunt restante ;
— avec un minimum de deux cents euros (200 € TTC) et un maximum de cinq cents euros (500 € TTC) par assuré.

La rétrocession du Conseiller (${share.percentInt} %) s'applique sur le montant TTC des frais de courtage effectivement encaissés par la Société sur le dossier.

Exemple indicatif : pour un dossier avec un assuré et des frais de courtage de 300 € TTC encaissés par la Société, la rétrocession due au Conseiller est de ${examplePayout} € TTC (${share.percentInt} % × 300 €), sous réserve des conditions de l'article 5.4 et du régime de TVA à l'article 7.

5.3 — Montants HT ou TTC pour le Conseiller
Sauf mention contraire, les montants de rétrocession communiqués dans l'espace conseiller ou les échanges avec la Société sont exprimés :
— en euros hors taxes (HT) si le Conseiller est assujetti à la TVA et facture la Société ;
— en euros toutes taxes comprises (TTC) si le Conseiller n'est pas assujetti à la TVA.

La Société ne verse pas de TVA au Conseiller non assujetti. Si le Conseiller est assujetti, il facture HT et la TVA au taux en vigueur s'ajoute sur sa facture.

5.4 — Conditions suspensives
Aucune rétrocession n'est due tant que :
— la Société n'a pas effectivement perçu la commission de l'assureur et les frais de courtage sur le dossier ;
— le dossier n'est pas conforme (absence de rétractation fondée, de fraude ou de non-respect des conditions) ;
— le client apporté est identifiable comme provenant du lien ou de la recommandation du Conseiller.

En cas d'annulation, de rétractation légale ou de remboursement de commission ou de frais par l'assureur ou le client, la rétrocession correspondante pourra être annulée ou faire l'objet d'une régularisation sur les sommes ultérieurement dues.

5.5 — Absence de rémunération de réseau
La rétrocession ne concerne que les dossiers clients apportés directement par le Conseiller. Aucune commission de parrainage, override ou rémunération de réseau n'est due au titre d'autres partenaires.${
        conseiller.companyInCreation
          ? `\n\n5.6 — Société en cours de création\n${companyInCreationRemunerationClause({
              partyLabel: "Conseiller",
              remunerationLabel: "rétrocession",
            })}`
          : ""
      }`,
    },
    {
      heading: "6. Cotisation plateforme",
      body: buildPlatformFeeArticleBody(),
    },
    {
      heading: "7. Facturation — TVA — paiement des rétrocessions",
      body: `7.1 — Facturation
Les rétrocessions sont payées par virement bancaire après encaissement effectif de la commission assureur et des frais de courtage par la Société.

7.2 — Conseiller assujetti à la TVA
Le Conseiller adresse à ${CLUB} une facture conforme (mentions légales obligatoires, numéro de TVA intracommunautaire le cas échéant, période, description : « apport d'affaires assurance emprunteur » ou formulation équivalente). Les montants de rétrocession convenus sont exprimés hors taxes (HT) ; la TVA au taux en vigueur s'ajoute sur la facture du Conseiller.

7.3 — Conseiller non assujetti à la TVA
Le Conseiller le déclare expressément à la Société et certifie ne pas être redevable de la TVA sur les rétrocessions perçues au titre du présent Contrat, sous sa responsabilité. Les montants lui sont alors versés toutes taxes comprises (TTC), sans facturation de TVA.

7.4 — Retenues
La Société pourra procéder à des retenues ou compensations en cas de trop-perçu, d'annulation de dossier ou de manquement avéré au présent Contrat, après information du Conseiller.`,
    },
    {
      heading: "8. Propriété intellectuelle — marque — confidentialité",
      body: `Les marques et supports ${CLUB} restent la propriété de la Société. Le Conseiller dispose d'une licence limitée à la durée du Contrat. Chaque partie conserve confidentielles les informations non publiques échangées (données clients, processus, barèmes). Obligation de confidentialité : cinq (5) ans après cessation.`,
    },
    {
      heading: "9. Protection des données personnelles (RGPD)",
      body: `Le Conseiller agit en responsable de traitement pour les données qu'il collecte auprès de ses contacts ; ${CLUB} est responsable de traitement pour les dossiers instruits. Le Conseiller informe les contacts du transfert à ${CLUB}, limite les données au nécessaire et oriente les demandes d'exercice de droits vers ${LCIF_LEGAL.contactEmail} ou assurance@leclubimmobilier.fr. Référent données : ${LCIF_LEGAL.dataProtectionContact}, ${LCIF_LEGAL.dataProtectionContactRole}.`,
    },
    {
      heading: "10. Assurance — responsabilité",
      body: `Le Conseiller maintient une assurance responsabilité civile professionnelle et garantit ${CLUB} contre les réclamations résultant de sa prospection ou de ses engagements hors périmètre. La responsabilité de ${CLUB} est limitée au montant des commissions versées au cours des douze (12) mois précédant le fait générateur, sauf faute lourde.`,
    },
    {
      heading: "11. Durée — résiliation",
      body: `Contrat à durée indéterminée à compter de la signature électronique. Résiliation par chaque partie avec préavis de quinze (15) jours par email avec accusé de réception.

La résiliation met fin à l'accès à l'espace ; les conséquences sur la cotisation plateforme en cours sont définies à l'article 6.5.

Les rétrocessions sur dossiers signés avant résiliation restent exigibles selon l'article 5.`,
    },
    {
      heading: "12. Médiation — réclamations — droit applicable",
      body: `Réclamations : ${LCIF_LEGAL.contactEmail}. Médiation assurance : ${LCIF_LEGAL.mediationInsurance.website}. Médiateur consommation : ${LCIF_LEGAL.mediationConsumption.name}, ${LCIF_LEGAL.mediationConsumption.address}. Droit français. Tribunaux du ressort du siège de ${CLUB}, sous réserve des règles impératives.`,
    },
    {
      heading: "13. Acceptation électronique",
      body: `En validant le présent Contrat (version ${CONSEILLER_ASSURANCE_CONTRACT_VERSION}), le Conseiller reconnaît en avoir pris connaissance et l'accepter sans réserve. ${CLUB} apposera sa contre-signature électronique. Un PDF signé est remis au Conseiller et archivé par la Société.`,
    },
  ];

  return {
    version: CONSEILLER_ASSURANCE_CONTRACT_VERSION,
    title: `Contrat conseiller immobilier — assurance emprunteur — ${CLUB}`,
    preamble: `Conseiller : ${typeLabel} · ${contactName}${conseiller.companyName ? ` · ${conseiller.companyName}` : ""} · Version ${CONSEILLER_ASSURANCE_CONTRACT_VERSION}.`,
    sections,
    acceptanceLabel: `Je certifie avoir lu l'intégralité du contrat conseiller assurance emprunteur de ${CLUB}, en accepter tous les termes sans réserve, et disposer de la capacité juridique pour m'y engager.`,
  };
}
