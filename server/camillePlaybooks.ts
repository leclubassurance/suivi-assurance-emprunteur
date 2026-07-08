import fs from "fs";
import path from "path";
import { CAMILLE_META_DOSSIER_ID as META_DOSSIER_ID } from "../shared/camilleMeta";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";

export type CamillePlaybook = {
  id: string;
  tags: string[];
  /** Résumé de la situation (question Camille à l'équipe). */
  situationSummary: string;
  /** Consigne équipe validée. */
  staffGuidance: string;
  /** Extrait anonymisé du mail client. */
  clientMessagePattern: string;
  /** Réponse client approuvée (texte brut). */
  approvedReplyPlain: string;
  approvedAt: string;
  approvedBy?: string;
  dossierId?: string;
  useCount: number;
  lastUsedAt?: string;
};

type PlaybookStore = {
  version: 1;
  playbooks: CamillePlaybook[];
  updatedAt: string;
  seededAt?: string;
  seedVersion?: string;
};

const MAX_PLAYBOOKS = 500;
const MAX_PROMPT_PLAYBOOKS = 5;
const STORE_CACHE_MS = 15_000;

let cachedStore: PlaybookStore | null = null;
let cachedAt = 0;

const PLAYBOOK_SEED_VERSION = "2026-07-08-client-v6";

