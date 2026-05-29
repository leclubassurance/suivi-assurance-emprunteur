/**
 * Registre RGPD + journal des consentements sur Google Sheets.
 * Auth : compte de service (recommandé) ou OAuth serveur si scopes Sheets accordés.
 */

import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { loadServiceAccountCredentials } from "./serviceAccount";
import { hasServerOAuthRefreshToken, getServerAccessToken } from "./googleOAuthServer";
import {
  RGPD_REGISTER_ENTRIES,
  RGPD_REGISTER_HEADERS,
  RGPD_REGISTER_META,
  type RgpdRegisterRow,
} from "../shared/rgpdRegisterEntries";
import type { PrivacyConsentRecord } from "./privacyConsent";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const CONSENT_HEADERS = [
  "Horodatage (UTC)",
  "ID dossier",
  "Email client",
  "Nom client",
  "Version politique",
  "Date politique",
  "Libellé case à cocher",
  "Adresse IP",
  "User-Agent",
  "URL origine",
] as const;

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function getRgpdSpreadsheetId(): string | undefined {
  return env("RGPD_GOOGLE_SPREADSHEET_ID");
}

function registerTabName(): string {
  return env("RGPD_SHEET_REGISTER") || "Registre traitements";
}

function consentTabName(): string {
  return env("RGPD_SHEET_CONSENTS") || "Journal consentements";
}

async function createSheetsClient(): Promise<sheets_v4.Sheets | null> {
  if (hasServerOAuthRefreshToken()) {
    try {
      const token = await getServerAccessToken();
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: token });
      return google.sheets({ version: "v4", auth });
    } catch {
      // repli compte de service
    }
  }

  const credentials = loadServiceAccountCredentials();
  if (!credentials) return null;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [SHEETS_SCOPE],
    });
    return google.sheets({ version: "v4", auth });
  } catch (err) {
    console.error("[RGPD Sheets] Auth compte de service impossible", err);
    return null;
  }
}

async function getSheetIdByTitle(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === title);
  return sheet?.properties?.sheetId ?? null;
}

async function ensureTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
): Promise<void> {
  const existing = await getSheetIdByTitle(sheets, spreadsheetId, title);
  if (existing != null) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
}

function rowToValues(row: RgpdRegisterRow): string[] {
  return [
    row.treatmentName,
    row.purpose,
    row.dataCategories,
    row.dataSubjects,
    row.recipients,
    row.transfersOutsideEu,
    row.retention,
    row.securityMeasures,
    row.legalBasis,
  ];
}

/** Réécrit l'onglet registre (en-têtes + lignes + méta en ligne 1 colonne K). */
export async function syncRgpdRegisterToSheet(): Promise<{
  ok: boolean;
  spreadsheetId?: string;
  error?: string;
}> {
  const spreadsheetId = getRgpdSpreadsheetId();
  if (!spreadsheetId) {
    return { ok: false, error: "RGPD_GOOGLE_SPREADSHEET_ID non configuré" };
  }

  const sheets = await createSheetsClient();
  if (!sheets) {
    return {
      ok: false,
      error:
        "Pas d'accès Google Sheets (compte de service ou OAuth serveur). Partagez la feuille avec le compte de service.",
    };
  }

  const tab = registerTabName();
  await ensureTab(sheets, spreadsheetId, tab);

  const rows: string[][] = [
    [...RGPD_REGISTER_HEADERS],
    ...RGPD_REGISTER_ENTRIES.map(rowToValues),
  ];

  const metaRow = [
    `Responsable: ${RGPD_REGISTER_META.controller}`,
    `Plateforme: ${RGPD_REGISTER_META.platform}`,
    `Sync: ${new Date().toISOString()}`,
    `Version politique: ${RGPD_REGISTER_META.lastSyncedLabel}`,
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!K1`,
    valueInputOption: "RAW",
    requestBody: { values: [metaRow] },
  });

  return { ok: true, spreadsheetId };
}

async function ensureConsentHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
): Promise<void> {
  const read = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A1:J1`,
  });
  const first = read.data.values?.[0];
  if (first && first[0] === CONSENT_HEADERS[0]) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[...CONSENT_HEADERS]] },
  });
}

export async function appendPrivacyConsentToSheet(
  dossierId: string,
  consent: PrivacyConsentRecord,
  client?: { email?: string; name?: string },
): Promise<{ ok: boolean; error?: string }> {
  const spreadsheetId = getRgpdSpreadsheetId();
  if (!spreadsheetId) {
    return { ok: false, error: "RGPD_GOOGLE_SPREADSHEET_ID non configuré" };
  }

  const sheets = await createSheetsClient();
  if (!sheets) {
    return { ok: false, error: "Accès Google Sheets indisponible" };
  }

  const tab = consentTabName();
  await ensureTab(sheets, spreadsheetId, tab);
  await ensureConsentHeaderRow(sheets, spreadsheetId, tab);

  const row = [
    consent.acceptedAt,
    dossierId,
    client?.email || "",
    client?.name || "",
    consent.policyVersion,
    consent.policyLastUpdated,
    consent.labelText,
    consent.ip || "",
    consent.userAgent || "",
    consent.sourceUrl || "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tab}'!A:J`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return { ok: true };
}

let registerSyncStarted = false;

export function scheduleRgpdRegisterSyncOnBoot(log: (msg: string) => void): void {
  if (registerSyncStarted) return;
  if (!getRgpdSpreadsheetId()) return;
  if (env("RGPD_REGISTER_SYNC_ON_START") === "false") return;

  registerSyncStarted = true;
  syncRgpdRegisterToSheet()
    .then((r) => {
      if (r.ok) log(`[RGPD] Registre des traitements synchronisé (${getRgpdSpreadsheetId()}).`);
      else log(`[RGPD] Sync registre ignorée: ${r.error}`);
    })
    .catch((e) => log(`[RGPD] Sync registre erreur: ${e?.message || e}`));
}
