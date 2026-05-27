#!/usr/bin/env node
/**
 * Prépare les valeurs Railway pour le compte de service Google.
 * Usage: node scripts/prepare-railway-google-sa.mjs ~/Downloads/votre-cle.json
 */
import fs from "fs";
import path from "path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/prepare-railway-google-sa.mjs chemin/vers/cle.json");
  process.exit(1);
}

const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error("Fichier introuvable:", abs);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
} catch (e) {
  console.error("Fichier JSON invalide:", e.message);
  process.exit(1);
}

if (parsed.type !== "service_account" || !parsed.client_email || !parsed.private_key) {
  console.error("Ce fichier ne ressemble pas à une clé de compte de service Google.");
  process.exit(1);
}

const oneLine = JSON.stringify(parsed);
const base64 = Buffer.from(oneLine, "utf8").toString("base64");

console.log("\n=== Compte de service ===");
console.log("Email à partager dans Drive (Éditeur):");
console.log(parsed.client_email);
console.log("\n=== Railway : choisissez UNE méthode ===\n");

console.log("Méthode 1 (recommandée) — variable GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
console.log("Copiez la ligne suivante ENTIÈRE dans Railway :\n");
console.log(base64);
console.log("\n---\n");

console.log("Méthode 2 — variable GOOGLE_SERVICE_ACCOUNT_JSON (une ligne)");
console.log("Longueur:", oneLine.length, "caractères");
if (oneLine.length > 32000) {
  console.warn("Attention: très long pour l’UI Railway — préférez la méthode 1 (BASE64).");
}
console.log("\nDébut:", oneLine.slice(0, 80) + "...");
console.log("\nPour copier dans le presse-papiers (Mac):");
console.log(`  node scripts/prepare-railway-google-sa.mjs "${abs}" | ...`);
console.log("\nOu:");
console.log(`  base64 -i "${abs}" | tr -d '\\n' | pbcopy   # puis collez dans BASE64\n`);
