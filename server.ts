import path from "path";
import express from "express";
import { createApp } from "./server/app";
import { initFirebaseSync } from "./server/firebaseSync";
import { startScheduler } from "./server/scheduler";

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();

async function startServer() {
  await initFirebaseSync().catch(console.error);
  startScheduler();

  if (process.env.NODE_ENV !== "production") {
    console.log("Starting Vite development server...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Ne pas renvoyer index.html pour les URLs /api (sinon les tests JSON affichent le site)
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        return res.status(404).json({
          error: "Route API introuvable",
          path: req.path,
          hint: "Redéployez Railway avec le dernier code (git push origin main).",
        });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
