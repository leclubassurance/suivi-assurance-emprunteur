import { APPORTEUR_PROSPECTION_DISCLAIMER } from "./apporteurCompliance";
import type { ApporteurContractDocument, ApporteurContractSection } from "./apporteurContract";
import type { Apporteur } from "./apporteurTypes";
import {
  apporteurProfileToContractPartyBlock,
  formatApporteurDisplayName,
  resolveApporteurTypeLabel,
} from "./apporteurProfile";
import {
  CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC,
  CONSEILLER_AUTONOMY_SIGNED_THRESHOLD,
  CONSEILLER_PLATFORM_FEE_WAIVER_UNTIL,
} from "./conseillerImmoClub";
import { LCIF_LEGAL } from "./lcifLegalIdentity";

/** Incrémenter à chaque révision substantielle du contrat conseiller assurance. */
export const CONSEILLER_ASSURANCE_CONTRACT_VERSION = "2026-07-conseiller-v1";

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
  >,
): ApporteurContractDocument {
  const contactName = formatApporteurDisplayName(conseiller);
  const typeLabel = resolveApporteurTypeLabel(conseiller);
  const partnerBlock = apporteurProfileToContractPartyBlock(conseiller);

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
Le Contrat encadre l'activité de recommandation commerciale en assurance emprunteur exercée par le Conseiller, mandataire ou collaborateur immobilier du réseau ${CLUB}, dans le respect de la réglementation applicable et des deux phases opérationnelles définies à l'article 3.

1.2 — Mission du Conseiller
Le Conseiller recommande des contacts susceptibles de bénéficier d'une étude comparative d'assurance emprunteur (loi n° 2022-270 du 28 février 2022 — « loi Lemoine »). Il informe ses contacts de l'existence d'un service d'étude gratuite et sans engagement, sans préqualifier médicalement, sans analyser les garanties, sans comparer les contrats et sans conseiller en investissement ou en crédit au-delà de la stricte orientation vers ${CLUB}.

1.3 — Mission réservée à la Société
Seule la Société (par l'intermédiaire de ses conseillers habilités ORIAS) est autorisée à : instruire les dossiers ; établir les études d'économies ; présenter les propositions ; gérer la relation avec les assureurs et les établissements prêteurs ; procéder à la souscription sur ses outils professionnels (notamment Kereis) ; percevoir les commissions d'assureur et les frais de courtage le cas échéant.

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
${CLUB} peut suspendre l'accès en cas de manquement grave, d'impayé de la cotisation plateforme (à compter du 1er janvier 2027) ou de cessation du Contrat.`,
    },
    {
      heading: "3. Phases opérationnelles — accompagnement puis autonomie commerciale",
      body: `3.1 — Phase accompagnée (démarrage)
Tant que le Conseiller n'a pas atteint le seuil de ${CONSEILLER_AUTONOMY_SIGNED_THRESHOLD} dossiers clients d'assurance emprunteur effectivement signés (changement d'assurance réalisé) comptabilisés à vie sur son espace, il est en « phase accompagnée » :
— le Conseiller recommande des contacts via son lien personnel ;
— ${CLUB} assure l'instruction complète du dossier, les échanges opérationnels avec le client (y compris l'assistant email Camille sur assurance@leclubimmobilier.fr) et la préparation de la souscription ;
— le Conseiller suit l'avancement dans son espace.

3.2 — Phase autonome commerciale
À compter de ${CONSEILLER_AUTONOMY_SIGNED_THRESHOLD} dossiers au statut signé (compteur à vie), le Conseiller passe en « phase autonome commerciale » :
— ${CLUB} génère l'étude personnalisée et l'adresse au client et au Conseiller (copie) ;
— le Conseiller devient l'interlocuteur commercial principal du client pour la présentation de l'étude et la décision de poursuivre ;
— lorsque le client accepte, le Conseiller transmet via l'espace les informations personnelles et pièces nécessaires à la souscription (identité, adresse, RIB, CNI de chaque emprunteur, référence de l'offre de crédit) ;
— ${CLUB} procède à la souscription sur Kereis et informe le Conseiller des étapes (informations reçues, souscription en cours, souscription finalisée) ;
— les emails adressés à assurance@leclubimmobilier.fr concernant un dossier du Conseiller en phase autonome font l'objet d'un accusé indiquant que le Conseiller reprendra le client ; le Conseiller est informé du message (transfert opérationnel selon les outils en vigueur).

3.3 — Compteur
Seuls les dossiers effectivement signés et conformes sont pris en compte pour le seuil. Le compteur n'est pas réinitialisé.

3.4 — Interdiction de parrainage apporteurs
Le Conseiller ne dispose pas du programme de recommandation d'apporteurs d'affaires ni d'aucune rémunération de réseau sur des filleuls apporteurs. Toute tentative de recrutement d'apporteurs d'affaires via l'espace conseiller est interdite.`,
    },
    {
      heading: "4. Obligations du Conseiller",
      body: `Le Conseiller s'engage à :
— recommander ${CLUB} avec loyauté et transparence (script de rémunération en cas de changement effectif, sans surcoût pour le client) ;
— orienter les contacts vers le formulaire en ligne ou le lien personnel ;
— ne pas promettre de résultat (montant d'économies, acceptation, délai garanti) ;
— respecter la prospection : ${APPORTEUR_PROSPECTION_DISCLAIMER}
— en phase autonome : répondre au client dans des délais professionnels et transmettre sans délai les éléments de souscription via l'espace ;
— ne pas collecter de questionnaires de santé ni de données médicales hors canaux ${CLUB} ;
— ne pas percevoir de fonds pour le compte de la Société ou des clients ;
— maintenir une assurance responsabilité civile professionnelle adaptée et la justifier sur demande.`,
    },
    {
      heading: "5. Rémunération — barème — conditions de déclenchement",
      body: `5.1 — Principe
Pour chaque dossier d'assurance emprunteur effectivement conclu par un client apporté par le Conseiller et dont la commission assureur est encaissée par la Société, le Conseiller perçoit une rémunération égale à soixante-dix pour cent (70 %) des frais de courtage effectivement perçus par ${CLUB} sur ce dossier.

5.2 — Barème des frais de courtage
Sauf mention contraire sur l'étude personnalisée transmise au client, les frais de courtage sont calculés selon le barème suivant : dix pour cent (10 %) de l'économie totale réalisée sur la durée de l'emprunt restante, avec un minimum de deux cents euros (200 €) et un maximum de cinq cents euros (500 €) par assuré.

5.3 — Condition suspensive
Aucune rémunération n'est due tant que la Société n'a pas effectivement perçu la commission de l'assureur et que le dossier est conforme (absence de rétractation fondée, de fraude ou de non-respect des conditions).

5.4 — Absence de rémunération réseau
Aucune commission de parrainage, override ou réseau n'est due au titre du recrutement d'autres partenaires.`,
    },
    {
      heading: "6. Cotisation plateforme",
      body: `6.1 — Franchise
Jusqu'au ${CONSEILLER_PLATFORM_FEE_WAIVER_UNTIL} inclus, l'accès à l'espace conseiller assurance emprunteur est fourni sans cotisation annuelle.

6.2 — À compter du 1er janvier 2027
À compter du 1er janvier 2027, le Conseiller s'acquitte d'une cotisation annuelle de ${CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC} euros toutes taxes comprises pour l'utilisation de l'espace et des outils associés. Le paiement est annuel, payable à réception de facture.

6.3 — Suspension
En cas de non-paiement après mise en demeure, ${CLUB} peut suspendre l'accès à l'espace sans préjudice des sommes dues.`,
    },
    {
      heading: "7. Facturation — TVA — paiement des commissions",
      body: `Les commissions sont payées par virement après encaissement effectif de la commission assureur, sur facture du Conseiller s'il est assujetti à la TVA, ou selon les usages de ${CLUB}. Les montants sont exprimés HT ou TTC selon le statut fiscal du Conseiller, déclaré à la Société.`,
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
      body: `Contrat à durée indéterminée à compter de la signature électronique. Résiliation par chaque partie avec préavis de quinze (15) jours par email avec accusé de réception. Les commissions sur dossiers signés avant résiliation restent exigibles selon l'article 5.`,
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
