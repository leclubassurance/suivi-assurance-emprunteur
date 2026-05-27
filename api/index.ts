export default function handler(_req: any, res: any) {
  res.statusCode = 410;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Deprecated. Use /api/* routed by api/[...path].ts" }));
}

