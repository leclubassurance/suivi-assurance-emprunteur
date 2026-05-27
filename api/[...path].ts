export default async function handler(req: any, res: any) {
  try {
    // Import dynamique pour éviter les soucis CJS/ESM en serverless
    const mod: any = await import("../server/app");
    const app = mod.createApp();
    return app(req, res);
  } catch (err: any) {
    const detail = err?.stack || err?.message || String(err);
    console.error("API_HANDLER_FAILED", detail);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(`FUNCTION_INVOCATION_FAILED\n\n${detail}`);
  }
}

