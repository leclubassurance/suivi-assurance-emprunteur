/** Normalise un SIREN (9 chiffres) ou SIRET (14 chiffres). */
export function normalizeSiretInput(value: string): string {
  return String(value || "").replace(/\s/g, "").trim();
}

export function extractSirenFromSiret(value: string): string | undefined {
  const n = normalizeSiretInput(value);
  if (n.length === 9 && /^\d{9}$/.test(n)) return n;
  if (n.length === 14 && /^\d{14}$/.test(n)) return n.slice(0, 9);
  return undefined;
}

/** Algorithme de Luhn (variante utilisée pour SIREN/SIRET français). */
function luhnFrenchValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = parseInt(digits[digits.length - 1 - i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function isValidSiren(siren: string): boolean {
  const n = normalizeSiretInput(siren);
  return /^\d{9}$/.test(n) && luhnFrenchValid(n);
}

export function isValidSiret(siret: string): boolean {
  const n = normalizeSiretInput(siret);
  if (!/^\d{14}$/.test(n)) return false;
  return isValidSiren(n.slice(0, 9));
}

export function formatSiretDisplay(siret: string): string {
  const n = normalizeSiretInput(siret);
  if (n.length !== 14) return siret;
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9, 14)}`;
}

export function formatSirenDisplay(siren: string): string {
  const n = normalizeSiretInput(siren);
  if (n.length !== 9) return siren;
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 9)}`;
}
