/**
 * Parcours étude dossier (étapes) : fiche Kereis → contrôle → simuler Sésame → choisir → PDF.
 * Réutilise le client / payload Lab Sésame (env test).
 */
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import {
  autoResolveCatalogCodes,
  buildLabSamplePayload,
} from "./sesameLabRoutes";
import { sesameFetchJson, sesameFetchPdf, getSesameConfigStatus } from "./sesameClient";
import { buildSesameOverridesFromDossier } from "./sesameFromKereisDraft";
import { applyKereisDraftPatches, buildKereisDraftForDossier } from "./kereisDraftBuild";
import { addEvent } from "./dossierModel";

type WorkflowState = {
  step?: number;
  overrides?: Record<string, unknown>;
  warnings?: string[];
  selectedByAssure?: Record<string, string>;
  lastSimulateAt?: string;
  lastDevisDocId?: string;
  catalogNote?: string;
  updatedAt?: string;
};

async function loadDossier(deps: any, id: string) {
  const db = await deps.readDBAsync();
  const dossier = db.dossiers.find((d: any) => d.id === id);
  return { db, dossier };
}

function saveWorkflow(dossier: any, patch: Partial<WorkflowState>) {
  const prev = (dossier.sesameStudyWorkflow || {}) as WorkflowState;
  dossier.sesameStudyWorkflow = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function pickString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function summarizePayload(body: any) {
  return {
    codeOffre: body?.codeOffre,
    dateEffetGaranties: body?.dateEffetGaranties,
    assures: (body?.assures || []).map((a: any) => ({
      referenceAssure: a?.referenceAssure,
      nom: a?.nom,
      prenom: a?.prenom,
      codeProduit: a?.codeProduit,
      idStatut: a?.profession?.idStatutProfessionnel,
    })),
    prets: (body?.prets || []).map((p: any) => ({
      referencePret: p?.referencePret,
      montant: p?.montant,
      duree: p?.duree,
      taux: p?.taux,
    })),
  };
}

export function registerSesameStudyWorkflowRoutes(
  app: Express,
  deps: {
    uploadsDir: string;
    readDBAsync: () => Promise<any>;
    writeDB: (db: any, dossier?: any) => Promise<void>;
    ensureBackgroundServicesStarted: () => Promise<void>;
  },
) {
  /** Prépare / rafraîchit la fiche Kereis + preview overrides Sésame. */
  app.post("/api/admin/dossiers/:id/study-workflow/prepare", async (req: Request, res: Response) => {
    await deps.ensureBackgroundServicesStarted();
    const { db, dossier } = await loadDossier(deps, req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    try {
      const force = req.body?.force === true || req.body?.refresh === true;
      if (force || !(dossier as any).kereisDraft) {
        await buildKereisDraftForDossier({
          dossier,
          uploadsDir: deps.uploadsDir,
          actorLabel: String((req as any).adminEmail || "Admin"),
        });
      }
      const { overrides, warnings } = buildSesameOverridesFromDossier(dossier);
      saveWorkflow(dossier, { step: 2, overrides, warnings });
      const { assessAdeStudyFeasibility } = await import("./adeStudyFeasibility");
      const feasibility = await assessAdeStudyFeasibility(dossier);
      (dossier as any).adeStudyFeasibility = feasibility;
      await deps.writeDB(db, dossier);
      return res.json({
        success: true,
        kereisDraft: (dossier as any).kereisDraft,
        overrides,
        warnings,
        feasibility,
        sesameStatus: getSesameConfigStatus(),
        workflow: (dossier as any).sesameStudyWorkflow,
      });
    } catch (err: any) {
      console.error("[study-workflow/prepare]", err?.message || err);
      return res.status(500).json({ error: err?.message || "Erreur préparation parcours" });
    }
  });

  /** Sauvegarde des corrections manuelles sur la fiche Kereis. */
  app.patch("/api/admin/dossiers/:id/kereis-draft", async (req: Request, res: Response) => {
    await deps.ensureBackgroundServicesStarted();
    const { db, dossier } = await loadDossier(deps, req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const draft = (dossier as any).kereisDraft;
    if (!draft) return res.status(400).json({ error: "Aucune fiche Kereis — lancez d'abord l'étape 1." });
    try {
      const patches =
        (req.body?.patches && typeof req.body.patches === "object" ? req.body.patches : null) ||
        (req.body?.fields && typeof req.body.fields === "object" ? req.body.fields : null) ||
        {};
      const next = applyKereisDraftPatches(draft, patches);
      // source note: contrôle manuel admin
      for (const group of [
        next.steps.coordonnees,
        next.steps.infosPerso,
        ...next.steps.prets.map((p: any) => p.fields),
        next.steps.preteur,
        next.steps.simulations,
      ]) {
        for (const f of group) {
          if (f.source === "assistant ADE" && Object.keys(patches).length) {
            f.source = "contrôle admin";
            f.note = f.note?.replace(/assistant ADE/g, "contrôle admin") || "Confirmé admin";
          }
        }
      }
      (dossier as any).kereisDraft = next;
      const { overrides, warnings } = buildSesameOverridesFromDossier(dossier);
      // Merge éventuels overrides UI (franchise, options…)
      const uiOverrides =
        req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
      const merged = { ...overrides, ...uiOverrides };
      saveWorkflow(dossier, { step: 2, overrides: merged, warnings });
      dossier.updatedAt = new Date().toISOString();
      await deps.writeDB(db, dossier);
      return res.json({
        success: true,
        kereisDraft: next,
        overrides: merged,
        warnings,
        workflow: (dossier as any).sesameStudyWorkflow,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erreur sauvegarde fiche Kereis" });
    }
  });

  /** Simulation Sésame (tarification) à partir de la fiche contrôlée. */
  app.post("/api/admin/dossiers/:id/study-workflow/simulate", async (req: Request, res: Response) => {
    await deps.ensureBackgroundServicesStarted();
    const { db, dossier } = await loadDossier(deps, req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    try {
      // Persiste d'éventuels patches avant simuler
      if (req.body?.patches && typeof req.body.patches === "object") {
        const draft = (dossier as any).kereisDraft;
        if (draft) {
          (dossier as any).kereisDraft = applyKereisDraftPatches(draft, req.body.patches);
        }
      }
      const built = buildSesameOverridesFromDossier(dossier);
      const uiOverrides =
        req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
      // Toujours repartir de la fiche Kereis à jour — ne pas laisser un ancien
      // overrides corrompu (CRD=3, taux=0) écraser le mapping.
      const rawOverrides = {
        ...built.overrides,
        ...uiOverrides,
      };
      const { overrides, resolved, note } = await autoResolveCatalogCodes(rawOverrides);
      const body = buildLabSamplePayload(overrides, { mode: "tarification" });

      const pret0 = body?.prets?.[0];
      const montant = Number(pret0?.montant || 0);
      const taux = Number(pret0?.taux || 0);
      if (montant < 1000 || taux <= 0 || taux > 25) {
        await deps.writeDB(db, dossier);
        return res.status(400).json({
          success: false,
          ok: false,
          error:
            `Données prêt invalides pour Sésame (CRD=${montant || 0} €, taux=${taux || 0} %). ` +
            `Corrigez Capital restant dû (≥ 1 000 €) et Taux nominal (ex. 3,45) puis réessayez.`,
          warnings: built.warnings,
          requestPayloadPreview: summarizePayload(body),
          kereisDraft: (dossier as any).kereisDraft,
        });
      }

      const reductionCouple =
        req.body?.reductionCouple ??
        overrides.reductionCouple ??
        (Array.isArray(overrides.assures) && (overrides.assures as any[]).length >= 2
          ? true
          : undefined);

      const result = await sesameFetchJson({
        method: "POST",
        path: "/tarification",
        query: {
          echeancier: String(req.body?.echeancier || "").trim() || undefined,
          reductionCouple: reductionCouple != null ? String(reductionCouple) : undefined,
        },
        body,
        timeoutMs: 90_000,
      });

      const { assessAdeStudyFeasibility } = await import("./adeStudyFeasibility");
      const feasibility = await assessAdeStudyFeasibility(dossier);
      (dossier as any).adeStudyFeasibility = feasibility;

      saveWorkflow(dossier, {
        step: result.ok ? 4 : 3,
        overrides,
        warnings: built.warnings,
        catalogNote: note,
        lastSimulateAt: new Date().toISOString(),
      });
      addEvent(dossier, {
        type: "AI_DECISION",
        actor: { kind: "SYSTEM", label: String((req as any).adminEmail || "Admin") },
        message: result.ok
          ? "Simulation Sésame OK — choisir une assurance."
          : `Simulation Sésame échouée : ${result.error || result.status}`,
        meta: { template: "SESAME_SIMULATE", ok: result.ok },
      });
      dossier.updatedAt = new Date().toISOString();
      await deps.writeDB(db, dossier);

      // Aide debug UI : combien de tarifs bruts + échantillon
      let tarifCount = 0;
      let tarifableCount = 0;
      const samples: Array<{ code?: string; type?: string; message?: string }> = [];
      const walkTarifs = (tarifs: any[]) => {
        for (const t of tarifs) {
          tarifCount += 1;
          const code = pickString(t?.codeProduit, t?.produit?.codeProduit, t?.code, t?.produit?.code);
          const type = pickString(t?.type, t?.statut, t?.etat);
          if (!type || type === "TARIFABLE") tarifableCount += 1;
          if (samples.length < 5) {
            samples.push({
              code: code || undefined,
              type: type || undefined,
              message: pickString(t?.message, t?.motif, t?.libelleErreur, t?.erreur).slice(0, 160) || undefined,
            });
          }
        }
      };
      const raw = result.data as any;
      if (Array.isArray(raw)) {
        for (const block of raw) {
          if (Array.isArray(block?.tarifs)) walkTarifs(block.tarifs);
          else if (block?.codeProduit || block?.produit) walkTarifs([block]);
        }
      } else if (raw && typeof raw === "object") {
        if (Array.isArray(raw.assures)) {
          for (const a of raw.assures) {
            if (Array.isArray(a?.tarifs)) walkTarifs(a.tarifs);
          }
        } else if (Array.isArray(raw.tarifs)) {
          walkTarifs(raw.tarifs);
        } else if (Array.isArray(raw.liste)) {
          walkTarifs(raw.liste);
        }
      }

      return res.status(result.ok ? 200 : 502).json({
        success: result.ok,
        ok: result.ok,
        data: result.data,
        error: result.error,
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        catalogAuto: { resolved, note },
        requestPayloadPreview: summarizePayload(body),
        warnings: built.warnings,
        workflow: (dossier as any).sesameStudyWorkflow,
        kereisDraft: (dossier as any).kereisDraft,
        feasibility,
        tarifCount,
        tarifableCount,
        tarifSamples: samples,
      });
    } catch (err: any) {
      console.error("[study-workflow/simulate]", err?.message || err);
      const status = /désactivé|production/i.test(err?.message || "")
        ? 403
        : /manquants|Credentials/i.test(err?.message || "")
          ? 503
          : 500;
      return res.status(status).json({ error: err?.message || "Erreur simulation Sésame" });
    }
  });

  /**
   * Devis Sésame + génération PDF étude.
   * Body: { selectedByAssure: { ASSURE001: "GEN_..." }, forceGenerate?: boolean }
   */
  app.post(
    "/api/admin/dossiers/:id/study-workflow/generate-study",
    async (req: Request, res: Response) => {
      await deps.ensureBackgroundServicesStarted();
      const { db, dossier } = await loadDossier(deps, req.params.id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
      try {
        const selectedRaw =
          (req.body?.selectedByAssure && typeof req.body.selectedByAssure === "object"
            ? req.body.selectedByAssure
            : null) ||
          (req.body?.selections && typeof req.body.selections === "object"
            ? req.body.selections
            : null) ||
          {};
        const selectedByAssure: Record<string, string> = {};
        for (const [k, v] of Object.entries(selectedRaw)) {
          const code = pickString(v);
          if (code) selectedByAssure[String(k)] = code;
        }
        if (!Object.keys(selectedByAssure).length && pickString(req.body?.codeProduit)) {
          selectedByAssure.ASSURE001 = pickString(req.body.codeProduit);
        }
        if (!Object.keys(selectedByAssure).length) {
          return res.status(400).json({
            error: "Sélectionnez une assurance (code produit) avant de générer l'étude.",
          });
        }

        const built = buildSesameOverridesFromDossier(dossier);
        const prevOverrides =
          ((dossier as any).sesameStudyWorkflow?.overrides as Record<string, unknown>) || {};
        const rawOverrides: Record<string, unknown> = {
          ...prevOverrides,
          ...built.overrides,
          ...((req.body?.overrides && typeof req.body.overrides === "object"
            ? req.body.overrides
            : {}) as object),
        };

        // Appliquer le code produit choisi par assuré
        const assures = Array.isArray(rawOverrides.assures)
          ? (rawOverrides.assures as Record<string, unknown>[])
          : [];
        const nextAssures: Record<string, unknown>[] = assures.map((a, i) => {
          const ref = pickString(a.referenceAssure) || `ASSURE${String(i + 1).padStart(3, "0")}`;
          const code =
            selectedByAssure[ref] ||
            selectedByAssure[`ASSURE${String(i + 1).padStart(3, "0")}`] ||
            Object.values(selectedByAssure)[0];
          return { ...a, codeProduit: code };
        });
        if (!nextAssures.length) {
          nextAssures.push({
            referenceAssure: "ASSURE001",
            codeProduit: Object.values(selectedByAssure)[0],
          });
        }
        rawOverrides.assures = nextAssures;
        rawOverrides.codeProduit = pickString(nextAssures[0]?.codeProduit);

        const { overrides, resolved, note } = await autoResolveCatalogCodes(rawOverrides);
        const body = buildLabSamplePayload(overrides, { mode: "devis" });
        if (Array.isArray(body.assures)) {
          for (const a of body.assures) delete a.produitsATarifer;
        }
        const missingProduit = Array.isArray(body.assures)
          ? body.assures.findIndex((a: any) => !a?.codeProduit)
          : 0;
        if (!body?.assures?.length || missingProduit >= 0) {
          return res.status(400).json({
            error: "Code produit manquant sur au moins un assuré pour le devis Sésame.",
            catalogAuto: { resolved, note },
          });
        }

        const devisResult = await sesameFetchPdf({ path: "/devis", body, timeoutMs: 90_000 });
        if (!devisResult.ok || !devisResult.binaryBase64) {
          return res.status(502).json({
            error: devisResult.error || `Devis Sésame HTTP ${devisResult.status}`,
            requestId: devisResult.requestId,
            catalogAuto: { resolved, note },
          });
        }

        // Attache le devis au dossier
        if (!dossier.formData) dossier.formData = {};
        if (!Array.isArray(dossier.formData.documents)) dossier.formData.documents = [];
        const buf = Buffer.from(devisResult.binaryBase64, "base64");
        const produitSlug = pickString(body.assures?.[0]?.codeProduit).replace(/[^\w.-]+/g, "_") || "sesame";
        const fileName = `sesame-devis-${produitSlug}-${Date.now()}.pdf`;
        const dossierDir = path.join(deps.uploadsDir, dossier.id);
        if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
        const localPath = path.join(dossierDir, fileName);
        fs.writeFileSync(localPath, buf);

        // Remplace les anciens devis Sésame pour éviter les doublons d'extraction
        dossier.formData.documents = dossier.formData.documents.filter(
          (d: any) => !(d?.category === "devis" && d?.source === "sesame"),
        );
        const doc = {
          id: `devis-sesame-${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          category: "devis",
          name: fileName,
          size: buf.length,
          type: "application/pdf",
          localPath,
          source: "sesame",
          codeProduit: pickString(body.assures?.[0]?.codeProduit),
          uploadedAt: new Date().toISOString(),
        };
        dossier.formData.documents.push(doc);

        saveWorkflow(dossier, {
          step: 5,
          overrides,
          selectedByAssure,
          lastDevisDocId: doc.id,
          catalogNote: note,
        });

        const { generateAndIngestAdeStudyForDossier } = await import("./adeStudyPipeline");
        const forceGenerate = req.body?.forceGenerate === true || req.body?.force === true;
        const result = await generateAndIngestAdeStudyForDossier({
          dossier,
          uploadsDir: deps.uploadsDir,
          actorLabel: String((req as any).adminEmail || "Admin"),
          feasibilityPolicy: "sesame_guided",
          forceGenerate,
        });
        await deps.writeDB(db, dossier);

        if (result.ok === false) {
          return res.status(400).json({
            error: result.error,
            code: result.code || "unknown",
            hint: result.hint || null,
            reasons: result.reasons || null,
            feasibility: result.feasibility || (dossier as any).adeStudyFeasibility || null,
            devisAttached: true,
            devisDocId: doc.id,
            catalogAuto: { resolved, note },
            requestPayloadPreview: summarizePayload(body),
          });
        }

        addEvent(dossier, {
          type: "AI_DECISION",
          actor: { kind: "SYSTEM", label: String((req as any).adminEmail || "Admin") },
          message: `Étude PDF générée via parcours Sésame (${produitSlug}).`,
          meta: { template: "SESAME_STUDY_PDF", codeProduit: produitSlug },
        });
        await deps.writeDB(db, dossier);

        return res.json({
          success: true,
          computation: result.computation,
          studyDraft: result.studyDraft,
          studyKpi: result.studyKpi,
          studyPdf: result.studyPdf,
          parsed: result.parsed,
          feasibility: result.feasibility || null,
          downloadUrl: `/api/admin/dossiers/${dossier.id}/study-pdf?download=1`,
          devisDocId: doc.id,
          catalogAuto: { resolved, note },
          workflow: (dossier as any).sesameStudyWorkflow,
        });
      } catch (err: any) {
        console.error("[study-workflow/generate-study]", err?.message || err);
        const status = /désactivé|production/i.test(err?.message || "")
          ? 403
          : /manquants|Credentials/i.test(err?.message || "")
            ? 503
            : 500;
        return res.status(status).json({ error: err?.message || "Erreur génération étude Sésame" });
      }
    },
  );

  /** État courant du parcours. */
  app.get("/api/admin/dossiers/:id/study-workflow", async (req: Request, res: Response) => {
    await deps.ensureBackgroundServicesStarted();
    const { dossier } = await loadDossier(deps, req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    return res.json({
      success: true,
      workflow: (dossier as any).sesameStudyWorkflow || null,
      kereisDraft: (dossier as any).kereisDraft || null,
      feasibility: (dossier as any).adeStudyFeasibility || null,
      sesameStatus: getSesameConfigStatus(),
    });
  });
}
