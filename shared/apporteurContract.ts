import { APPORTEUR_CONTRACT_MLM_CLAUSE } from "./apporteurContractMlm";
import { APPORTEUR_PROSPECTION_DISCLAIMER } from "./apporteurCompliance";
import { LCIF_LEGAL } from "./lcifLegalIdentity";
import type { Apporteur } from "./apporteurTypes";
import {
  apporteurProfileToContractPartyBlock,
  formatApporteurDisplayName,
  resolveApporteurTypeLabel,
} from "./apporteurProfile";

/** Incrémenter à chaque révision substantielle du contrat affiché en ligne. */
export const APPORTEUR_CONTRACT_VERSION = "2026-07-v1";

const CLUB = "Le Club Immobilier Français";
const SOCIETE = LCIF_LEGAL.companyName;

export type ApporteurContractSection = {
  heading: string;
  body: string;
};

export type ApporteurContractDocument = {
  version: string;
  title: string;
  preamble: string;
  sections: ApporteurContractSection[];
  acceptanceLabel: string;
};

function clubIdentityBlock(): string {
  return [
    `${SOCIETE}, ${LCIF_LEGAL.legalForm} au capital social de ${LCIF_LEGAL.shareCapitalEur} euros,`,
    `immatriculée au Registre du commerce et des sociétés de ${LCIF_LEGAL.rcsCity} sous le numéro ${LCIF_LEGAL.rcsNumber},`,
    `numéro SIREN ${LCIF_LEGAL.siren}, numéro SIRET ${LCIF_LEGAL.siretEstablishment},`,
    `numéro de TVA intracommunautaire ${LCIF_LEGAL.vatNumber},`,
    `dont le siège social est situé ${LCIF_LEGAL.registeredOffice},`,
    `représentée par ${LCIF_LEGAL.legalRepresentative}, en qualité de ${LCIF_LEGAL.legalRepresentativeTitle},`,
    `exerçant une activité de ${LCIF_LEGAL.insuranceActivity},`,
    `immatriculée au registre unique des intermédiaires en assurance, banque et finance (ORIAS) sous le numéro ${LCIF_LEGAL.oriasNumber} (consultable sur ${LCIF_LEGAL.oriasUrl}),`,
    `titulaire de la carte professionnelle d'agent immobilier ${LCIF_LEGAL.cpiNumber}, délivrée le ${LCIF_LEGAL.cpiIssuedAt} par ${LCIF_LEGAL.cpiAuthority},`,
    `assurée en responsabilité civile professionnelle auprès de ${LCIF_LEGAL.professionalInsurance.insurer}, ${LCIF_LEGAL.professionalInsurance.address}, police n° ${LCIF_LEGAL.professionalInsurance.policyNumber}.`,
  ].join("\n");
}

