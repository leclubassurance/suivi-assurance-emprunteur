export function countryCodeToLabel(code: string): string {
  const c = code.toUpperCase();
  const fr: Record<string, string> = {
    FR: "France",
    BE: "Belgique",
    CH: "Suisse",
    LU: "Luxembourg",
    MC: "Monaco",
    ES: "Espagne",
    IT: "Italie",
    DE: "Allemagne",
    GB: "R.-U.",
    US: "États-Unis",
    CA: "Canada",
    MA: "Maroc",
    TN: "Tunisie",
    DZ: "Algérie",
    GP: "Guadeloupe",
    MQ: "Martinique",
    RE: "La Réunion",
    GF: "Guyane",
    YT: "Mayotte",
    NC: "N.-Calédonie",
    PF: "Polynésie",
  };
  return fr[c] || c;
}
