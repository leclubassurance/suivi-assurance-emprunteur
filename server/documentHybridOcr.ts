import fs from "fs";
import path from "path";
import { generateContentWithRetry } from "./geminiClient";

export type HybridOcrResult = {
  text: string;
  usedOcr: boolean;
  provider?: "gemini";
  error?: string;
};

export function isHybridOcrEnabled(): boolean {
  const v = (process.env.OCR_HYBRID_ENABLED || "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

export function getHybridOcrMinTextChars(): number {
  const n = Number(process.env.OCR_HYBRID_MIN_TEXT_CHARS || "80");
  return Number.isFinite(n) && n > 0 ? n : 80;
}

function guessMimeType(localPath: string, hint?: string): string {
  const h = String(hint || "").toLowerCase().split(";")[0].trim();
  if (h && (h.startsWith("application/") || h.startsWith("image/"))) return h;
  const ext = path.extname(localPath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  return "application/pdf";
}

function isSupportedMime(mime: string): boolean {
  return (
    mime === "application/pdf" ||
    mime.startsWith("image/")
  );
}

/**
 * OCR via Gemini (déjà utilisé pour Camille) — uniquement si le PDF natif n'a pas assez de texte.
 */
export async function hybridOcrExtractText(
  localPath: string,
  options?: { mimeType?: string },
): Promise<HybridOcrResult> {
  if (!isHybridOcrEnabled()) return { text: "", usedOcr: false };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("MY_GEMINI")) {
    return { text: "", usedOcr: false, error: "gemini_not_configured" };
  }
  if (!localPath || !fs.existsSync(localPath)) {
    return { text: "", usedOcr: false, error: "file_missing" };
  }

  const maxBytes = Number(process.env.OCR_HYBRID_MAX_BYTES || 8_000_000);
  const buf = fs.readFileSync(localPath);
  if (buf.length > maxBytes) {
    return { text: "", usedOcr: false, error: "file_too_large" };
  }

  const mimeType = guessMimeType(localPath, options?.mimeType);
  if (!isSupportedMime(mimeType)) {
    return { text: "", usedOcr: false, error: "unsupported_mime" };
  }

  const configured = process.env.OCR_HYBRID_MODEL || "gemini-2.5-flash";
  const modelCandidates = [configured, "gemini-2.5-flash"].filter(
    (m, i, arr) => m && arr.indexOf(m) === i,
  );

  const promptText = `Document bancaire français (offre de prêt ou tableau d'amortissement).
Extrais tout le texte visible, dans l'ordre de lecture (tableaux : une ligne par échéance si possible).
Réponds UNIQUEMENT avec le texte brut extrait, sans commentaire ni markdown.`;

  let lastError: string | undefined;

  for (const model of modelCandidates) {
    try {
      const response = await generateContentWithRetry({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: buf.toString("base64"),
                },
              },
              { text: promptText },
            ],
          },
        ],
        config: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });

      const text = String(response.text || "")
        .replace(/^```[\w]*\n?/m, "")
        .replace(/\n?```$/m, "")
        .trim();

      if (!text) {
        lastError = "empty_ocr";
        continue;
      }

      if (model !== configured) {
        console.log(`[OCR hybride] Modèle de repli utilisé : ${model}`);
      }
      return { text, usedOcr: true, provider: "gemini" };
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      lastError = errMsg;
      const modelGone =
        /404/.test(errMsg) &&
        (/no longer available/i.test(errMsg) || /NOT_FOUND/i.test(errMsg) || /not found/i.test(errMsg));
      if (modelGone) {
        console.warn(`[OCR hybride] Modèle ${model} indisponible, essai suivant…`);
        continue;
      }
      console.warn(`[OCR hybride] Échec ${path.basename(localPath)} (${model}): ${errMsg}`);
      break;
    }
  }

  return { text: "", usedOcr: false, error: lastError || "ocr_failed" };
}
