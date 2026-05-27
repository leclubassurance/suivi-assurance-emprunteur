import { Dossier } from "./dossierModel";

export function getPrimaryClientEmail(dossier: Dossier): string | null {
  const email = dossier.formData?.assures?.[0]?.email;
  if (!email || typeof email !== "string") return null;
  return email.trim() || null;
}

export function detectMissingDocs(dossier: Dossier): string[] {
  const docs: any[] = dossier.formData?.documents || [];
  const normalize = (v: unknown) =>
    String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const names = docs.map((d) => normalize(d?.name));
  const hasCNI = names.some(
    (n) => n.includes("cni") || n.includes("identit") || n.includes("passeport") || (n.includes("carte") && n.includes("identit")),
  );
  const hasRib = names.some((n) => n.includes("rib") || n.includes("iban"));
  const missing: string[] = [];
  if (!hasCNI) missing.push("Pièce d'identité (CNI recto/verso ou passeport)");
  if (!hasRib) missing.push("RIB");
  return missing;
}

export function isDossierStale(dossier: Dossier, days: number) {
  const updatedAt = new Date(dossier.updatedAt || dossier.createdAt).getTime();
  const delta = Date.now() - updatedAt;
  return delta > days * 24 * 3600 * 1000;
}

