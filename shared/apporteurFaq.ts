export type ApporteurFaqItem = {
  id: string;
  category: string;
  question: string;
  answer: string;
};

export const APPORTEUR_FAQ_CATEGORIES = [
  "Le Club Immobilier Français",
  "Assurance emprunteur",
  "Recommander un client",
  "Objections fréquentes",
  "Documents & délais",
  "Votre rémunération",
  "Cadre légal",
] as const;

export const APPORTEUR_FAQ: ApporteurFaqItem[] = [
  {
    id: "lcif-1",
    category: "Le Club Immobilier Français",
    question: "Qu'est-ce que Le Club Immobilier Français ?",
    answer:
      "Le Club Immobilier Français (LCIF) accompagne les emprunteurs dans le changement d'assurance emprunteur : analyse du contrat actuel, étude des économies possibles et accompagnement jusqu'à la souscription si le client le souhaite.",
  },
  {
    id: "lcif-2",
    category: "Le Club Immobilier Français",
    question: "LCIF est-il un assureur ?",
    answer:
      "Non. LCIF est un courtier en assurance (ORIAS 24002253). Nous comparons les offres du marché et conseillons le client ; la compagnie d'assurance retenue émet le contrat.",
  },
  {
    id: "lcif-3",
    category: "Le Club Immobilier Français",
    question: "Pourquoi recommander LCIF à mes clients ?",
    answer:
      "Vous offrez un service concret après la vente ou en cours de projet : des économies sur l'assurance emprunteur, un interlocuteur unique et un suivi transparent. Cela renforce votre relation client.",
  },
  {
    id: "lcif-4",
    category: "Le Club Immobilier Français",
    question: "À qui s'adresse le service ?",
    answer:
      "Aux propriétaires et emprunteurs avec un prêt immobilier en cours, souhaitant vérifier s'ils peuvent réduire le coût de leur assurance emprunteur tout en conservant des garanties adaptées.",
  },
  {
    id: "lcif-5",
    category: "Le Club Immobilier Français",
    question: "Le service est-il payant pour le client ?",
    answer:
      "L'étude des économies est gratuite pour le client. Des frais de courtage peuvent s'appliquer uniquement en cas de changement effectif, selon le contrat d'adhésion LCIF.",
  },
  {
    id: "assur-1",
    category: "Assurance emprunteur",
    question: "Peut-on changer d'assurance emprunteur à tout moment ?",
    answer:
      "Oui, depuis la loi Lemoine (2022), le client peut résilier son assurance emprunteur à tout moment, sans frais ni pénalité, sous réserve d'équivalence des garanties pour la banque.",
  },
  {
    id: "assur-2",
    category: "Assurance emprunteur",
    question: "Quelles économies peut espérer un client ?",
    answer:
      "Cela dépend de l'âge, de la santé, du capital restant dû et de l'ancien contrat. LCIF chiffre les économies dans une étude personnalisée — souvent plusieurs centaines d'euros par an.",
  },
  {
    id: "assur-3",
    category: "Assurance emprunteur",
    question: "La banque peut-elle refuser le changement ?",
    answer:
      "La banque peut vérifier l'équivalence des garanties. Si le nouveau contrat est conforme, elle ne peut pas s'opposer au changement. LCIF prépare un dossier adapté aux exigences bancaires.",
  },
  {
    id: "assur-4",
    category: "Assurance emprunteur",
    question: "Faut-il refaire une visite médicale ?",
    answer:
      "Pas systématiquement. Selon l'âge, le capital assuré et les réponses au questionnaire de santé, certaines formalités peuvent être simplifiées. LCIF précise le cas par cas.",
  },
  {
    id: "assur-5",
    category: "Assurance emprunteur",
    question: "Le changement concerne-t-il tous les co-emprunteurs ?",
    answer:
      "Chaque emprunteur peut avoir son propre contrat d'assurance emprunteur. LCIF étudie la situation de chaque assuré concerné par le prêt.",
  },
  {
    id: "assur-6",
    category: "Assurance emprunteur",
    question: "Que se passe-t-il si le client est fumeur ou a un antécédent médical ?",
    answer:
      "LCIF analyse quand même les options du marché. Le tarif peut varier, mais un changement peut rester intéressant. Rien n'est imposé : le client décide en toute connaissance.",
  },
  {
    id: "reco-1",
    category: "Recommander un client",
    question: "Comment recommander un client simplement ?",
    answer:
      "Partagez votre lien client (?ref=) ou créez une recommandation depuis votre espace partenaire. Le client reçoit un email d'invitation et peut déposer son dossier en ligne.",
  },
  {
    id: "reco-2",
    category: "Recommander un client",
    question: "Que dire au client en deux phrases ?",
    answer:
      "« Je travaille avec Le Club Immobilier Français pour faire analyser gratuitement votre assurance emprunteur. Si des économies sont possibles, ils vous envoient une étude claire — sans engagement. »",
  },
  {
    id: "reco-3",
    category: "Recommander un client",
    question: "À quel moment recommander ?",
    answer:
      "Idéalement après l'achat, lors d'un renouvellement annuel, avant une reprise de prêt, ou quand le client évoque ses charges mensuelles.",
  },
  {
    id: "reco-4",
    category: "Recommander un client",
    question: "Le client doit-il vous mentionner ?",
    answer:
      "Non si vous utilisez votre lien ?ref= : l'attribution est automatique. Sinon, indiquez son nom dans une recommandation depuis votre espace.",
  },
  {
    id: "reco-5",
    category: "Recommander un client",
    question: "Puis-je recommander sans email ?",
    answer:
      "Oui avec le téléphone uniquement, mais l'email permet au client de recevoir l'invitation et le suivi. Privilégiez les deux coordonnées.",
  },
  {
    id: "reco-6",
    category: "Recommander un client",
    question: "Comment suivre l'avancement ?",
    answer:
      "Dans votre espace partenaire : statut de chaque recommandation, étapes du dossier et lien de suivi client dès qu'un dossier LCIF est ouvert.",
  },
  {
    id: "obj-1",
    category: "Objections fréquentes",
    question: "Le client dit : « Je n'ai pas le temps. »",
    answer:
      "Le dépôt en ligne prend environ 10 minutes (offre de prêt + tableau d'amortissement). LCIF gère ensuite l'analyse et les échanges avec la banque si besoin.",
  },
  {
    id: "obj-2",
    category: "Objections fréquentes",
    question: "Le client dit : « Mon assurance est déjà bonne. »",
    answer:
      "Proposez une vérification gratuite : beaucoup de clients découvrent un écart significatif sans le savoir, surtout sur d'anciens contrats groupés.",
  },
  {
    id: "obj-3",
    category: "Objections fréquentes",
    question: "Le client craint une complexité administrative.",
    answer:
      "LCIF accompagne le client étape par étape : étude, dossier banque, résiliation de l'ancien contrat si le client valide le changement.",
  },
  {
    id: "obj-4",
    category: "Objections fréquentes",
    question: "Le client pense que c'est « trop beau pour être vrai ».",
    answer:
      "La loi Lemoine a renforcé la concurrence sur l'assurance emprunteur. LCIF est courtier ORIAS — un cadre réglementé, pas une offre « miracle ».",
  },
  {
    id: "obj-5",
    category: "Objections fréquentes",
    question: "Le client veut attendre la fin de l'année.",
    answer:
      "Chaque mois d'attente peut coûter des économies. L'étude est sans engagement : le client peut comparer et décider sereinement.",
  },
  {
    id: "obj-6",
    category: "Objections fréquentes",
    question: "Le client a peur de perdre des garanties.",
    answer:
      "L'étude LCIF compare les garanties (décès, invalidité, IPT/ITT, etc.). Le client ne change que s'il valide un contrat au moins équivalent pour sa banque.",
  },
  {
    id: "doc-1",
    category: "Documents & délais",
    question: "Quels documents le client doit-il fournir ?",
    answer:
      "En priorité : offre de prêt (ou convention) et tableau d'amortissement. Pièce d'identité et RIB peuvent être demandés selon l'avancement du dossier.",
  },
  {
    id: "doc-2",
    category: "Documents & délais",
    question: "Combien de temps pour recevoir l'étude ?",
    answer:
      "Généralement quelques jours ouvrés après réception des documents complets. Le suivi est visible dans votre espace partenaire.",
  },
  {
    id: "doc-3",
    category: "Documents & délais",
    question: "Le client n'a pas son tableau d'amortissement.",
    answer:
      "Il peut le demander à sa banque ou le retrouver dans son espace client bancaire. LCIF peut l'aider à identifier le bon document.",
  },
  {
    id: "doc-4",
    category: "Documents & délais",
    question: "Plusieurs prêts : un seul dossier ?",
    answer:
      "Oui, le formulaire permet d'ajouter plusieurs prêts. LCIF étudie l'ensemble du financement.",
  },
  {
    id: "doc-5",
    category: "Documents & délais",
    question: "Que signifie le statut « Étude envoyée » ?",
    answer:
      "L'équipe LCIF a terminé l'analyse et envoyé au client par email une étude personnalisée avec les économies estimées et les prochaines étapes.",
  },
  {
    id: "rem-1",
    category: "Votre rémunération",
    question: "Comment suis-je rémunéré ?",
    answer:
      "Vous percevez 50 % des frais de courtage LCIF sur les dossiers signés, calculés selon le barème contractuel (10 % des économies, min. 200 € / max. 500 € par assuré, TTC).",
  },
  {
    id: "rem-2",
    category: "Votre rémunération",
    question: "Quand suis-je payé ?",
    answer:
      "Après validation effective du changement d'assurance par le client et selon les modalités de votre contrat d'apporteur d'affaires.",
  },
  {
    id: "rem-3",
    category: "Votre rémunération",
    question: "Le simulateur de gains est-il garanti ?",
    answer:
      "Non, c'est une estimation indicative basée sur un volume de dossiers et un taux de conversion moyen. Seuls les dossiers effectivement signés génèrent une rémunération.",
  },
  {
    id: "rem-4",
    category: "Votre rémunération",
    question: "Un prospect qui ne signe pas me rapporte-t-il quelque chose ?",
    answer:
      "La rémunération est liée aux dossiers aboutis (changement effectif). En revanche, chaque recommandation qualifie votre pipeline et votre historique avec LCIF.",
  },
  {
    id: "rem-5",
    category: "Votre rémunération",
    question: "Puis-je voir mes dossiers signés dans l'espace ?",
    answer:
      "Oui : le KPI « Signées » et le statut de chaque recommandation indiquent les dossiers finalisés.",
  },
  {
    id: "legal-1",
    category: "Cadre légal",
    question: "Dois-je mentionner que je touche une rémunération ?",
    answer:
      "Oui, en cas de lien commercial, la transparence est requise. Vous pouvez dire : « En cas de changement effectué, je perçois une rémunération de la part de LCIF, sans surcoût pour vous. »",
  },
  {
    id: "legal-2",
    category: "Cadre légal",
    question: "Puis-je promettre un montant d'économies précis ?",
    answer:
      "Non. Annoncez une étude gratuite et personnalisée. Seule l'étude LCIF peut chiffrer les économies réelles.",
  },
  {
    id: "legal-3",
    category: "Cadre légal",
    question: "Les données clients sont-elles protégées ?",
    answer:
      "Oui. LCIF applique le RGPD : consentement, sécurisation des documents et accès limité aux équipes habilitées.",
  },
  {
    id: "legal-4",
    category: "Cadre légal",
    question: "Qui contacter en cas de question ?",
    answer:
      "L'équipe LCIF : assurance@leclubimmobilier.fr — ORIAS 24002253.",
  },
  {
    id: "reco-7",
    category: "Recommander un client",
    question: "Puis-je recommander un client déjà en cours chez LCIF ?",
    answer:
      "Si un dossier est déjà ouvert sans votre lien, contactez l'équipe LCIF pour vérifier l'attribution avant de créer une nouvelle recommandation.",
  },
  {
    id: "assur-7",
    category: "Assurance emprunteur",
    question: "Le changement concerne-t-il l'assurance habitation ?",
    answer:
      "Non, uniquement l'assurance emprunteur (celle liée au prêt). L'assurance habitation reste distincte.",
  },
  {
    id: "obj-7",
    category: "Objections fréquentes",
    question: "Mon client est en cours de déménagement / vente.",
    answer:
      "Un changement peut rester pertinent sur le prêt en cours. LCIF évalue au cas par cas selon le capital restant dû et la durée restante.",
  },
  {
    id: "doc-6",
    category: "Documents & délais",
    question: "Le client a déjà reçu l'email d'invitation, que faire ?",
    answer:
      "Invitez-le à cliquer sur le lien reçu ou à utiliser votre lien ?ref=. En cas de difficulté, contactez assurance@leclubimmobilier.fr.",
  },
];
