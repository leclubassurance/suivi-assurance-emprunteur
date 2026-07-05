/** Route Vercel (serverless). Railway utilise Express → server/app.ts */
export default function handler(_req: unknown, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      status: "ok",
      build: "vercel-serverless",
      hint: "Backend API Railway — ex. https://assurance-emprunteur.up.railway.app/api/health",
    }),
  );
}
