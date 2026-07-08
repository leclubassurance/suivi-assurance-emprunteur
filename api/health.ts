import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Route Vercel (serverless). Railway utilise Express → server/app.ts */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    status: "ok",
    build: "vercel-serverless",
    hint: "Backend API Railway — ex. https://assurance-emprunteur.up.railway.app/api/health",
  });
}
