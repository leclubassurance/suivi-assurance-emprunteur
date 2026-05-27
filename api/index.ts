let cachedApp: any = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  try {
    const mod = await import("../server/app");
    cachedApp = mod.createApp();
    return cachedApp;
  } catch (err: any) {
    console.error("APP_INIT_FAILED", err?.stack || err?.message || err);
    throw err;
  }
}

export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();
    return app(req as any, res as any);
  } catch (err: any) {
    console.error("HANDLER_FAILED", err?.stack || err?.message || err);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    const detail = err?.stack || err?.message || String(err);
    res.end(`FUNCTION_INVOCATION_FAILED\n\n${detail}`);
  }
}

