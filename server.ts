import fs from "fs";
import path from "path";
import express from "express";
import { RAILWAY_BUILD_ID } from "./server/buildInfo";
import { createApp } from "./server/app";
import { initFirebaseSync } from "./server/firebaseSync";
import { startScheduler } from "./server/scheduler";
import { scheduleCamilleKnowledgeSync } from "./server/camilleKnowledgeDrive";

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();

function isProduction() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

function setupStaticFrontend() {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({
        error: "Route API introuvable",
        path: req.path,
      });
    }
    res.sendFile(path.join(distPath, "index.html"));
  });
}

async function startServer() {
  if (isProduction()) {
    const indexPath = path.join(process.cwd(), "dist", "index.html");
    if (!fs.existsSync(indexPath)) {
      console.error(
        "ERREUR: dist/index.html absent — exécutez npm run build avant le démarrage (Railway build phase).",
      );
      process.exit(1);
    }
    setupStaticFrontend();
  } else {
    console.log("Starting Vite development server...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[boot] build=${RAILWAY_BUILD_ID} deploySource=tsx-server.ts git=${process.env.RAILWAY_GIT_COMMIT_SHA || "local"}`,
    );
    console.log(`Server listening on 0.0.0.0:${PORT} (NODE_ENV=${process.env.NODE_ENV || "unset"})`);
    void Promise.all([
      import("./server/businessHours"),
      import("./server/telegramCamille"),
      import("./server/camillePlaybooks"),
    ])
      .then(async ([{ isCamilleTestMode, getCamilleTestModeUntilParisH }, telegram, playbooks]) => {
        const testModeActive = isCamilleTestMode();
        const untilH = getCamilleTestModeUntilParisH();
        const aiReply = String(process.env.AI_AUTO_REPLY_ENABLED ?? "true").toLowerCase();
        const untilLabel = untilH == null ? "aucune" : `${String(untilH).padStart(2, "0")}h Paris`;
        const safeMode = String(process.env.CAMILLE_PRODUCTION_SAFE_MODE ?? "true").toLowerCase();
        const tgOk = telegram.isTelegramEnabled();
        console.log(
          `[boot] Camille: testMode=${testModeActive} (until=${untilLabel}) aiAutoReply=${aiReply} productionSafe=${safeMode !== "false" && safeMode !== "0"} telegram=${tgOk} (clients dossier)`,
        );
        if (!tgOk) {
          console.warn(
            "[boot] Telegram inactif — configurez TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_CHAT_IDS puis GET /api/telegram/setup-webhook",
          );
        }
        const seed = await playbooks.seedDefaultPlaybooksIfEmpty();
        console.log(
          `[boot] Playbooks: ${seed.total} en base (seed +${seed.added}, version=${playbooks.getPlaybookSeedVersion()})`,
        );
      })
      .catch((err) => {
        console.warn("[boot] Camille status log failed:", err?.message || err);
      });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("Server listen error:", err);
    process.exit(1);
  });

  // Ne pas bloquer le port HTTP : Firebase / scheduler en arrière-plan (évite 502 Railway)
  void initFirebaseSync().catch((err) => console.error("initFirebaseSync failed", err));
  startScheduler();
  scheduleCamilleKnowledgeSync(path.join(process.cwd(), "data"));
}

startServer().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
