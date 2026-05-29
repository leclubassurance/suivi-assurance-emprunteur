/**
 * Registre RGPD + journal des consentements sur Google Sheets.
 * Auth : compte de service en priorité (Railway), puis OAuth serveur si besoin.
 */

import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { loadServiceAccountCredentials, getServiceAccountClientEmail } from "./serviceAccount";
import { hasServerOAuthRefreshToken, getServerAccessToken } from "./googleOAuthServer";
import {
  RGPD_REGISTER_ENTRIES,
  RGPD_REGISTER_HEADERS,
  RGPD_REGISTER_META,
  type RgpdRegisterRow,
} from "../shared/rgpdRegisterEntries";
import type { PrivacyConsentRecord } from "./privacyConsent";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";

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

const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** Normalise l'ID (URL complète, lien Drive, ou ID + paramètres collés par erreur). */
export function normalizeSpreadsheetId(raw: string): string {
  let id = raw.trim();
  const fromSheetsUrl = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromSheetsUrl?.[1]) return fromSheetsUrl[1];
  const fromDriveUrl = id.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (fromDriveUrl?.[1]) return fromDriveUrl[1];
  const fromD = id.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (fromD?.[1]) return fromD[1];
  return id.split("?")[0].split("#")[0].trim();
}

export function getRgpdSpreadsheetId(): string | undefined {
  const raw = env("RGPD_GOOGLE_SPREADSHEET_ID");
  if (!raw) return undefined;
  const id = normalizeSpreadsheetId(raw);
  return id || undefined;
}

function registerTabName(): string {
  return env("RGPD_SHEET_REGISTER") || "Registre traitements";
}

function consentTabName(): string {
  return env("RGPD_SHEET_CONSENTS") || "Journal consentements";
}

export function formatGoogleApiError(err: unknown): string {
  const e = err as {
    message?: string;
    response?: { data?: { error?: { message?: string; status?: string; errors?: { message?: string }[] } } };
  };
  const apiMsg = e?.response?.data?.error?.message;
  const details = e?.response?.data?.error?.errors?.map((x) => x.message).filter(Boolean).join("; ");
  const parts = [apiMsg || e?.message, details].filter(Boolean);
  return parts.join(" — ") || String(err);
}

/** Plage A1 avec nom d'onglet (espaces, apostrophes). */
export function a1SheetRange(sheetTitle: string, cellRange: string): string {
  const escaped = sheetTitle.replace(/'/g, "''");
  return `'${escaped}'!${cellRange}`;
}

async function createSheetsClient(): Promise<sheets_v4.Sheets | null> {
  const credentials = loadServiceAccountCredentials();
  if (credentials) {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: [SHEETS_SCOPE, DRIVE_READONLY],
      });
      return google.sheets({ version: "v4", auth });
    } catch (err) {
      console.error("[RGPD Sheets] Compte de service :", formatGoogleApiError(err));
    }
  }

  if (hasServerOAuthRefreshToken()) {
    try {
      const token = await getServerAccessToken();
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: token });
      return google.sheets({ version: "v4", auth });
    } catch (err) {
      console.error("[RGPD Sheets] OAuth serveur :", formatGoogleApiError(err));
    }
  }

  return null;
}

async function createDriveClientForRgpd() {
  const credentials = loadServiceAccountCredentials();
  if (!credentials) return null;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [DRIVE_READONLY],
  });
  return google.drive({ version: "v3", auth });
}