const DEFAULT_SEED_PLAYBOOKS: Array<Omit<CamillePlaybook, "id" | "approvedAt" | "useCount">> = [
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client demande quels documents envoyer pour l'étude.",
    staffGuidance:
      "Offre de prêt + tableau d'amortissement complets en PDF depuis l'espace banque. Pas de CNI/RIB à ce stade.",
    clientMessagePattern: "quels documents envoyer offre pret tableau amortissement pieces",
    approvedReplyPlain:
      "Pour l'étude, nous avons besoin de deux documents en PDF depuis votre espace bancaire :\n\n• l'offre de prêt (ou convention de prêt) complète ;\n• le tableau d'amortissement complet.\n\nSi vous ne les avez pas encore sous la main, vous pouvez les récupérer sur votre espace client banque ou les demander à votre conseiller.",
  },
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client dit avoir déjà envoyé les documents ou les pièces.",
    staffGuidance:
      "Accuser réception, confirmer analyse en cours si fichiers exploitables. Ne pas redemander offre/tableau si déjà présents.",
    clientMessagePattern: "deja envoye transmis pieces documents recu joint offre tableau",
    approvedReplyPlain:
      "Merci pour votre message.\n\nNous avons bien pris en compte votre envoi et nous vérifions que l'offre de prêt et le tableau d'amortissement sont complets et exploitables pour l'étude.\n\nCharles prépare votre analyse ; nous revenons vers vous par email dès que l'étude personnalisée est prête.\n\nSi un document manque ou est illisible, nous vous le signalerons clairement.",
  },
  {
    tags: ["pre-etude", "sante-client", "question-client"],
    situationSummary: "Client apporte une précision santé (tabac, etc.) après le formulaire.",
    staffGuidance:
      "Accuser réception. Charles en tiendra compte pour l'étude. Ne pas redemander documents ni formulaire.",
    clientMessagePattern: "oublie indiqu fume fumeur tabac cigarette precision sante medical",
    approvedReplyPlain:
      "Merci pour cette précision, c'est bien noté.\n\nCharles en tiendra compte lors de l'analyse de votre dossier et de la préparation de votre étude personnalisée.\n\nSi vous avez d'autres éléments à nous communiquer sur votre situation, répondez simplement à ce mail.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande si l'étude est gratuite ou s'il y a des frais.",
    staffGuidance: "Confirmer gratuité et sans engagement. Pas de chiffre d'économie.",
    clientMessagePattern: "gratuit gratuitement frais cout combien payer engagement",
    approvedReplyPlain:
      "L'étude d'économie sur votre assurance emprunteur est entièrement gratuite et sans engagement.\n\nElle permet à Charles de comparer votre contrat actuel à des alternatives équivalentes. Vous décidez librement ensuite de poursuivre ou non.",
  },
  {
    tags: ["pre-etude", "changement-assurance", "question-client"],
    situationSummary: "Client pose une question sur la Loi Lemoine ou le changement d'assurance.",
    staffGuidance: "Expliquer le principe Lemoine sans éligibilité personnalisée. Pas de chiffres.",
    clientMessagePattern: "loi lemoine changer assurance substitution resilier banque deleguer",
    approvedReplyPlain:
      "La Loi Lemoine permet en principe de changer d'assurance emprunteur à tout moment, avec une équivalence de garanties et sans nouveau questionnaire médical dans la plupart des cas.\n\nChaque situation est unique : Charles vérifie votre contrat et votre offre de prêt lors de l'étude gratuite, puis vous présente les options adaptées.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande comment fonctionne l'étude ou les prochaines étapes.",
    staffGuidance: "Parcours : documents → analyse Charles → étude par email. Pas de délai ferme.",
    clientMessagePattern: "comment ca marche etapes procedure fonctionnement demarche suite",
    approvedReplyPlain:
      "Voici comment cela se déroule :\n\n1. Nous analysons votre offre de prêt et votre tableau d'amortissement.\n2. Charles compare votre contrat actuel aux alternatives équivalentes.\n3. Vous recevez une étude personnalisée par email avec les économies possibles.\n\nL'étude est gratuite et sans engagement. Si les économies vous conviennent, nous vous accompagnons pour la substitution auprès de votre banque.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande le délai pour recevoir l'étude.",
    staffGuidance: "Pas de délai garanti. Dossier en cours d'analyse.",
    clientMessagePattern: "delai combien temps quand etude recevoir attente",
    approvedReplyPlain:
      "Merci pour votre patience.\n\nDès que vos documents sont complets et exploitables, Charles prépare votre étude personnalisée. Le délai dépend du volume de dossiers en cours ; nous vous tenons informé par email.\n\nSi un document manque ou doit être complété, nous vous le signalons sans attendre.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande qui est Camille ou Charles.",
    staffGuidance: "Camille = suivi email. Charles = conseiller étude. Ton humain, transparent.",
    clientMessagePattern: "qui etes vous camille charles conseiller humain robot",
    approvedReplyPlain:
      "Je suis Camille, assistante de Charles au Club Immobilier Français : je assure le suivi de votre dossier par email au quotidien.\n\nCharles Victor est le conseiller qui analyse votre contrat et prépare l'étude personnalisée d'économies sur votre assurance emprunteur.\n\nN'hésitez pas à nous écrire ici pour toute question sur votre dossier.",
  },
  {
    tags: ["post-etude", "remerciement"],
    situationSummary: "Client remercie après réception de l'étude.",
    staffGuidance: "Accuser réception chaleureusement. Proposer de répondre aux questions ou poursuivre.",
    clientMessagePattern: "merci bien recu etude message recu",
    approvedReplyPlain:
      "Je vous en prie, c'est avec plaisir.\n\nN'hésitez pas si vous avez des questions sur l'étude ou si vous souhaitez que nous poursuivions la démarche de changement d'assurance.",
  },
  {
    tags: ["post-etude", "question-client", "etude"],
    situationSummary: "Client confirme avoir bien reçu l'étude ou demande si on a des nouvelles.",
    staffGuidance: "Accuser réception. Inviter à poser questions ou confirmer accord pour substitution.",
    clientMessagePattern: "bien recu etude consulte lu parcouru nouvelles",
    approvedReplyPlain:
      "Merci pour votre retour.\n\nSi vous avez pu consulter l'étude, nous restons à votre disposition pour répondre à vos questions.\n\nLorsque vous souhaitez activer le changement d'assurance, répondez simplement à ce mail pour nous le confirmer : nous vous indiquerons alors les prochaines étapes.",
  },
  {
    tags: ["post-etude", "changement-assurance", "question-client"],
    situationSummary: "Client demande comment se passe la substitution après l'étude.",
    staffGuidance: "Expliquer les grandes étapes sans promettre de date. Pas de nom d'assureur.",
    clientMessagePattern: "substitution changement activer demarche banque etapes suite",
    approvedReplyPlain:
      "Si vous souhaitez poursuivre après l'étude, voici le principe :\n\n1. Vous nous confirmez par email que vous êtes d'accord pour avancer.\n2. Nous vous guidons pour la mise en place du nouveau contrat et les démarches auprès de votre banque.\n3. Nous restons disponibles par email à chaque étape.\n\nRépondez à ce mail lorsque vous êtes prêt(e) : nous adaptons la suite à votre situation.",
  },
  {
    tags: ["post-etude", "accord-client", "changement-assurance"],
    situationSummary: "Client donne son accord pour poursuivre le changement d'assurance.",
    staffGuidance: "Accuser accord. Prochaine étape : pièces identité si besoin, sans nom assureur.",
    clientMessagePattern: "accord d accord ok poursuivre valider accepter changement",
    approvedReplyPlain:
      "Merci pour votre confirmation, c'est bien noté.\n\nNous poursuivons la mise en place de votre dossier et nous revenons vers vous par email pour les prochaines étapes (documents complémentaires éventuels, formalités auprès de la banque).\n\nPour toute précision, répondez simplement à ce fil.",
  },
  {
    tags: ["post-etude", "identite", "accord-client"],
    situationSummary: "Client envoie ou demande quoi faire pour CNI et RIB après accord.",
    staffGuidance: "Accuser réception pièces identité. Pas de nom assureur.",
    clientMessagePattern: "cni rib identite iban passeport releve",
    approvedReplyPlain:
      "Merci pour votre message.\n\nSi vous nous transmettez votre pièce d'identité et votre RIB, nous les enregistrons pour la suite de votre dossier. Charles et notre équipe poursuivent la mise en place et vous recontactent par email pour la prochaine étape.\n\nPour toute question, répondez à ce mail.",
  },
  {
    tags: ["post-etude", "question-client", "kereis"],
    situationSummary: "Client a une question sur l'espace adhérent Kereis ou Docaposte.",
    staffGuidance: "Rassurer, renvoyer vers doc Drive espace adhérent. Pas de mot de passe par mail.",
    clientMessagePattern: "kereis adherent espace docaposte signature parcours etape",
    approvedReplyPlain:
      "Merci pour votre message.\n\nPour l'espace adhérent, suivez les étapes indiquées dans notre précédent email (parcours en plusieurs étapes, signature électronique si demandée).\n\nSi un message d'erreur s'affiche, décrivez-le en répondant à ce mail (capture d'écran utile) : nous vous guidons pas à pas.\n\nNe communiquez jamais de mot de passe par email.",
  },
  {
    tags: ["pre-etude", "remerciement"],
    situationSummary: "Client remercie ou accuse réception avant envoi de l'étude.",
    staffGuidance: "Réponse courte et chaleureuse. Rappeler que l'étude suivra.",
    clientMessagePattern: "merci bien recu message pris en compte",
    approvedReplyPlain:
      "Je vous en prie.\n\nVotre dossier est bien pris en charge : nous revenons vers vous par email dès que l'étude personnalisée est prête ou si nous avons besoin d'une précision sur vos documents.",
  },
  {
    tags: ["question-client"],
    situationSummary: "Client refuse poliment ou souhaite ne plus être contacté.",
    staffGuidance: "Respecter le choix sans insister. Clôturer poliment.",
    clientMessagePattern: "refus pas interesse stop ne plus contacter desistement",
    approvedReplyPlain:
      "Bien reçu, nous respectons tout à fait votre choix.\n\nNous clôturons le suivi de ce dossier côté assurance emprunteur. Si vous changez d'avis plus tard, vous pouvez nous réécrire à tout moment.\n\nJe vous souhaite une excellente continuation.",
  },
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client demande où trouver l'offre de prêt ou le tableau en banque.",
    staffGuidance:
      "Guider vers espace client banque : Crédit / Prêt → Documents ou Échéancier. PDF complets. Pas de CNI/RIB.",
    clientMessagePattern: "ou trouver recuperer telecharger espace banque client credit pret echeancier",
    approvedReplyPlain:
      "Voici où les trouver le plus souvent dans votre espace client bancaire :\n\n• rubrique « Crédit » ou « Prêt immobilier » → « Documents » ou « Offre de prêt » ;\n• « Tableau d'amortissement » ou « Échéancier » (document complet sur toute la durée).\n\nExportez-les en PDF si possible. Si vous ne les voyez pas, votre conseiller bancaire peut vous les transmettre par email.\n\nDéposez ensuite les PDF dans le formulaire en ligne ; répondez à ce mail si vous bloquez sur une étape.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande pourquoi le Club Immobilier Français fait de l'assurance.",
    staffGuidance: "Présentation LCIF courte : réseau immo + accompagnement après achat. Pas de discours commercial.",
    clientMessagePattern: "agence immobilier immo pourquoi assurance club qui etes vous",
    approvedReplyPlain:
      "Le Club Immobilier Français est un réseau de mandataires immobiliers. Nous proposons aussi l'assurance emprunteur pour continuer à vous accompagner après votre projet immobilier, avec un suivi personnalisé par email.\n\nCharles analyse votre contrat actuel et prépare une étude gratuite des économies possibles, sans engagement de votre part.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande comment fonctionnent les économies (sans montant précis).",
    staffGuidance:
      "Expliquer le principe : comparer coût assurance actuelle vs alternative équivalente. Pas de chiffre ni promesse.",
    clientMessagePattern: "comment gagner economiser economie fonctionne comprends pas principe",
    approvedReplyPlain:
      "L'idée est simple : nous comparons le coût de votre assurance emprunteur actuelle avec des alternatives aux garanties équivalentes.\n\nCharles s'appuie sur votre offre de prêt et votre tableau d'amortissement pour chiffrer l'économie possible sur la durée restante — c'est l'objet de l'étude gratuite que vous recevrez par email.\n\nVous restez libre de poursuivre ou non ensuite.",
  },
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client signale un document erroné, illisible ou mauvaise offre de prêt.",
    staffGuidance:
      "Accuser réception. Charles vérifie. Demander la bonne pièce sans dire « document illisible ». Pas de formulaire si déjà déposé.",
    clientMessagePattern: "mauvais document erreur pas bon mauvaise offre confus illisible incorrect",
    approvedReplyPlain:
      "Merci pour votre message, c'est bien noté.\n\nNous vérifions la pièce reçue et nous revenons vers vous par email si nous avons besoin de l'offre de prêt complète et/ou du tableau d'amortissement complet en PDF (depuis votre espace bancaire).\n\nSi vous avez la bonne version sous la main, vous pouvez la redéposer via le formulaire en ligne ou répondre à ce mail.",
  },
  {
    tags: ["pre-etude", "post-etude", "question-client", "etude"],
    situationSummary: "Client n'a pas reçu l'étude ou demande des nouvelles.",
    staffGuidance: "Vérifier phase dossier. Rassurer, pas de date ferme. Ne pas inventer de montant.",
    clientMessagePattern: "pas recu etude nouvelles relance attente toujours rien",
    approvedReplyPlain:
      "Merci pour votre patience.\n\nVotre dossier est bien suivi : dès que l'analyse est finalisée, Charles vous transmet l'étude personnalisée par email.\n\nSi vous pensez ne pas l'avoir reçue, vérifiez vos courriers indésirables et répondez à ce mail pour que nous contrôlions côté envoi.",
  },
  {
    tags: ["pre-etude", "remerciement"],
    situationSummary: "Client confirme avoir déposé le formulaire ou que le dossier est pris en charge.",
    staffGuidance: "Accuser réception formulaire. Étude suivra. Pas de redemande de pièces si déjà déposées.",
    clientMessagePattern: "formulaire depose envoye dossier pris charge validation",
    approvedReplyPlain:
      "Merci, votre dossier est bien enregistré.\n\nCharles et notre équipe analysent vos éléments et nous revenons vers vous par email dès que l'étude personnalisée est prête, ou si nous avons besoin d'une précision sur vos documents de prêt.",
  },
  {
    tags: ["pre-etude", "post-etude", "question-client"],
    situationSummary: "Client demande à être rappelé ou un numéro de téléphone.",
    staffGuidance: "Suivi par email uniquement. Inviter à poser la question par mail.",
    clientMessagePattern: "telephone appeler rappeler numero joindre appel",
    approvedReplyPlain:
      "Nous assurons le suivi de votre dossier par email afin de vous répondre avec précision et de conserver une trace écrite.\n\nÉcrivez-nous votre question en répondant à ce mail : nous vous répondons rapidement. Merci pour votre compréhension.",
  },
  {
    tags: ["post-etude", "question-client", "etude"],
    situationSummary: "Client pose une question générale sur le contenu de l'étude (sans montant).",
    staffGuidance: "Inviter à préciser la question. Pas de chiffre inventé. Charles pour points complexes.",
    clientMessagePattern: "question etude comprends pas garantie explication detail contenu",
    approvedReplyPlain:
      "Merci pour votre message.\n\nIndiquez-nous précisément le point de l'étude que vous souhaitez éclaircir (garanties, démarche, prochaine étape) en répondant à ce mail : nous vous répondons point par point.\n\nPour toute question technique sur les montants ou les garanties, Charles intervient si nécessaire.",
  },
  // ——— Pré-étude : pédagogie assurance ———
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande ce qu'est l'assurance emprunteur.",
    staffGuidance: "Définition simple : décès, invalidité, lien avec le prêt. Pas de vente agressive.",
    clientMessagePattern: "assurance emprunteur cest quoi definition role garantie pret immobilier",
    approvedReplyPlain:
      "L'assurance emprunteur est l'assurance liée à votre prêt immobilier : elle couvre en général le décès, l'invalidité et l'incapacité de rembourser selon les garanties souscrites.\n\nLa banque l'exige pour le financement, mais vous pouvez souvent choisir un contrat en délégation — c'est ce que Charles analyse dans votre étude gratuite.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande si l'assurance emprunteur est obligatoire.",
    staffGuidance: "Oui exigée par la banque, non obligatoire de prendre celle de la banque.",
    clientMessagePattern: "obligatoire force impose banque necessaire devoir souscrire",
    approvedReplyPlain:
      "Pour un prêt immobilier, la banque exige en principe une assurance couvrant le risque décès-invalidité sur le capital restant dû.\n\nEn revanche, vous n'êtes pas obligé de prendre celle proposée par la banque : la délégation d'assurance est un droit. Charles vérifie votre situation dans l'étude personnalisée.",
  },
  {
    tags: ["pre-etude", "changement-assurance", "question-client"],
    situationSummary: "Client demande la différence délégation vs assurance groupe banque.",
    staffGuidance: "Expliquer groupe banque vs contrat externe équivalent. Pas de nom assureur.",
    clientMessagePattern: "delegation assurance groupe banque difference externe contrat banque",
    approvedReplyPlain:
      "L'assurance « groupe » est celle proposée par votre banque avec le prêt.\n\nLa délégation consiste à souscrire ailleurs une assurance aux garanties équivalentes — souvent avec un coût différent sur la durée restante. Charles compare les deux dans votre étude gratuite, sans engagement de votre part.",
  },
  {
    tags: ["pre-etude", "changement-assurance", "question-client"],
    situationSummary: "Client demande s'il peut changer d'assurance en cours de prêt.",
    staffGuidance: "Oui à certaines dates (anniversaire, fin fixation taux, Bourquin). Charles précise dans l'étude.",
    clientMessagePattern: "changer cours pret deja signe anniversaire contrat bourquin resilier",
    approvedReplyPlain:
      "Oui, il est en principe possible de changer d'assurance emprunteur en cours de prêt, à des dates prévues par la réglementation (anniversaire du contrat, fin de période de fixation du taux, etc.).\n\nCharles vérifie votre contrat et votre offre de prêt lors de l'étude pour vous indiquer ce qui s'applique à votre situation.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande s'il y a des frais de courtage.",
    staffGuidance: "Étude gratuite. Frais éventuels détaillés dans l'étude Charles. Pas de montant inventé.",
    clientMessagePattern: "frais courtage commission honoraires coute cher payer service",
    approvedReplyPlain:
      "L'étude d'économie sur votre assurance emprunteur est gratuite et sans engagement.\n\nSi vous décidez de poursuivre, les éventuels frais de dossier ou de courtage sont présentés clairement dans l'étude de Charles — vous pouvez les comparer aux économies possibles avant de vous décider.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande la différence avec un comparateur en ligne.",
    staffGuidance: "Expertise + suivi email + analyse sur vrais documents prêt. Pas dénigrer comparateurs.",
    clientMessagePattern: "comparateur internet en ligne difference pourquoi vous plutot",
    approvedReplyPlain:
      "Un comparateur en ligne donne des ordres de grandeur ; nous combinons l'expertise courtage et un suivi personnalisé par email, avec une analyse sur vos documents réels de prêt (offre et tableau d'amortissement).\n\nCharles vérifie l'équivalence des garanties avec votre banque — c'est l'objet de l'étude gratuite.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande pourquoi on le contacte après signature chez le notaire.",
    staffGuidance: "Continuité accompagnement Club après projet immo. Aucune obligation.",
    clientMessagePattern: "notaire signe achat immobilier pourquoi contactez apres projet",
    approvedReplyPlain:
      "C'est la continuité d'accompagnement du Club Immobilier Français après votre projet immobilier : beaucoup de clients optimisent encore leur assurance de prêt une fois le crédit en place.\n\nL'étude est gratuite et sans obligation de changer — vous décidez librement ensuite.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande si ses données sont confidentielles (RGPD).",
    staffGuidance: "Usage strict étude assurance, stockage sécurisé, pas de revente.",
    clientMessagePattern: "donnees confidentiel rgpd securite prive confidentialite protege",
    approvedReplyPlain:
      "Vos documents et informations servent uniquement à l'étude et au suivi de votre dossier assurance emprunteur au Club Immobilier Français.\n\nIls sont conservés de façon sécurisée et ne sont pas revendus. Pour toute précision sur vos droits, répondez à ce mail.",
  },
  {
    tags: ["pre-etude", "sante-client", "question-client"],
    situationSummary: "Client demande si un questionnaire santé sera nécessaire (question générale).",
    staffGuidance: "Dépend profil et loi. Charles indique dans l'étude. Camille ne diagnostique pas.",
    clientMessagePattern: "questionnaire sante medical necessaire obligatoire formalites",
    approvedReplyPlain:
      "Un questionnaire de santé peut être requis selon votre profil, le capital assuré et le type de changement envisagé.\n\nCharles vous indique ce qui s'applique à votre situation dans l'étude personnalisée — je ne peux pas le confirmer à votre place avant cette analyse.",
  },
  // ——— Pré-étude : documents & formulaire ———
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client demande pourquoi PDF banque plutôt qu'une photo ou capture.",
    staffGuidance: "PDF = pages complètes, lecture fiable. Guider sans dire document refusé.",
    clientMessagePattern: "photo capture ecran image pdf pourquoi pas photographier",
    approvedReplyPlain:
      "Les PDF téléchargés depuis votre espace client bancaire contiennent en général toutes les pages et permettent une analyse fiable (montants, durée, garanties).\n\nUne photo ou capture d'écran peut être incomplète. Si vous avez un doute, privilégiez l'export PDF depuis votre banque ou demandez les documents à votre conseiller.",
  },
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client envoie des pièces jointes par email au lieu du formulaire.",
    staffGuidance: "Recommander formulaire pour centralisation. Accuser réception si PJ reçue.",
    clientMessagePattern: "piece jointe email mail envoye pdf attache directement",
    approvedReplyPlain:
      "Merci pour votre envoi.\n\nPour un suivi optimal, nous vous recommandons de déposer les PDF (offre de prêt et tableau d'amortissement) via le formulaire en ligne lorsque c'est possible.\n\nSi vous nous avez transmis des fichiers par email, nous les prenons en compte et nous revenons vers vous si un document doit être complété.",
  },
  {
    tags: ["pre-etude", "identite", "question-client"],
    situationSummary: "Client demande pourquoi on ne demande pas encore CNI ou RIB.",
    staffGuidance: "CNI/RIB uniquement après accord changement assurance. Avant : offre + tableau.",
    clientMessagePattern: "cni rib identite iban pourquoi pas encore quand demanderez",
    approvedReplyPlain:
      "À ce stade, nous avons surtout besoin de l'offre de prêt et du tableau d'amortissement pour préparer votre étude gratuite.\n\nLa pièce d'identité et le RIB ne sont demandés qu'après votre accord explicite pour activer le changement d'assurance, lors de la finalisation du dossier.",
  },
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client demande le lien du formulaire ou comment accéder au dépôt.",
    staffGuidance: "Renvoyer vers formulaire en ligne du fil initial si possible. Pas inventer URL.",
    clientMessagePattern: "lien formulaire acces deposer comment remplir page internet",
    approvedReplyPlain:
      "Vous pouvez déposer vos documents via le formulaire en ligne du Club Immobilier Français (lien reçu dans nos emails précédents ou sur notre site assurance emprunteur).\n\nSi vous ne retrouvez plus le lien, répondez à ce mail : nous vous le renverrons.",
  },
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client dit ne pas avoir reçu la confirmation après le formulaire.",
    staffGuidance: "Vérifier spams. Confirmer prise en charge si formulaire bien reçu côté dossier.",
    clientMessagePattern: "pas recu confirmation mail charles accuse reception formulaire",
    approvedReplyPlain:
      "Merci pour votre message.\n\nSi vous avez bien validé le formulaire, un email de confirmation vous est normalement envoyé sous peu — pensez à vérifier vos courriers indésirables.\n\nVotre dossier est pris en charge : nous revenons vers vous par email dès que l'analyse avance ou si nous avons besoin d'une précision.",
  },
  {
    tags: ["pre-etude", "post-etude", "documents-pret", "question-client"],
    situationSummary: "Client a oublié un document ou demande comment l'ajouter / l'envoyer.",
    staffGuidance:
      "Répondre par mail avec PJ. PDF banque pour offre/tableau. CNI/RIB seulement si accord client. Pas d'intervention équipe.",
    clientMessagePattern:
      "oublie document piece manquante comment ajouter envoyer deposer transmettre renvoyer pj",
    approvedReplyPlain:
      "Merci pour votre message.\n\nPas de souci : vous pouvez compléter votre dossier en répondant directement à ce mail en joignant le ou les document(s) manquant(s) en pièce jointe.\n\nPour l'offre de prêt et le tableau d'amortissement, privilégiez les PDF complets téléchargés depuis votre espace bancaire.\n\nSi vous ne retrouvez plus le lien du formulaire en ligne, un simple retour de mail avec les pièces jointes suffit.\n\nIndiquez-nous si vous avez une difficulté à récupérer un document en particulier : nous vous indiquerons comment faire.",
  },
  {
    tags: ["pre-etude", "remerciement"],
    situationSummary: "Client envoie un simple accusé ou « bonjour » / « ok ».",
    staffGuidance: "Réponse courte bienveillante. Rappeler prochaine étape si pré-étude.",
    clientMessagePattern: "bonjour ok daccord parfait entendu",
    approvedReplyPlain:
      "Bonjour,\n\nMerci pour votre message. Votre dossier est bien suivi : nous revenons vers vous par email dès que nous avons une nouveauté ou si nous avons besoin d'une précision.\n\nN'hésitez pas à nous écrire ici pour toute question.",
  },
  // ——— Post-étude : décision & substitution ———
  {
    tags: ["post-etude", "question-client", "etude"],
    situationSummary: "Client demande ce qu'il doit faire après avoir reçu l'étude.",
    staffGuidance: "Lire l'étude. Confirmer par email si accord pour substitution. Pas lancer sans accord.",
    clientMessagePattern: "apres etude que faire maintenant prochaine etape lue consulte",
    approvedReplyPlain:
      "Après lecture de l'étude, vous pouvez simplement répondre à ce mail :\n\n• si vous souhaitez poursuivre le changement d'assurance, indiquez-nous votre accord ;\n• si vous avez des questions, posez-les ici — nous vous répondons.\n\nSans confirmation de votre part, nous ne lançons pas la substitution.",
  },
  {
    tags: ["post-etude", "question-client", "etude"],
    situationSummary: "Client hésite ou souhaite réfléchir avant de décider.",
    staffGuidance: "Respecter le délai. Pas d'insistance. Rester disponible.",
    clientMessagePattern: "hesite reflechir temps besoin reflechir pas presse patienter",
    approvedReplyPlain:
      "Prenez le temps qu'il vous faut pour lire l'étude et réfléchir.\n\nIl n'y a aucune urgence de notre côté : répondez à ce mail lorsque vous serez prêt(e), ou si vous souhaitez une précision avant de décider.",
  },
  {
    tags: ["post-etude", "changement-assurance", "question-client"],
    situationSummary: "Client demande combien de temps dure la substitution (sans chiffres).",
    staffGuidance: "Variable selon dossier/banque/assureur. Pas de date ferme. Indiquer étapes.",
    clientMessagePattern: "combien temps dure substitution souscription delai apres accord semaines",
    approvedReplyPlain:
      "Le délai dépend de votre dossier, des échanges avec la banque et des formalités assureur — en principe de quelques jours à quelques semaines.\n\nNous vous tenons informé par email à chaque étape. Si vous avez déjà donné votre accord, nous vous indiquons où en est la mise en place.",
  },
  {
    tags: ["post-etude", "changement-assurance", "question-client"],
    situationSummary: "Client demande si la banque doit valider le changement.",
    staffGuidance: "Oui équivalence garanties. Charles gère l'échange. Client n'a pas à relancer seul.",
    clientMessagePattern: "banque valider accepte refus deleguation equivalence garanties accord",
    approvedReplyPlain:
      "Oui, la banque vérifie que le nouveau contrat respecte l'équivalence de garanties exigée pour votre prêt.\n\nCharles et notre équipe gèrent cet échange avec la banque ; vous n'avez en principe pas à la relancer seul(e). Nous vous tenons informé par email.",
  },
  {
    tags: ["post-etude", "changement-assurance", "question-client"],
    situationSummary: "Client demande qui s'occupe de la résiliation de l'ancien contrat.",
    staffGuidance: "Accompagnement substitution. Charles guide. Pas promettre date résiliation.",
    clientMessagePattern: "resiliation resilier ancien contrat resiliie precedente assurance",
    approvedReplyPlain:
      "Lors de la substitution, nous vous accompagnons pour la mise en place du nouveau contrat et les formalités avec votre banque, y compris le basculement depuis votre assurance actuelle.\n\nLes étapes précises vous sont indiquées par email au fil du dossier — répondez à ce mail si vous souhaitez un point sur l'avancement.",
  },
  {
    tags: ["post-etude", "question-client", "etude"],
    situationSummary: "Client demande où en est son dossier / le suivi.",
    staffGuidance: "S'appuyer sur phase dossier. Une phrase claire sur l'étape. Pas inventer.",
    clientMessagePattern: "ou en est avancement statut suivi nouvelles dossier progression",
    approvedReplyPlain:
      "Merci pour votre message.\n\nVotre dossier est actif et suivi par notre équipe. Nous revenons vers vous par email dès qu'une étape est finalisée ou si nous avons besoin d'un élément de votre part.\n\nSi vous attendez un document ou un retour précis, indiquez-le en répondant à ce mail : nous vérifions immédiatement.",
  },
  {
    tags: ["post-etude", "identite", "question-client"],
    situationSummary: "Client envoie CNI/RIB avant d'avoir confirmé le changement.",
    staffGuidance: "Remercier. Rappeler qu'accord explicite nécessaire avant souscription. Enregistrer si reçu.",
    clientMessagePattern: "cni rib identite iban transmis joint voici piece",
    approvedReplyPlain:
      "Merci pour l'envoi de vos documents.\n\nPour la suite de la souscription, nous avons bien noté votre message. Si vous souhaitez activer le changement d'assurance, confirmez-le explicitement en répondant à ce mail — nous vous indiquons alors la prochaine étape.\n\nVos pièces seront utilisées uniquement pour la finalisation du dossier.",
  },
  {
    tags: ["post-etude", "question-client", "etude"],
    situationSummary: "Client pose une question générale sur les garanties (décès, invalidité).",
    staffGuidance: "Explication générale. Pas de conseil personnalisé complexe → Charles si besoin.",
    clientMessagePattern: "garantie deces invalidite incapacite couverture que couvre contrat",
    approvedReplyPlain:
      "L'assurance emprunteur couvre en général le décès, l'invalidité et parfois l'incapacité temporaire de travail, selon les garanties souscrites.\n\nCharles vérifie l'équivalence avec ce qu'exige votre banque dans votre étude. Pour une question précise sur votre contrat, décrivez-la en répondant à ce mail.",
  },
  // ——— Post-étude : Kereis & espace adhésion ———
  {
    tags: ["post-etude", "kereis", "question-client"],
    situationSummary: "Client n'a pas reçu le lien de l'espace d'adhésion.",
    staffGuidance: "Vérifier spams. Délai quelques jours ouvrés après accord. Charles finalise.",
    clientMessagePattern: "pas recu lien espace adhesion acces mail kereis invitation",
    approvedReplyPlain:
      "Merci pour votre message.\n\nSi vous avez confirmé votre accord récemment, Charles peut encore finaliser le dossier côté assureur — le lien d'accès vous est envoyé par email dès qu'il est prêt.\n\nVérifiez vos courriers indésirables et indiquez-nous la date de votre accord : nous contrôlons côté envoi.",
  },
  {
    tags: ["post-etude", "kereis", "question-client"],
    situationSummary: "Client bloque sur les CGU ou consentement santé Kereis (étape 0).",
    staffGuidance: "Deux cases à cocher obligatoires. Je valide. Pas de mot de passe par mail.",
    clientMessagePattern: "cgu consentement coche valider etape bloque kereis conditions",
    approvedReplyPlain:
      "À la première étape de l'espace en ligne, deux acceptations sont en général nécessaires (conditions générales et consentement données de santé si demandé).\n\nCochez les deux cases puis cliquez sur « Je valide » ou « Je continue ». Si l'écran ne réagit pas, décrivez ce que vous voyez (capture utile) en répondant à ce mail.",
  },
  {
    tags: ["post-etude", "kereis", "question-client"],
    situationSummary: "Client bloque sur la signature Docaposte.",
    staffGuidance: "Guidage pas à pas. Vérifier email/SMS Docaposte. Pas de mot de passe par mail.",
    clientMessagePattern: "docaposte signature electronique signer bloque code sms",
    approvedReplyPlain:
      "Pour la signature électronique, suivez les instructions à l'écran (souvent un code reçu par SMS ou email Docaposte).\n\nSi le message d'erreur persiste, indiquez-nous à quelle étape vous êtes bloqué(e) et, si possible, joignez une capture d'écran — nous vous guidons pas à pas.",
  },
  {
    tags: ["post-etude", "kereis", "question-client"],
    situationSummary: "Client ne trouve pas le mail Kereis (spam / indésirable).",
    staffGuidance: "Vérifier spams. Demander régénération lien si besoin via équipe.",
    clientMessagePattern: "spam indesirable courrier kereis introuvable mail recu",
    approvedReplyPlain:
      "Les emails de l'espace d'adhésion peuvent parfois arriver en courrier indésirable — pensez à vérifier ce dossier.\n\nSi vous ne trouvez toujours pas le message, répondez à ce mail en indiquant votre adresse email : nous vérifions côté envoi ou régénération du lien.",
  },
  {
    tags: ["post-etude", "kereis", "sante-client", "question-client"],
    situationSummary: "Client voit une majoration santé à l'étape 4 Kereis.",
    staffGuidance: "Ne pas chiffrer. Charles recalcule économie. Orienter vers réponse mail.",
    clientMessagePattern: "majoration surprime etape sante tarif augmente kereis",
    approvedReplyPlain:
      "Merci pour cette précision.\n\nUne majoration peut apparaître selon le profil et les réponses au questionnaire santé en ligne. Charles vérifie l'impact sur l'économie globale de votre dossier.\n\nDécrivez ce que vous voyez à l'écran (capture utile) en répondant à ce mail : nous vous répondons avec une explication adaptée.",
  },
  {
    tags: ["post-etude", "kereis", "question-client"],
    situationSummary: "Client demande où télécharger l'attestation après parcours Kereis.",
    staffGuidance: "Espace assuré distinct. Attestation après signature proposition. Pas promettre délai.",
    clientMessagePattern: "attestation telecharger certificat espace assure apres signature",
    approvedReplyPlain:
      "Une fois le parcours en ligne terminé et la proposition signée, l'attestation est en général disponible dans votre espace assuré (distinct de l'espace d'adhésion).\n\nSi vous ne la voyez pas, indiquez-nous où vous en êtes dans le parcours (dernière étape validée) : nous vous guidons.",
  },
  {
    tags: ["post-etude", "kereis", "question-client"],
    situationSummary: "Client demande la durée du parcours en ligne Kereis.",
    staffGuidance: "~10 minutes annoncé. Étapes 1/5 à 5/5. Rassurer.",
    clientMessagePattern: "combien temps parcours dure minutes etapes kereis long",
    approvedReplyPlain:
      "Le parcours en ligne est conçu pour prendre environ une dizaine de minutes : vérification de vos informations, signatures électroniques si demandées, puis finalisation.\n\nAvancez étape par étape ; si un écran vous semble bloqué, décrivez-le en répondant à ce mail.",
  },
  // ——— Transversal ———
  {
    tags: ["pre-etude", "post-etude", "question-client"],
    situationSummary: "Client dit ne pas avoir eu de réponse à son mail précédent.",
    staffGuidance: "Excuser délai éventuel. Confirmer prise en charge. Répondre au fond si possible.",
    clientMessagePattern: "pas reponse relance attend toujours reponse silence jamais repondu",
    approvedReplyPlain:
      "Merci pour votre relance — toutes nos excuses si notre retour a tardé.\n\nVotre message est bien pris en compte et nous vous répondons par ce mail. Pour toute question en suspens, reformulez-la ici si besoin : nous la traitons en priorité.",
  },
  {
    tags: ["pre-etude", "post-etude", "remerciement"],
    situationSummary: "Client confirme avoir compris / pas d'autre question.",
    staffGuidance: "Clôture courtoise. Rappeler disponibilité.",
    clientMessagePattern: "compris cest clair plus question rien autre parfait",
    approvedReplyPlain:
      "Parfait, merci pour votre retour.\n\nNous restons disponibles par email si une question survient par la suite. Bonne continuation.",
  },
  {
    tags: ["pre-etude", "changement-assurance", "question-client"],
    situationSummary: "Client craint que la banque refuse le changement d'assurance.",
    staffGuidance: "Rassurer sur équivalence. Charles vérifie. Cas complexe → escalade.",
    clientMessagePattern: "banque refuser peur crainte accepte deleguation bloquer",
    approvedReplyPlain:
      "La banque doit vérifier l'équivalence des garanties — c'est normal. Charles prépare le dossier en ce sens dans le cadre de l'étude et de la substitution.\n\nSi un point bloque, nous vous expliquons les options par email. N'hésitez pas à nous décrire ce que vous avez entendu de votre banque.",
  },
  {
    tags: ["post-etude", "question-client", "etude"],
    situationSummary: "Client souhaite comparer avec son assurance actuelle / banque.",
    staffGuidance: "L'étude sert à comparer. Pas de chiffre nouveau par mail. Inviter questions précises.",
    clientMessagePattern: "comparer banque actuelle contrat actuel difference assurance presente",
    approvedReplyPlain:
      "C'est précisément l'objet de l'étude que Charles vous a transmise : comparer votre contrat actuel avec une alternative aux garanties équivalentes.\n\nSi un point de comparaison n'est pas clair, indiquez-le en répondant à ce mail — nous vous l'expliquons sans engagement de votre part.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande s'il peut arrêter ou refuser de poursuivre à tout moment.",
    staffGuidance: "Oui sans insistance. Clôture polie si refus explicite.",
    clientMessagePattern: "arreter stopper interrompre desistement libre choix obligation poursuivre",
    approvedReplyPlain:
      "Vous êtes libre à tout moment : l'étude est sans engagement et vous décidez seul(e) de poursuivre ou non.\n\nSi vous souhaitez arrêter le suivi, indiquez-le simplement en répondant à ce mail — nous respectons votre choix sans insistance.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande si le dossier couvre les deux emprunteurs (couple).",
    staffGuidance: "Oui prêt commun, une étude. Si plusieurs prêts distincts → préciser.",
    clientMessagePattern: "couple conjoint deux emprunteurs pret commun dossier unique",
    approvedReplyPlain:
      "Oui, l'étude porte en principe sur le prêt commun : les emprunteurs sont couverts selon la répartition indiquée sur le contrat de prêt.\n\nVos documents (offre et tableau d'amortissement) doivent correspondre au financement analysé. Si vous avez plusieurs prêts distincts, précisez-le en répondant à ce mail.",
  },
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client demande s'il peut envoyer plusieurs prêts ou plusieurs offres.",
    staffGuidance: "Orienter vers Charles si multi-prêt complexe. Simple : une offre + tableau par prêt étudié.",
    clientMessagePattern: "plusieurs prets deux credits offre multiple pret concomitant",
    approvedReplyPlain:
      "Merci pour votre message.\n\nPour l'étude, nous analysons en principe l'offre de prêt et le tableau d'amortissement du financement concerné. Si vous avez plusieurs prêts, précisez-le en répondant à ce mail : Charles adapte l'analyse à votre situation.",
  },
  {
    tags: ["post-etude", "accord-client", "question-client"],
    situationSummary: "Client demande quand il recevra les prochaines instructions après accord.",
    staffGuidance: "Accuser accord déjà reçu. Prochaines étapes par email. Pas date ferme.",
    clientMessagePattern: "apres accord quand prochaine instruction suite mail recevrai",
    approvedReplyPlain:
      "Merci — votre accord est bien enregistré.\n\nNous revenons vers vous par email pour la suite (formalités en ligne, documents complémentaires éventuels, échanges avec la banque). Le délai dépend des étapes assureur et bancaires ; nous vous tenons informé à chaque avancée.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande si le changement d'assurance est sans frais bancaires.",
    staffGuidance: "Pas promettre. Frais éventuels banque variables. Charles détaille dans étude.",
    clientMessagePattern: "frais banque penalite cout changement sans frais taxe",
    approvedReplyPlain:
      "Les conditions de changement d'assurance (y compris d'éventuels frais côté banque) dépendent de votre contrat de prêt et de votre établissement.\n\nCharles aborde ce point dans l'étude personnalisée lorsqu'il analyse votre offre de prêt — nous ne pouvons pas le confirmer par avance sans cette analyse.",
  },
  {
    tags: ["post-etude", "remerciement", "accord-client"],
    situationSummary: "Client remercie après avoir donné son accord pour la substitution.",
    staffGuidance: "Accuser remerciement. Confirmer suite en cours.",
    clientMessagePattern: "merci accord confirme validation poursuite remercie",
    approvedReplyPlain:
      "Je vous en prie.\n\nVotre accord est bien pris en compte : nous poursuivons la mise en place et nous revenons vers vous par email pour la prochaine étape.\n\nPour toute question d'ici là, répondez simplement à ce fil.",
  },
];