export function buildApporteurContractDocument(
  apporteur: Pick<
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
  sponsorName?: string | null,
): ApporteurContractDocument {
  const contactName = formatApporteurDisplayName(apporteur);
  const typeLabel = resolveApporteurTypeLabel(apporteur);
  const partnerBlock = apporteurProfileToContractPartyBlock(apporteur);
  const sponsorBlock = sponsorName
    ? `\n\nLe Partenaire déclare avoir été recommandé par ${sponsorName}, qui exerce en qualité de parrain au sens de l'article relatif au programme de recommandation de partenaires figurant au présent Contrat.`
    : "";

  const sections: ApporteurContractSection[] = [
    {
      heading: "1. Objet — identification des parties — nature des relations",
      body: `Le présent contrat d'apporteur d'affaires (ci-après le « Contrat ») est conclu entre :

D'une part,
${clubIdentityBlock()}

Ci-après dénommée « ${CLUB} » ou « la Société ».

D'autre part,
${partnerBlock}
(ci-après « le Partenaire »).${sponsorBlock}

1.1 — Objet du Contrat
Le Contrat a pour objet de définir les conditions dans lesquelles le Partenaire recommande, à titre strictement commercial et non exclusif, des contacts (personnes physiques ou morales) susceptibles de bénéficier d'une étude comparative d'assurance emprunteur et, le cas échéant, d'un accompagnement dans le cadre de la loi n° 2022-270 du 28 février 2022 relative à la résiliation des contrats de assurance emprunteur (dite « loi Lemoine ») et des textes applicables.

1.2 — Périmètre de la mission du Partenaire
Le Partenaire a pour mission exclusive de mettre en relation des contacts avec ${CLUB}, au moyen du lien de recommandation ou de l'espace partenaire mis à disposition. Il informe les contacts de l'existence d'un service d'étude gratuite et sans engagement, sans préqualifier médicalement, sans analyser les garanties, sans comparer les contrats et sans conseiller en investissement ou en crédit.

1.3 — Périmètre réservé à la Société
Seule la Société (par l'intermédiaire de ses conseillers habilités) est autorisée à : recevoir et instruire les dossiers ; analyser les documents ; établir les études d'économies ; présenter les propositions ; gérer la relation avec les établissements prêteurs et les assureurs ; conclure les contrats d'assurance ; percevoir les commissions d'assureur et les honoraires de courtage le cas échéant.

1.4 — Absence de lien de subordination
Les parties confirment expressément que le Contrat n'emporte ni contrat de travail, ni mandat social, ni mandat d'intermédiaire en assurance au sens du code des assurances. Le Partenaire organise librement son activité, ses horaires et ses moyens.`,
    },
    {
      heading: "2. Statut du Partenaire — conformité réglementaire",
      body: `2.1 — Apporteur d'affaires indépendant
Le Partenaire agit en qualité d'apporteur d'affaires indépendant, pour son propre compte. Il n'est ni salarié, ni agent, ni mandataire, ni collaborateur exclusif de ${CLUB}, et ne représente pas la Société vis-à-vis des tiers.

2.2 — Absence d'immatriculation ORIAS
L'activité de recommandation commerciale exercée par le Partenaire ne constitue pas une activité d'intermédiation en assurance. Le Partenaire n'est pas tenu de s'immatriculer à l'ORIAS pour cette seule activité, sous réserve qu'il ne dépasse pas le périmètre défini au présent Contrat.

2.3 — Interdictions
Il est strictement interdit au Partenaire de :
— présenter des garanties ou des tarifs comme définitifs ;
— collecter des questionnaires de santé ou des données médicales en dehors des canaux sécurisés de la Société ;
— signer un document au nom du client ou de la Société ;
— percevoir des fonds pour le compte de la Société ou des clients ;
— utiliser la marque ou les supports de ${CLUB} de manière non conforme aux instructions communiquées.

2.4 — Autres activités
Le Partenaire demeure libre d'exercer toute autre activité professionnelle, sous réserve de ne pas porter atteinte aux intérêts légitimes de ${CLUB} ni de créer de confusion sur son statut indépendant.

2.5 — Profils immobiliers ou de conseil
Les partenaires exerçant une activité immobilière, de transaction ou de conseil patrimonial le font à titre distinct de leur mission au présent Contrat. Ils ne représentent pas ${CLUB} en assurance et ne doivent pas laisser entendre qu'ils conseillent, comparent ou souscrivent des contrats d'assurance pour le compte de la Société.`,
    },
    {
      heading: "3. Obligations du Partenaire",
      body: `Le Partenaire s'engage à :
— recommander ${CLUB} avec loyauté, en s'appuyant sur les supports officiels ;
— orienter les contacts vers le formulaire en ligne ou le lien personnel de recommandation ;
— ne pas faire de promesses de résultat (montant d'économies, acceptation bancaire, délai garanti) ;
— informer sans délai la Société de toute difficulté ou réclamation dont il aurait connaissance ;
— respecter la réglementation applicable en matière de prospection : ${APPORTEUR_PROSPECTION_DISCLAIMER}
— disposer, s'il est assujetti, d'un numéro de TVA intracommunautaire valide et le communiquer à la Société ;
— souscrire et maintenir une assurance responsabilité civile professionnelle adaptée à son activité, sur demande de la Société.`,
    },
    {
      heading: "4. Obligations de la Société",
      body: `${CLUB} s'engage à :
— instruire les dossiers transmis dans des conditions professionnelles conformes à son statut d'intermédiaire ORIAS ;
— tenir le Partenaire informé, via l'espace partenaire, de l'avancement des recommandations ;
— calculer les rémunérations dues conformément au barème en vigueur et au présent Contrat ;
— traiter les données personnelles conformément à la réglementation et à l'article 12 du présent Contrat ;
— ne pas modifier unilatéralement les conditions de rémunération rétroactivement sur les dossiers déjà signés et conformes au moment de la signature client.`,
    },
    {
      heading: "5. Rémunération — barème — conditions de déclenchement",
      body: `5.1 — Principe
Pour chaque dossier d'assurance emprunteur effectivement conclu par un client apporté par le Partenaire et dont la commission assureur est encaissée par la Société, le Partenaire perçoit une rémunération égale à cinquante pour cent (50 %) des frais de courtage effectivement perçus par ${CLUB} sur ce dossier.

5.2 — Barème des frais de courtage
Sauf mention contraire sur l'étude personnalisée transmise au client, les frais de courtage sont calculés selon le barème suivant : dix pour cent (10 %) de l'économie totale réalisée sur la durée de l'emprunt restante, avec un minimum de deux cents euros (200 €) et un maximum de cinq cents euros (500 €) par assuré. Les simulations affichées dans l'espace partenaire sont indicatives.

5.3 — Condition suspensive
Aucune rémunération n'est due tant que :
— la Société n'a pas effectivement perçu la commission de l'assureur ;
— le dossier n'est pas conforme (absence de rétractation, de réclamation fondée, de fraude ou de non-respect des conditions de garantie équivalente) ;
— le client apporté est identifiable comme provenant du lien ou de la recommandation du Partenaire.

5.4 — Réclamations et annulations
En cas d'annulation, de rétractation légale ou de remboursement de commission par l'assureur, la rémunération correspondante pourra être annulée ou faire l'objet d'une régularisation sur les sommes ultérieurement dues.

5.5 — Révision à la hausse en fonction du volume
En fonction du volume de contrats effectivement conclus et de l'engagement du Partenaire, le mandant (Le Club Immobilier Français) se réserve la faculté de réviser à la hausse les taux ou montants de rémunération prévus au présent article, à titre de gratification de l'engagement de l'apporteur d'affaires. Toute révision favorable fera l'objet d'une information écrite au Partenaire et ne s'appliquera qu'aux dossiers conclus postérieurement à cette information, sauf mention contraire expresse du mandant.`,
    },
    {
      heading: "6. Facturation — TVA — paiement",
      body: `6.1 — Montants
Sauf mention contraire, les montants de rémunération indiqués dans l'espace partenaire ou les échanges commerciaux sont exprimés en euros, hors taxes (HT) si le Partenaire est assujetti à la TVA, ou toutes taxes comprises (TTC) s'il n'est pas assujetti.

6.2 — TVA
Si le Partenaire est assujetti à la TVA, il adresse à ${CLUB} une facture conforme (mentions légales obligatoires, numéro de TVA intracommunautaire, période, description de la prestation : « apport d'affaires assurance emprunteur »). La TVA au taux en vigueur s'ajoute aux montants HT convenus.
Si le Partenaire n'est pas assujetti à la TVA, il le déclare expressément et certifie ne pas être redevable de la TVA sur les rémunérations perçues au titre du présent Contrat, sous sa responsabilité.

6.3 — Modalités de paiement
Le paiement intervient par virement bancaire, dans un délai raisonnable après encaissement effectif de la commission assureur par la Société, sur présentation d'une facture ou d'un relevé de commissions accepté par le Partenaire selon les usages de ${CLUB}.

6.4 — Retenues
La Société pourra procéder à des retenues ou compensations en cas de trop-perçu, d'annulation de dossier ou de non-respect avéré du présent Contrat, après information du Partenaire.`,
    },
    {
      heading: "7. Propriété intellectuelle — marque",
      body: `Les marques, logos, noms commerciaux, supports de communication et contenus fournis par ${CLUB} restent la propriété exclusive de la Société ou de ses concédants.

Le Partenaire reçoit une licence non exclusive, non transférable et révocable, limitée à la durée du Contrat, pour utiliser les supports officiels dans le cadre strict de sa mission. Toute utilisation détournée, modification non autorisée ou atteinte à l'image de ${CLUB} est interdite.`,
    },
    {
      heading: "8. Confidentialité",
      body: `Chaque partie s'engage à conserver strictement confidentielles les informations non publiques échangées dans le cadre du Contrat (données clients, barèmes internes, processus, outils, stratégie commerciale).

Cette obligation subsiste cinq (5) ans après la cessation du Contrat. Sont exclues les informations devenues publiques sans violation du Contrat, ou dont la divulgation est imposée par la loi ou une autorité judiciaire.`,
    },
    {
      heading: "9. Protection des données personnelles (RGPD)",
      body: `9.1 — Rôles respectifs
Dans le cadre de la seule transmission de contacts, le Partenaire agit en qualité de responsable de traitement pour les données qu'il collecte auprès de ses contacts (base légale : intérêt légitime ou consentement selon le mode de prospection). ${CLUB} agit en qualité de responsable de traitement distinct pour les dossiers ouverts et instruits via ses propres outils.

9.2 — Obligations du Partenaire
Le Partenaire s'engage à :
— informer les contacts de l'existence d'un transfert de leurs coordonnées à ${CLUB} pour une prise de contact relative à l'assurance emprunteur ;
— ne transmettre que des données adéquates, pertinentes et limitées au strict nécessaire ;
— respecter les droits des personnes (accès, rectification, opposition, effacement) en orientant toute demande vers ${LCIF_LEGAL.contactEmail} ou, pour les dossiers ouverts, vers assurance@leclubimmobilier.fr ;
— ne pas utiliser les données à d'autres fins que la recommandation autorisée.

9.3 — Traitements par la Société
${CLUB} traite les données conformément au règlement (UE) 2016/679 (RGPD) et à la loi n° 78-17 du 6 janvier 1978 modifiée. Les finalités principales sont : gestion des dossiers d'assurance emprunteur, relation client, facturation des rémunérations, respect des obligations ORIAS et LCB-FT.

9.4 — Référent et contact
Référent données personnelles : ${LCIF_LEGAL.dataProtectionContact}, ${LCIF_LEGAL.dataProtectionContactRole}.
Contact : ${LCIF_LEGAL.contactEmail}.

9.5 — Sous-traitance et transferts
Le Partenaire n'est pas autorisé à sous-traiter le traitement des données au nom de ${CLUB} sans accord écrit préalable. Les données sont hébergées et traitées principalement dans l'Union européenne.`,
    },
    {
      heading: "10. Assurance — responsabilité",
      body: `10.1 — Assurance du Partenaire
Le Partenaire déclare être conscient que son activité professionnelle peut engager sa responsabilité civile. Il s'engage à souscrire et maintenir une assurance responsabilité civile professionnelle couvrant les conséquences pécuniaires de sa responsabilité, et à en justifier sur demande.

10.2 — Limitation de responsabilité de la Société
${CLUB} ne saurait être tenue responsable des engagements pris par le Partenaire en dehors de ses attributions, ni des conséquences d'une prospection non conforme. La responsabilité de la Société, toutes causes confondues, est limitée au montant total des rémunérations versées au Partenaire au cours des douze (12) mois précédant le fait générateur, sauf faute lourde ou dolosive.

10.3 — Indemnisation
Le Partenaire garantit ${CLUB} contre toute réclamation, action ou condamnation résultant d'un manquement du Partenaire au présent Contrat, d'une fausse déclaration ou d'une atteinte aux droits des tiers.`,
    },
    {
      heading: "11. Lutte contre le blanchiment et la corruption",
      body: `Le Partenaire déclare ne pas être dans une situation d'interdiction d'exercer une activité commerciale, ne pas figurer sur les listes de sanctions internationales, et s'engage à ne pas recourir à des pratiques de corruption ou de trafic d'influence dans le cadre de sa mission.

Il communique sans délai à ${CLUB} tout élément susceptible de caractériser un dossier ou un comportement anormal.`,
    },
    {
      heading: `12. ${APPORTEUR_CONTRACT_MLM_CLAUSE.title}`,
      body: `${APPORTEUR_CONTRACT_MLM_CLAUSE.summary}\n\n${APPORTEUR_CONTRACT_MLM_CLAUSE.articles
        .map((a) => `${a.heading}\n${a.body}`)
        .join("\n\n")}`,
    },
    {
      heading: "13. Durée — résiliation",
      body: `13.1 — Durée
Le Contrat est conclu pour une durée indéterminée à compter de sa signature électronique.

13.2 — Résiliation
Chaque partie peut résilier le Contrat à tout moment, sans indemnité, par notification écrite adressée par courrier électronique avec accusé de réception ou par tout moyen permettant d'en attester la réception, moyennant un préavis de quinze (15) jours calendaires.

13.3 — Résiliation pour manquement
En cas de manquement grave non réparé dans un délai de quinze (15) jours suivant mise en demeure, l'autre partie pourra résilier de plein droit le Contrat, sans préjudice de dommages-intérêts.

13.4 — Effets
Les rémunérations dues au titre des dossiers signés et conformes avant la date de prise d'effet de la résiliation restent exigibles selon les conditions de l'article 5. L'accès à l'espace partenaire pourra être clos à l'issue de la résiliation.`,
    },
    {
      heading: "14. Force majeure",
      body: `Aucune partie ne sera responsable d'un retard ou d'un manquement dû à un événement de force majeure au sens de l'article 1218 du Code civil, dûment notifié à l'autre partie. Si l'événement se prolonge au-delà de soixante (60) jours, chaque partie pourra résilier le Contrat de plein droit.`,
    },
    {
      heading: "15. Médiation — réclamations",
      body: `Pour toute réclamation relative au présent Contrat ou à une rémunération, le Partenaire peut contacter ${CLUB} à l'adresse ${LCIF_LEGAL.contactEmail}.

À défaut de réponse satisfaisante, le Partenaire consommateur ou professionnel peut saisir le médiateur compétent :
— Médiation de l'assurance : ${LCIF_LEGAL.mediationInsurance.website} — ${LCIF_LEGAL.mediationInsurance.postal}
— Médiateur de la consommation : ${LCIF_LEGAL.mediationConsumption.name}, ${LCIF_LEGAL.mediationConsumption.address}, RCS ${LCIF_LEGAL.mediationConsumption.rcs}.

Autorité de contrôle : ${LCIF_LEGAL.acpr}.`,
    },
    {
      heading: "16. Droit applicable — langue — preuve",
      body: `Le Contrat est soumis au droit français. En cas de traduction, la version française prévaut.

Les parties reconnaissent la valeur probante des enregistrements électroniques conservés par ${CLUB} (horodatage, identité du signataire, adresse IP, version du Contrat).

En cas de litige et à défaut de résolution amiable, compétence expresse est attribuée aux tribunaux du ressort du siège social de ${CLUB}, sous réserve des règles d'ordre public applicables au Partenaire non commerçant.`,
    },
    {
      heading: "17. Acceptation électronique — double signature",
      body: `Le présent Contrat n'est valablement conclu qu'après signature par les deux parties :

17.1 — Signature du Partenaire
En cochant la case d'acceptation, en validant son nom complet et en confirmant un code à usage unique envoyé à l'adresse email déclarée, le Partenaire reconnaît :
— avoir lu l'intégralité du présent Contrat dans sa version ${APPORTEUR_CONTRACT_VERSION} ;
— en accepter les termes sans réserve ;
— disposer de la capacité juridique et, le cas échéant, des pouvoirs nécessaires pour engager la personne morale qu'il représente ;
— consentir à la signature électronique simple et à la conservation des éléments de preuve par ${CLUB}.

17.2 — Contre-signature du mandant
${CLUB}, représentée par ${LCIF_LEGAL.legalRepresentative}, en qualité de ${LCIF_LEGAL.legalRepresentativeTitle}, apposera sa contre-signature électronique simultanément à la validation du Partenaire, attestant l'engagement réciproque des parties.

17.3 — Remise d'exemplaire
Une copie PDF du Contrat signé par les deux parties est remise au Partenaire par voie électronique et archivée par la Société.`,
    },
  ];

  return {
    version: APPORTEUR_CONTRACT_VERSION,
    title: `Contrat d'apporteur d'affaires — ${CLUB}`,
    preamble: `Partenaire : ${typeLabel} · ${contactName}${apporteur.companyName ? ` · ${apporteur.companyName}` : ""} · Version ${APPORTEUR_CONTRACT_VERSION}.`,
    sections,
    acceptanceLabel: `Je certifie avoir lu l'intégralité du contrat d'apporteur d'affaires de ${CLUB}, en accepter tous les termes sans réserve, et disposer de la capacité juridique pour m'y engager en qualité de Partenaire indépendant.`,
  };
}