export async function diagnoseRgpdSpreadsheet(): Promise<{
  spreadsheetId: string | null;
  configuredRaw: string | null;
  serviceAccountEmail: string | null;
  drive?: { ok: boolean; name?: string; mimeType?: string; error?: string };
  sheets?: { ok: boolean; title?: string; sheetTitles?: string[]; error?: string };
}> {
  const configuredRaw = env("RGPD_GOOGLE_SPREADSHEET_ID") || null;
  const spreadsheetId = getRgpdSpreadsheetId() || null;
  const serviceAccountEmail = getServiceAccountClientEmail();
  const out: Awaited<ReturnType<typeof diagnoseRgpdSpreadsheet>> = {
    spreadsheetId,
    configuredRaw,
    serviceAccountEmail,
  };

  if (!spreadsheetId) return out;

  const drive = await createDriveClientForRgpd();
  if (drive) {
    try {
      const meta = await drive.files.get({
        fileId: spreadsheetId,
        fields: "id,name,mimeType,webViewLink",
        supportsAllDrives: true,
      });
      out.drive = {
        ok: meta.data.mimeType === SPREADSHEET_MIME,
        name: meta.data.name || undefined,
        mimeType: meta.data.mimeType || undefined,
        error:
          meta.data.mimeType !== SPREADSHEET_MIME
            ? "Ce fichier n'est pas une Google Sheet native. Créez un fichier Google Sheets (Fichier → Nouveau → Google Sheets) et utilisez son URL /spreadsheets/d/…"
            : undefined,
      };
    } catch (err) {
      out.drive = {
        ok: false,
        error: `${formatGoogleApiError(err)} — Partagez la feuille en éditeur avec ${serviceAccountEmail || "le compte de service"}.`,
      };
    }
  }

  const sheets = await createSheetsClient();
  if (sheets) {
    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "properties.title,sheets.properties.title",
      });
      out.sheets = {
        ok: true,
        title: meta.data.properties?.title || undefined,
        sheetTitles: meta.data.sheets?.map((s) => s.properties?.title || "").filter(Boolean),
      };
    } catch (err) {
      out.sheets = { ok: false, error: formatGoogleApiError(err) };
    }
  } else {
    out.sheets = { ok: false, error: "Client Sheets indisponible (compte de service / OAuth)." };
  }

  return out;
}

async function assertSpreadsheetReady(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const diag = await diagnoseRgpdSpreadsheet();
  if (diag.drive && !diag.drive.ok) {
    return { ok: false, error: diag.drive.error || "Fichier Drive invalide pour Sheets." };
  }
  try {
    await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "spreadsheetId",
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `${formatGoogleApiError(err)} — Vérifiez RGPD_GOOGLE_SPREADSHEET_ID (URL https://docs.google.com/spreadsheets/d/XXX/edit) et le partage avec ${getServiceAccountClientEmail() || "le compte de service"}.`,
    };
  }
}

async function getSheetIdByTitle(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
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

/** Réécrit l'onglet registre (en-têtes + lignes + méta en K1:N1). */
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
        "Pas d'accès Google Sheets. Configurez GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 et partagez la feuille avec le compte de service.",
    };
  }

  const ready = await assertSpreadsheetReady(sheets, spreadsheetId);
  if (!ready.ok) return { ok: false, error: ready.error };

  try {
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
      `Version: ${RGPD_REGISTER_META.lastSyncedLabel}`,
    ];

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: a1SheetRange(tab, "A1"), values: rows },
          { range: a1SheetRange(tab, "K1"), values: [metaRow] },
        ],
      },
    });

    return { ok: true, spreadsheetId };
  } catch (err) {
    return { ok: false, error: formatGoogleApiError(err) };
  }
}

async function ensureConsentHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
): Promise<void> {
  const read = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: a1SheetRange(tab, "A1:J1"),
  });
  const first = read.data.values?.[0];
  if (first && first[0] === CONSENT_HEADERS[0]) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: a1SheetRange(tab, "A1"),
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

  const ready = await assertSpreadsheetReady(sheets, spreadsheetId);
  if (!ready.ok) return { ok: false, error: ready.error };

  try {
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
      (consent.userAgent || "").slice(0, 500),
      (consent.sourceUrl || "").slice(0, 500),
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: a1SheetRange(tab, "A:J"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatGoogleApiError(err) };
  }
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
    .catch((e) => log(`[RGPD] Sync registre erreur: ${formatGoogleApiError(e)}`));
}