function getPlaybooksFilePath() {
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) {
    return path.join("/tmp/data", "camille-playbooks.json");
  }
  return path.join(process.cwd(), "data", "camille-playbooks.json");
}

function normalizeText(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadStoreFromFile(): PlaybookStore {
  try {
    const p = getPlaybooksFilePath();
    if (!fs.existsSync(p)) {
      return { version: 1, playbooks: [], updatedAt: new Date().toISOString() };
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      version: 1,
      playbooks: Array.isArray(raw?.playbooks) ? raw.playbooks : [],
      updatedAt: raw?.updatedAt || new Date().toISOString(),
      seededAt: raw?.seededAt,
    };
  } catch {
    return { version: 1, playbooks: [], updatedAt: new Date().toISOString() };
  }
}

function saveStoreToFile(store: PlaybookStore) {
  const p = getPlaybooksFilePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
}

function invalidatePlaybookCache() {
  cachedStore = null;
  cachedAt = 0;
}

async function loadStoreFromFirestore(): Promise<PlaybookStore | null> {
  try {
    const { readDB } = await import("./db");
    const db = await readDB();
    const meta = db.dossiers.find((d: any) => d.id === META_DOSSIER_ID);
    const fromMeta = meta?.camillePlaybooksStore as PlaybookStore | undefined;
    if (fromMeta?.playbooks) return fromMeta;
  } catch {
    /* fallback */
  }
  return null;
}

async function saveStoreToFirestore(store: PlaybookStore) {
  try {
    const { readDB, writeDB } = await import("./db");
    const db = await readDB();
    let meta = db.dossiers.find((d: any) => d.id === META_DOSSIER_ID);
    if (!meta) {
      meta = {
        id: META_DOSSIER_ID,
        status: "CLOS",
        createdAt: store.updatedAt,
        updatedAt: store.updatedAt,
        formData: { assures: [{ prenom: "Camille", nom: "Playbooks", email: "internal@lcif.local" }] },
        camillePlaybooksStore: store,
      };
      db.dossiers.push(meta);
    } else {
      meta.camillePlaybooksStore = store;
      meta.updatedAt = store.updatedAt;
    }
    await writeDB(db, meta);
  } catch (e: any) {
    console.warn("[Camille playbooks] Firestore meta save:", e?.message || e);
  }
}

export async function loadPlaybookStore(): Promise<PlaybookStore> {
  if (cachedStore && Date.now() - cachedAt < STORE_CACHE_MS) return cachedStore;
  const fromFirestore = await loadStoreFromFirestore();
  const store = fromFirestore || loadStoreFromFile();
  cachedStore = store;
  cachedAt = Date.now();
  return store;
}

async function persistStore(store: PlaybookStore) {
  store.updatedAt = new Date().toISOString();
  saveStoreToFile(store);
  await saveStoreToFirestore(store);
  cachedStore = store;
  cachedAt = Date.now();
}

export function extractSituationTags(
  dossier: any,
  clientMessage: string,
  staffGuidance?: string,
): string[] {
  const tags = new Set<string>();
  const blob = normalizeText(`${clientMessage} ${staffGuidance || ""}`);

  if (hasStudyBeenSent(dossier)) tags.add("post-etude");
  else tags.add("pre-etude");

  if (clientHasAcceptedInsuranceChange(dossier)) tags.add("accord-client");
  if (/multi|monsieur|madame|second|autre pr[eê]t|co-emprunteur|conjoint/i.test(blob)) {
    tags.add("multi-contrat");
  }
  if (/\bcni\b|rib|identit|passeport|iban/i.test(blob)) tags.add("identite");
  if (/offre|tableau|amort|pdf|banque|document|pi[eè]ce/i.test(blob)) tags.add("documents-pret");
  if (/assurance|substitution|changement|activer|d.accord|lemoine/i.test(blob)) {
    tags.add("changement-assurance");
  }
  if (/[eé]conom|€|euro|tarif|co[uû]t|mensualit/i.test(blob)) tags.add("question-chiffrage");
  if (/question|savoir|inform|expliqu/i.test(blob)) tags.add("question-client");
  if (/merci|re[cç]u|bien re[cç]u/i.test(blob)) tags.add("remerciement");
  if (/kereis|docaposte|adh[eé]rent|espace adherent/i.test(blob)) tags.add("kereis");
  if (/etude|[eé]conom/i.test(blob)) tags.add("etude");
  if (/accord|valide|poursuiv|accepte/i.test(blob)) tags.add("accord-client");
  if (/fum|tabac|cigarette|alcool|sant[eé]|m[eé]dical|maladie|oubli.{0,30}indiqu/i.test(blob)) {
    tags.add("sante-client");
  }
  if (/formulaire|deposer|depot en ligne/i.test(blob)) tags.add("formulaire");
  if (/garantie|dec[eè]s|invalidit/i.test(blob)) tags.add("garanties");
  if (/substitution|souscription|adhesion|adh[eé]sion/i.test(blob)) tags.add("souscription");
  if (/ou en est|avancement|statut|progression/i.test(blob)) tags.add("statut-dossier");

  return [...tags];
}

const HEALTH_DISCLOSURE_RE =
  /fum(?:e|eur|ais|ait|euse|er)?|tabac|cigarette|alcool|oubli.{0,40}indiqu|pr[eé]cis.{0,30}(sant[eé]|m[eé]dical)|maladie|patholog|traitement|hospital|chirurg|m[eé]dicament|handicap|invalidit/i;

export function isClientHealthOrMedicalDisclosure(message: string): boolean {
  return HEALTH_DISCLOSURE_RE.test(String(message || ""));
}

const CHIFFRAGE_QUESTION_RE =
  /€\s*\d|[eé]conom.*\d|combien.*(gagn|économ|co[uû]t|mensualit)|\d+\s*€|tarif.*\d|mensualit.*\d/i;

const MULTI_CONTRAT_RE =
  /multi|monsieur|madame|second pr[eê]t|co-emprunteur|autre contrat|partie monsieur|deux pr[eê]t|conjoint/i;

const DOCUMENT_INTENT_RE =
  /document|offre|tableau|amort|pdf|banque|piece|envoy|transmi|joint|depot|recuper|trouver|espace|telecharg|illisib|manque|complet|mauvais|erreur|incorrect|confus/i;

export function isClientChiffrageQuestion(message: string): boolean {
  return CHIFFRAGE_QUESTION_RE.test(String(message || ""));
}

function hasDocumentRelatedIntent(message: string): boolean {
  return DOCUMENT_INTENT_RE.test(normalizeText(message));
}

function isCustomPlaybook(pb: CamillePlaybook): boolean {
  return pb.approvedBy !== "system_seed";
}

function sanitizePlaybookTextForStorage(text: string, dossierId?: string): string {
  let t = String(text || "").trim();
  if (dossierId) {
    t = t.replace(new RegExp(`\\b${dossierId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "[dossier]");
  }
  return t.replace(/\bLCIF-\d{6}\b/gi, "[dossier]");
}

function wordsOverlap(clientMessage: string, ...sources: string[]): number {
  const msgWords = normalizeText(clientMessage)
    .split(" ")
    .filter((w) => w.length >= 4);
  let overlap = 0;
  for (const src of sources) {
    const patWords = normalizeText(src)
      .split(" ")
      .filter((w) => w.length >= 4);
    for (const pw of patWords) {
      for (const mw of msgWords) {
        if (mw === pw || mw.startsWith(pw) || pw.startsWith(mw)) overlap += 1;
      }
    }
  }
  return overlap;
}

function hasPlaybookMessageRelevance(pb: CamillePlaybook, clientMessage: string): boolean {
  const overlap = wordsOverlap(
    clientMessage,
    pb.clientMessagePattern,
    pb.situationSummary,
    pb.staffGuidance,
  );
  if (overlap >= 1) return true;

  const msg = normalizeText(clientMessage);
  const pattern = normalizeText(pb.clientMessagePattern);
  if (pattern.length > 15 && msg.includes(pattern.slice(0, Math.min(30, pattern.length)))) {
    return true;
  }

  if ((pb.tags || []).includes("sante-client") && isClientHealthOrMedicalDisclosure(clientMessage)) {
    return true;
  }

  return false;
}

function isPlaybookBlockedForMessage(clientMessage: string, pb: CamillePlaybook): boolean {
  if (isClientChiffrageQuestion(clientMessage)) return true;
  if (MULTI_CONTRAT_RE.test(String(clientMessage || ""))) return true;

  if (isClientHealthOrMedicalDisclosure(clientMessage)) {
    const tags = pb.tags || [];
    if (tags.includes("sante-client")) return false;
    if (tags.includes("documents-pret")) return true;
  }

  if ((pb.tags || []).includes("documents-pret") && !hasDocumentRelatedIntent(clientMessage)) {
    return true;
  }

  return false;
}

export function personalizePlaybookReply(plain: string, dossierId?: string): string {
  if (!dossierId) return plain;
  return plain.replace(/\bLCIF-\d{6}\b/gi, dossierId);
}

function scorePlaybook(pb: CamillePlaybook, clientMessage: string, tags: string[]): number {
  let score = 0;
  for (const t of pb.tags || []) {
    if (tags.includes(t)) score += 3;
  }
  const msg = normalizeText(clientMessage);
  const pattern = normalizeText(pb.clientMessagePattern);
  if (!msg || !pattern) return score;

  score += Math.min(4, wordsOverlap(clientMessage, pb.clientMessagePattern, pb.situationSummary));
  if (pattern.length > 20 && msg.includes(pattern.slice(0, Math.min(40, pattern.length)))) {
    score += 4;
  }
  if (isClientHealthOrMedicalDisclosure(clientMessage) && (pb.tags || []).includes("sante-client")) {
    score += 5;
  }

  const dossierPostEtude = tags.includes("post-etude");
  const pbTags = pb.tags || [];
  const pbPreOnly = pbTags.includes("pre-etude") && !pbTags.includes("post-etude");
  const pbPostOnly = pbTags.includes("post-etude") && !pbTags.includes("pre-etude");
  if (dossierPostEtude && pbPreOnly) score -= 4;
  if (!dossierPostEtude && pbPostOnly) score -= 4;

  score += Math.min(1, Math.floor((pb.useCount || 0) / 10));
  return score;
}

function passesCustomPlaybookBar(
  pb: CamillePlaybook,
  clientMessage: string,
  score: number,
): boolean {
  if (!isCustomPlaybook(pb)) return true;
  const overlap = wordsOverlap(clientMessage, pb.clientMessagePattern, pb.situationSummary);
  const min = getPlaybookAutoReplyMinScore();
  return overlap >= 2 && score >= min + 2;
}

export async function findSimilarPlaybooks(
  clientMessage: string,
  dossier: any,
  limit = MAX_PROMPT_PLAYBOOKS,
): Promise<Array<{ playbook: CamillePlaybook; score: number }>> {
  const tags = extractSituationTags(dossier, clientMessage);
  const store = await loadPlaybookStore();
  return store.playbooks
    .map((pb) => ({ playbook: pb, score: scorePlaybook(pb, clientMessage, tags) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getPlaybookAutoReplyMinScore(): number {
  const n = Number(process.env.CAMILLE_PLAYBOOK_AUTO_SCORE || "9");
  return Number.isFinite(n) && n > 0 ? n : 9;
}

export function getRoutinePlaybookAutoReplyMinScore(): number {
  const n = Number(process.env.CAMILLE_ROUTINE_PLAYBOOK_AUTO_SCORE || "7");
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/** Envoi direct d'un texte playbook sans repasser par l'IA (défaut: false — playbooks = inspiration seulement). */
export function isPlaybookAutoSendEnabled(): boolean {
  const raw = String(process.env.CAMILLE_PLAYBOOK_AUTO_SEND ?? "false").toLowerCase();
  return raw === "true" || raw === "1";
}

export function getPlaybookSeedVersion(): string {
  return PLAYBOOK_SEED_VERSION;
}

export async function selectPlaybookMatch(
  dossier: any,
  clientMessage: string,
  options?: { minScore?: number },
): Promise<{ plain: string; playbook: CamillePlaybook; score: number } | null> {
  const msg = String(clientMessage || "").trim();
  if (msg.length < 3) return null;
  if (isClientChiffrageQuestion(msg) || MULTI_CONTRAT_RE.test(msg)) return null;

  const minScore = options?.minScore ?? getPlaybookAutoReplyMinScore();
  const store = await loadPlaybookStore();
  const tags = extractSituationTags(dossier, msg);
  const matches = store.playbooks
    .map((pb) => ({ playbook: pb, score: scorePlaybook(pb, msg, tags) }))
    .filter((x) => x.score >= 3)
    .filter((x) => !isPlaybookBlockedForMessage(msg, x.playbook))
    .filter((x) => hasPlaybookMessageRelevance(x.playbook, msg))
    .filter((x) => passesCustomPlaybookBar(x.playbook, msg, x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 1);
  const top = matches[0];
  if (!top || top.score < minScore) return null;
  const plain = personalizePlaybookReply(top.playbook.approvedReplyPlain, dossier?.id);
  return { plain, playbook: top.playbook, score: top.score };
}

export async function tryPlaybookAutoReply(
  dossier: any,
  clientMessage: string,
): Promise<{ plain: string; playbook: CamillePlaybook } | null> {
  const hit = await selectPlaybookMatch(dossier, clientMessage);
  if (!hit) return null;
  await incrementPlaybookUse(hit.playbook.id);
  return { plain: hit.plain, playbook: hit.playbook };
}

/** Playbook auto-réponse avec seuil abaissé pour questions procédurales routinières. */
export async function tryRoutinePlaybookAutoReply(
  dossier: any,
  clientMessage: string,
): Promise<{ plain: string; playbook: CamillePlaybook } | null> {
  const hit = await selectPlaybookMatch(dossier, clientMessage, {
    minScore: getRoutinePlaybookAutoReplyMinScore(),
  });
  if (!hit) return null;
  await incrementPlaybookUse(hit.playbook.id);
  return { plain: hit.plain, playbook: hit.playbook };
}

export async function buildPlaybooksPromptBlock(
  clientMessage: string,
  dossier: any,
): Promise<string> {
  const store = await loadPlaybookStore();
  const tags = extractSituationTags(dossier, clientMessage);
  const matches = store.playbooks
    .map((pb) => ({ playbook: pb, score: scorePlaybook(pb, clientMessage, tags) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PROMPT_PLAYBOOKS);
  if (!matches.length) return "";

  const lines = matches.map(({ playbook: pb, score }, i) => {
    return [
      `Cas ${i + 1} (score ${score}) — tags: ${(pb.tags || []).join(", ")}`,
      `Situation: ${pb.situationSummary}`,
      `Consigne équipe validée: ${pb.staffGuidance}`,
      `Réponse client approuvée (s'inspirer du fond, adapter au mail actuel):`,
      `"""${pb.approvedReplyPlain.slice(0, 1200)}"""`,
    ].join("\n");
  });

  return [
    "PLAYBOOKS VALIDÉS PAR L'ÉQUIPE (s'inspirer du fond et du ton — ADAPTER au mail actuel et au fil de conversation, ne jamais recopier mot pour mot):",
    ...lines,
  ].join("\n\n");
}

function anonymizeClientExcerpt(clientMessage: string): string {
  return String(clientMessage || "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(LCIF-\d{6})\b/gi, "[dossier]")
    .slice(0, 400);
}

export function htmlToPlainForPlaybook(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function saveApprovedPlaybook(params: {
  dossier: any;
  clientMessage: string;
  situationSummary: string;
  staffGuidance: string;
  approvedReplyPlain: string;
  approvedBy?: string;
  tags?: string[];
}): Promise<CamillePlaybook> {
  const store = await loadPlaybookStore();
  const tags =
    params.tags && params.tags.length > 0
      ? [...new Set(params.tags)]
      : extractSituationTags(params.dossier, params.clientMessage, params.staffGuidance);

  const pb: CamillePlaybook = {
    id: `pb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tags,
    situationSummary: params.situationSummary.slice(0, 500),
    staffGuidance: params.staffGuidance.slice(0, 800),
    clientMessagePattern: sanitizePlaybookTextForStorage(
      anonymizeClientExcerpt(params.clientMessage),
      params.dossier?.id,
    ),
    approvedReplyPlain: sanitizePlaybookTextForStorage(
      params.approvedReplyPlain.slice(0, 4000),
      params.dossier?.id,
    ),
    approvedAt: new Date().toISOString(),
    approvedBy: params.approvedBy,
    dossierId: params.dossier?.id,
    useCount: 0,
  };

  store.playbooks.unshift(pb);
  store.playbooks = store.playbooks.slice(0, MAX_PLAYBOOKS);
  await persistStore(store);
  console.log(`[Camille playbooks] enregistré ${pb.id} (${tags.join(", ")})`);
  return pb;
}

export async function updatePlaybook(
  id: string,
  patch: Partial<
    Pick<
      CamillePlaybook,
      | "tags"
      | "situationSummary"
      | "staffGuidance"
      | "clientMessagePattern"
      | "approvedReplyPlain"
    >
  >,
): Promise<CamillePlaybook | null> {
  const store = await loadPlaybookStore();
  const pb = store.playbooks.find((p) => p.id === id);
  if (!pb) return null;
  if (patch.tags) pb.tags = patch.tags.slice(0, 20);
  if (patch.situationSummary != null) pb.situationSummary = patch.situationSummary.slice(0, 500);
  if (patch.staffGuidance != null) pb.staffGuidance = patch.staffGuidance.slice(0, 800);
  if (patch.clientMessagePattern != null) {
    pb.clientMessagePattern = patch.clientMessagePattern.slice(0, 400);
  }
  if (patch.approvedReplyPlain != null) pb.approvedReplyPlain = patch.approvedReplyPlain.slice(0, 4000);
  await persistStore(store);
  return pb;
}

export async function deletePlaybook(id: string): Promise<boolean> {
  const store = await loadPlaybookStore();
  const before = store.playbooks.length;
  store.playbooks = store.playbooks.filter((p) => p.id !== id);
  if (store.playbooks.length === before) return false;
  await persistStore(store);
  return true;
}

async function incrementPlaybookUse(id: string) {
  const store = await loadPlaybookStore();
  const pb = store.playbooks.find((p) => p.id === id);
  if (!pb) return;
  pb.useCount = (pb.useCount || 0) + 1;
  pb.lastUsedAt = new Date().toISOString();
  await persistStore(store);
}

export async function listPlaybooks(limit = 50): Promise<CamillePlaybook[]> {
  const store = await loadPlaybookStore();
  return store.playbooks.slice(0, limit);
}

export async function seedDefaultPlaybooksIfEmpty(force = false): Promise<{ added: number; total: number }> {
  const store = await loadPlaybookStore();
  const versionStale = store.seedVersion !== PLAYBOOK_SEED_VERSION;

  let added = 0;
  for (const seed of DEFAULT_SEED_PLAYBOOKS) {
    const exists = store.playbooks.some(
      (pb) => normalizeText(pb.situationSummary) === normalizeText(seed.situationSummary),
    );
    if (exists && !force) continue;
    if (exists && force) continue;
    store.playbooks.push({
      ...seed,
      id: `pb_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      approvedAt: new Date().toISOString(),
      approvedBy: "system_seed",
      useCount: 0,
    });
    added += 1;
  }
  if (added > 0 || versionStale || force) {
    store.playbooks = store.playbooks.slice(0, MAX_PLAYBOOKS);
    store.seededAt = new Date().toISOString();
    store.seedVersion = PLAYBOOK_SEED_VERSION;
    await persistStore(store);
  }
  if (added > 0 || versionStale) {
    console.log(
      `[Camille playbooks] seed +${added} (version=${PLAYBOOK_SEED_VERSION}) total=${store.playbooks.length}`,
    );
  }
  return { added, total: store.playbooks.length };
}

export type PlaybookAuditIssue = {
  playbookId: string;
  situationSummary: string;
  severity: "warn" | "error";
  code: string;
  detail: string;
};

export type PlaybookSelfCheckResult = {
  message: string;
  phase: "pre" | "post";
  expectNull?: boolean;
  expectSituationIncludes?: string;
  matched: boolean;
  situation?: string;
  playbookId?: string;
};

const SELF_CHECK_SCENARIOS: Array<Omit<PlaybookSelfCheckResult, "matched" | "situation" | "playbookId">> = [
  {
    message: "J'ai oublié de vous indiquer que je fumais",
    phase: "pre",
    expectSituationIncludes: "santé",
  },
  {
    message: "Quels documents dois-je vous envoyer pour l'étude ?",
    phase: "pre",
    expectSituationIncludes: "quels documents",
  },
  {
    message: "Combien puis-je économiser exactement par mois ?",
    phase: "pre",
    expectNull: true,
  },
  {
    message: "L'offre de crédit n'est pas la bonne, il s'est trompé",
    phase: "pre",
    expectSituationIncludes: "erroné",
  },
  {
    message: "Merci pour votre message, bien reçu",
    phase: "pre",
    expectSituationIncludes: "remerci",
  },
  {
    message: "Comment gagner de l'argent sur mon assurance, je ne comprends pas",
    phase: "pre",
    expectSituationIncludes: "économies",
  },
  {
    message: "Vous êtes une agence immo mais vous faites l'assurance",
    phase: "pre",
    expectSituationIncludes: "Club Immobilier",
  },
  {
    message: "Je suis d'accord pour poursuivre le changement",
    phase: "post",
    expectSituationIncludes: "accord",
  },
  {
    message: "C'est quoi l'assurance emprunteur exactement ?",
    phase: "pre",
    expectSituationIncludes: "assurance emprunteur",
  },
  {
    message: "Quelle différence entre l'assurance de la banque et la délégation ?",
    phase: "pre",
    expectSituationIncludes: "délégation",
  },
  {
    message: "Je n'ai pas reçu le lien pour l'espace d'adhésion",
    phase: "post",
    expectSituationIncludes: "espace d'adhésion",
  },
  {
    message: "Où en est mon dossier s'il vous plaît ?",
    phase: "post",
    expectSituationIncludes: "où en est",
  },
  {
    message: "Pourquoi PDF et pas une photo de mon échéancier ?",
    phase: "pre",
    expectSituationIncludes: "PDF",
  },
  {
    message: "Je n'ai toujours pas eu de réponse à mon mail de la semaine dernière",
    phase: "pre",
    expectSituationIncludes: "relance",
  },
  {
    message: "Nous avons deux emprunteurs sur le prêt, est-ce un seul dossier ?",
    phase: "pre",
    expectSituationIncludes: "deux emprunteurs",
  },
];

function dossierForSelfCheck(phase: "pre" | "post") {
  return {
    id: "LCIF-SELFTEST",
    status: phase === "post" ? "MAIL_ENVOYE" : "EN_COURS",
    formData: { documents: [{ name: "offre.pdf", category: "offre" }] },
    communications: [],
  };
}

export async function runPlaybookSelfCheck(): Promise<{
  ok: boolean;
  results: PlaybookSelfCheckResult[];
}> {
  const results: PlaybookSelfCheckResult[] = [];
  for (const scenario of SELF_CHECK_SCENARIOS) {
    const dossier = dossierForSelfCheck(scenario.phase);
    const hit = await selectPlaybookMatch(dossier, scenario.message);
    const situation = hit?.playbook.situationSummary || "";
    let matched = false;
    if (scenario.expectNull) {
      matched = !hit;
    } else if (scenario.expectSituationIncludes) {
      matched = Boolean(
        hit &&
          normalizeText(situation).includes(normalizeText(scenario.expectSituationIncludes)),
      );
    } else {
      matched = Boolean(hit);
    }
    results.push({
      ...scenario,
      matched,
      situation: situation || undefined,
      playbookId: hit?.playbook.id,
    });
  }
  return { ok: results.every((r) => r.matched), results };
}

export async function auditPlaybookStore(): Promise<{
  total: number;
  seedVersion: string;
  seedCount: number;
  customCount: number;
  issues: PlaybookAuditIssue[];
  coverage: Record<string, number>;
  selfCheck: Awaited<ReturnType<typeof runPlaybookSelfCheck>>;
}> {
  const store = await loadPlaybookStore();
  const issues: PlaybookAuditIssue[] = [];
  const seenSituations = new Map<string, string>();

  for (const pb of store.playbooks) {
    const summaryKey = normalizeText(pb.situationSummary);
    const prev = seenSituations.get(summaryKey);
    if (prev && prev !== pb.id) {
      issues.push({
        playbookId: pb.id,
        situationSummary: pb.situationSummary,
        severity: "warn",
        code: "duplicate_situation",
        detail: `Doublon avec ${prev}`,
      });
    } else {
      seenSituations.set(summaryKey, pb.id);
    }

    if (/\bLCIF-\d{6}\b/i.test(pb.approvedReplyPlain || "")) {
      issues.push({
        playbookId: pb.id,
        situationSummary: pb.situationSummary,
        severity: "error",
        code: "hardcoded_lcif",
        detail: "Numéro LCIF en dur dans la réponse approuvée",
      });
    }

    if (isCustomPlaybook(pb) && (pb.tags || []).includes("documents-pret")) {
      const patternWords = normalizeText(pb.clientMessagePattern).split(" ").filter((w) => w.length >= 4);
      if (patternWords.length < 3) {
        issues.push({
          playbookId: pb.id,
          situationSummary: pb.situationSummary,
          severity: "warn",
          code: "weak_custom_documents_pattern",
          detail: "Playbook custom documents-pret avec motif client trop court",
        });
      }
    }

    if ((pb.approvedReplyPlain || "").length < 40) {
      issues.push({
        playbookId: pb.id,
        situationSummary: pb.situationSummary,
        severity: "warn",
        code: "short_reply",
        detail: "Réponse approuvée très courte",
      });
    }
  }

  const seedSummaries = new Set(
    DEFAULT_SEED_PLAYBOOKS.map((s) => normalizeText(s.situationSummary)),
  );
  const missingSeeds = DEFAULT_SEED_PLAYBOOKS.filter(
    (seed) =>
      !store.playbooks.some(
        (pb) => normalizeText(pb.situationSummary) === normalizeText(seed.situationSummary),
      ),
  );
  for (const seed of missingSeeds) {
    issues.push({
      playbookId: "seed_missing",
      situationSummary: seed.situationSummary,
      severity: "warn",
      code: "missing_seed",
      detail: "Playbook de base absent — lancer seed-defaults",
    });
  }

  const coverage: Record<string, number> = {
    preEtude: store.playbooks.filter((pb) => (pb.tags || []).includes("pre-etude")).length,
    postEtude: store.playbooks.filter((pb) => (pb.tags || []).includes("post-etude")).length,
    sante: store.playbooks.filter((pb) => (pb.tags || []).includes("sante-client")).length,
    documents: store.playbooks.filter((pb) => (pb.tags || []).includes("documents-pret")).length,
    custom: store.playbooks.filter((pb) => isCustomPlaybook(pb)).length,
    seeded: store.playbooks.filter((pb) => !isCustomPlaybook(pb)).length,
  };

  const selfCheck = await runPlaybookSelfCheck();
  if (!selfCheck.ok) {
    for (const r of selfCheck.results.filter((x) => !x.matched)) {
      issues.push({
        playbookId: r.playbookId || "self_check",
        situationSummary: r.message.slice(0, 120),
        severity: "error",
        code: "self_check_failed",
        detail: r.expectNull
          ? "Un playbook a matché alors qu'aucun ne devrait"
          : `Attendu « ${r.expectSituationIncludes || "match"} », obtenu « ${r.situation || "aucun"} »`,
      });
    }
  }

  return {
    total: store.playbooks.length,
    seedVersion: store.seedVersion || PLAYBOOK_SEED_VERSION,
    seedCount: DEFAULT_SEED_PLAYBOOKS.length,
    customCount: coverage.custom,
    issues,
    coverage,
    selfCheck,
  };
}

/** Enregistre la dernière réponse Camille/équipe comme playbook depuis un dossier. */
export async function savePlaybookFromDossierLastReply(params: {
  dossier: any;
  situationSummary?: string;
  staffGuidance?: string;
  approvedBy?: string;
}): Promise<CamillePlaybook | null> {
  const comms = [...(params.dossier.communications || [])].sort(
    (a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
  );
  const lastOutbound = comms.find((c: any) => c.direction === "outbound");
  const lastInbound = comms.find((c: any) => c.direction === "inbound");
  if (!lastOutbound?.text) return null;

  return saveApprovedPlaybook({
    dossier: params.dossier,
    clientMessage: String(lastInbound?.text || lastInbound?.subject || ""),
    situationSummary:
      params.situationSummary ||
      `Mail client : « ${String(lastInbound?.text || lastInbound?.subject || "").slice(0, 120)} »`,
    staffGuidance:
      params.staffGuidance ||
      "Réponse validée par l'équipe — réutiliser le fond pour des situations similaires.",
    approvedReplyPlain: htmlToPlainForPlaybook(String(lastOutbound.text || "")),
    approvedBy: params.approvedBy,
  });
}

void seedDefaultPlaybooksIfEmpty()
  .then(async () => {
    const audit = await auditPlaybookStore();
    const errCount = audit.issues.filter((i) => i.severity === "error").length;
    const warnCount = audit.issues.filter((i) => i.severity === "warn").length;
    console.log(
      `[Camille playbooks] audit total=${audit.total} custom=${audit.customCount} selfCheck=${audit.selfCheck.ok ? "OK" : "FAIL"} errors=${errCount} warns=${warnCount}`,
    );
    if (!audit.selfCheck.ok) {
      for (const r of audit.selfCheck.results.filter((x) => !x.matched)) {
        console.warn(
          `[Camille playbooks] self-check FAIL « ${r.message.slice(0, 60)} » → ${r.situation || "aucun match"}`,
        );
      }
    }
  })
  .catch((e) => {
    console.warn("[Camille playbooks] seed init:", e?.message || e);
  });
