import { Step, InsuranceFormData } from './types';

export const CLIENT_PORTAL_URL_KEY = 'lcif-client-portal-url';
/**
 * Token ?ref= en session uniquement (plus de localStorage global).
 * Le brouillon formulaire porte le token pour reprendre un parcours conseiller
 * sans polluer les visites organiques du site principal.
 */
export const APPORTEUR_REF_SESSION_KEY = 'lcif-apporteur-ref';
/** @deprecated Clé legacy — vidée au chargement pour stopper les attributions fantômes. */
export const APPORTEUR_REF_STORAGE_KEY = 'lcif-apporteur-ref-persistent';

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
  autresCreditsImmobiliers: '',
  autresCreditsMontant: '',
};

export const PROFESSION_MANUELLE_HELP =
  "Le postulant exerce une « profession manuelle » s'il utilise des machines ou des outils pour lesquels le port d'équipement de sécurité est obligatoire, ou s'il fait de la manutention de charges de plus de 15 kilos.";

/** Listes Sésame : source unique = shared/sesameLabForm (Lab + parcours étude). */
export {
  QUALITE_OPTIONS,
  STATUT_PRO_OPTIONS,
  PROFESSION_RISQUE_OPTIONS,
  DEPLACEMENTS_PRO_OPTIONS,
} from "../shared/sesameLabForm";

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
