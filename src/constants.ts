import { Step, InsuranceFormData } from './types';

export const CLIENT_PORTAL_URL_KEY = 'lcif-client-portal-url';
export const APPORTEUR_REF_SESSION_KEY = 'lcif-apporteur-ref';

export const INITIAL_ASSURE = {
  id: '',
  civilite: '',
  nom: '',
  prenom: '',
  dateNaissance: '',
  email: '',
  telephone: '',
  qualite: '',
  paysResidence: 'FRANCE',
  cpResidence: '',
  statutPro: '',
  profession: '',
  professionRisque: 'aucun',
  professionManuelle: false,
  travauxHauteur: false,
  deplacementsPro: '< 20000 Km',
  sportsRisque: false,
  selectedSports: [],
  fumeur: false,
};

export const INITIAL_PRET = {
  id: '',
  naturePret: '',
  capitalRestant: '',
  banquePreteuse: '',
  datePremiereEcheance: '',
  taux: '',
  typeTaux: '',
  periodicite: '',
  dureeRestante: '',
  differeAmortissement: 0,
  modaliteRemboursement: '',
};

import { AppFile } from './types';

export const INITIAL_FORM_DATA: InsuranceFormData = {
  objetFinancement: '',
  assures: [{ ...INITIAL_ASSURE, id: '1' }],
  prets: [{ ...INITIAL_PRET, id: '1' }],
  documents: [] as AppFile[],
};

export const QUALITE_OPTIONS = [
  { value: 'EMPRUNTEUR', label: 'Emprunteur' },
  { value: 'CAUTION_PP', label: 'Caution de personne physique' },
  { value: 'CAUTION_PM', label: 'Caution ou dirigeant de personne morale' }
];

export const STATUT_PRO_OPTIONS = [
  { value: 'salarie_cadre', label: 'Salarié Cadre' },
  { value: 'employe_bureau', label: 'Employé de bureau' },
  { value: 'salarie_noncadre', label: 'Salarié Non-Cadre' },
  { value: 'fonctionnaire_a', label: 'Fonctionnaire Classe A' },
  { value: 'fonctionnaire_autre', label: 'Fonctionnaire hors Classe A' },
  { value: 'retraite_cadre', label: 'Retraité Cadre' },
  { value: 'retraite_noncadre', label: 'Retraité Non-Cadre' },
  { value: 'dirigeant', label: 'Dirigeant de Société' },
  { value: 'profession_liberale', label: 'Profession Libérale (hors Médical/Paramédical)' },
  { value: 'profession_medicale', label: 'Profession Médicale/Pharmacien' },
  { value: 'profession_paramedical_salarie', label: 'Profession Paramédicale (Salarié)' },
  { value: 'profession_paramedical_fonctionnaire', label: 'Profession Paramédicale (Fonctionnaire)' },
  { value: 'profession_paramedical_liberal', label: 'Profession Paramédicale (Libéral)' },
  { value: 'artisan_nonbtp', label: 'Artisan (hors BTP)' },
  { value: 'commercant', label: 'Commerçant' },
  { value: 'artisan_btp', label: 'Artisan du BTP/Ouvrier/Professions du Transport' },
  { value: 'profession_agricole', label: 'Profession agricole' },
  { value: 'saisonnier', label: 'Saisonnier/Étudiant' },
  { value: 'sans_profession', label: 'Sans profession' }
];

export const PROFESSION_RISQUE_OPTIONS = [
  { value: 'aucun', label: "N'exerce aucune de ces professions" },
  { value: 'marin_pecheur', label: 'Marin pêcheur' },
  { value: 'aviation', label: "Métier de l'aviation hors lignes régulières" },
  { value: 'armee_police', label: "Métiers de l'armée, police, gendarmerie" },
  { value: 'securite', label: 'Métiers de la sécurité (agent, vigile)' },
  { value: 'cirque', label: 'Métiers du cirque, cascadeurs, intermittents du spectacle' },
  { value: 'plongeur', label: 'Plongeur avec appareil autonome' },
  { value: 'pompier', label: 'Pompier, Secouriste, Sauveteur' },
  { value: 'missions_humanitaires', label: 'Missions humanitaires hors UE' },
  { value: 'sportif_pro', label: 'Sportif professionnel' },
  { value: 'transport_explosifs', label: "Transport d'explosifs/matières dangereuses" },
  { value: 'manipulation_explosifs', label: "Manipulation d'explosifs/substances chimiques" },
  { value: 'travail_hauteur', label: 'Travail en hauteur > 20m' },
  { value: 'travail_souterrain', label: 'Travail souterrain/Mineur' },
  { value: 'travail_site_specifique', label: 'Travail site on-shore/volcanique/archéologique/minière/forestière/pétrolière/nucléaire' }
];

export const DEPLACEMENTS_PRO_OPTIONS = [
  { value: '< 20000 Km', label: '< 20 000 Km' },
  { value: '20000-50000 Km', label: '20 000 - 50 000 Km' },
  { value: '> 50000 Km', label: '> 50 000 Km' }
];

export const SPORTS_RISQUE_CATEGORIES: Record<string, string[]> = {
  'aériens': [
    'Parachutisme', 'Deltaplane', 'Parapente', 'ULM', 'Vol libre', 
    'Saut en élastique', 'Hang-gliding', 'Jet pack', 'Montgolfière', 
    'Aéromodélisme acrobatique'
  ],
  'montagne': [
    'Alpinisme', 'Escalade', 'Canyoning', 'Randonnée haute montagne', 
    'Spéléologie', 'Ski hors-piste', 'Snowboard hors-piste', 
    'Ski de randonnée', 'Cascade de glace', 'Raquettes haute altitude', 
    'Trail extrême', 'Ski alpinisme', 'Ferrata', 'Bloc', 'VTT extrême'
  ],
  'mécaniques': [
    'Motonautisme', 'Sports motocyclistes', 'Sports automobiles', 
    'Rallye', 'Quad/Buggy', 'Motocross', 'Drift', 'Enduro'
  ],
  'nautiques': [
    'Plongée (tous niveaux)', 'Voile racing', 'Kayak extreme', 
    'Planche à voile', 'Wakeboard', 'Jetski', 'Canyoning aquatique', 
    'Rafting', 'Surf', 'Kitesurf', 'Stand-up paddle'
  ],
  'autres': [
    'Équitation compétition', 'Cyclisme extrême', 'Sports de combat compétition', 
    'Tauromachie', 'Lutte', 'Boxe', 'Rugby', 'American football', 'Luge', 
    'Bobsleigh', 'Skeleton', 'Parkour', 'BASE jump', 'Slackline'
  ]
};
