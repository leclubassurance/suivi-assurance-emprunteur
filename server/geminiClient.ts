import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

export async function generateContentWithRetry(params: any, retries = 3, delay = 1000): Promise<any> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (error: any) {
      lastError = error;
      const errMsg = error?.message || String(error);
      const isUnavailable =
        errMsg.includes("503") ||
        errMsg.toUpperCase().includes("UNAVAILABLE") ||
        errMsg.toLowerCase().includes("high demand") ||
        errMsg.toLowerCase().includes("temporary");
      const isRateLimited =
        errMsg.includes("429") ||
        errMsg.toLowerCase().includes("quota exceeded") ||
        errMsg.toLowerCase().includes("rate limit");

      if ((isUnavailable || isRateLimited) && attempt < retries) {
        let waitTime = delay;
        const retryMatch = errMsg.match(/retry in ([\d.]+)s/);
        if (retryMatch) {
          waitTime = Math.max(delay, parseFloat(retryMatch[1]) * 1000 + 1000);
        }
        console.warn(
          `[Gemini API Warning] ${isRateLimited ? "429 Quota" : "503 Unavailable"} sur ${params.model}. Tentative ${attempt}/${retries} après ${waitTime}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
