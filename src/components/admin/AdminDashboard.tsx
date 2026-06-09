import React, { useState, useEffect } from "react";
import { Dossier, UserInfo } from "../../types";
import { LogOut, Search, MessageSquareText, Mail, Send, Eye, FileText, Download, CheckCircle, AlertTriangle, CalendarClock, ListTodo, Bell, Sparkles, Upload } from "lucide-react";
import { showToast } from "../../lib/toast";
import { getApiUrl } from "../../lib/utils";
import { getAccessToken } from "../../lib/auth";
import {
  computeDocumentChecklistForDossier,
  getAdminChecklistOverrides,
} from "../../lib/documentChecklist";
import { QUALITE_OPTIONS, STATUT_PRO_OPTIONS, PROFESSION_RISQUE_OPTIONS, DEPLACEMENTS_PRO_OPTIONS } from "../../constants";
import {
  AdminActivityBar,
  AdminWorkQueuePanel,
  AdminCamillePanel,
  AdminCamilleKnowledgePanel,
  AdminOpsDailyReportPanel,
  useAdminOpsData,
} from "./AdminOpsPanel";
import AdminDossierBannerControls from "./AdminDossierBannerControls";
import { isVisibleAdminDossier } from "../../../shared/camilleMeta";

export default function AdminDashboard({ user, onLogout }: { user: UserInfo; onLogout: () => void; }) {
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [search, setSearch] = useState("");
  const [selectedDossier, setSelectedDossier] = useState<Dossier | null>(null);
  const [activeTab, setActiveTab] = useState<"SUIVI" | "MESSAGES" | "INFORMATIONS" | "DOCUMENTS" | "ENVOI_MAIL">("SUIVI");
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [autoSyncGmail, setAutoSyncGmail] = useState(true);
  
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [showDeleteConfirmId, setShowDeleteConfirmId] = useState<string | null>(null);

  const [emailSubject, setEmailSubject] = useState("");
  const [emailHtml, setEmailHtml] = useState("");
  const [economyStatus, setEconomyStatus] = useState<{ reliability?: string; reasons?: string[] } | null>(null);
  const [uploadDocCategory, setUploadDocCategory] = useState("auto");
  const [previewActive, setPreviewActive] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState<any[] | null>(null);
  const [sidebarMode, setSidebarMode] = useState<"dossiers" | "queue">("queue");
  const { metrics } = useAdminOpsData();
  const [driveDiagnostic, setDriveDiagnostic] = useState<{
    summary: string;
    parentOk: boolean;
    email?: string | null;
    parentName?: string;
    rawEnvParentId?: string | null;
    effectiveParentId?: string | null;
    autoCorrected?: boolean;
  } | null>(null);

  const LEGACY_DRIVE_PARENT_ID = "0ALC2kSJGmwXjUk9PVA";
  const isStaleLegacyDriveError = (err?: string) =>
    Boolean(err?.includes(LEGACY_DRIVE_PARENT_ID));

  useEffect(() => {
    if (!selectedDossier) return;
    const clientName = selectedDossier.formData?.assures?.[0]?.prenom || "Client";
    const draft = (selectedDossier as Dossier & { studyDraft?: { subject?: string; html?: string } })
      .studyDraft;
    setEmailSubject(
      draft?.subject || `${clientName}, votre étude personnalisée - Assurance Emprunteur`,
    );
    setEmailHtml(draft?.html || "");
    setPreviewActive(false);
  }, [selectedDossier?.id, (selectedDossier as any)?.studyDraft?.computedAt]);

  const loadDossiers = async () => {
    try {
      const res = await fetch(getApiUrl("/api/dossiers"));
      if (res.ok) {
        const data = await res.json();
        const filteredData = user.role === 'CONSEILLER'
          ? data.filter((d: Dossier) => d.formData?.assures?.[0]?.email === user.email || (d as any).uid === user.uid)
          : data;
        setDossiers(filteredData);
        setSelectedDossier((prev) => {
          if (!prev) return null;
          if (!isVisibleAdminDossier(prev.id)) return null;
          return filteredData.find((d: Dossier) => d.id === prev.id) || prev;
        });
      }
    } catch (err) {
      showToast("Erreur de chargement", "error");
    }
  };

  const authHeaders = async (json = true): Promise<HeadersInit> => {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (json) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const labelFromOptions = (value: string, options: { value: string; label: string }[]) =>
    options.find((o) => o.value === value)?.label || value || "-";

  useEffect(() => {
    loadDossiers();
    const interval = setInterval(loadDossiers, 60000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto Gmail sync (dashboard ouvert) — 2 min, 24h/24
  useEffect(() => {
    if (!autoSyncGmail) return;
    const interval = setInterval(() => {
      handleSyncGmail().catch(() => undefined);
    }, 120_000);
    return () => clearInterval(interval);
  }, [autoSyncGmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      await fetch(getApiUrl(`/api/dossiers/${id}/status`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      loadDossiers();
    } catch (e) {
      showToast("Erreur status", "error");
    }
  };

  const handleReanalyzeDocuments = async (dossierId?: string) => {
    const id = dossierId || selectedDossier?.id;
    if (!id) return;
    try {
      showToast("Réanalyse OCR en cours…", "info");
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${id}/reanalyze-documents`), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const missing = (data.documents || []).filter(
          (d: { analyzed?: boolean; skipReason?: string }) => !d.analyzed,
        );
        const driveN = data.driveFetchedCount ?? 0;
        showToast(
          data.analyzedCount
            ? `${data.analyzedCount} document(s) réanalysé(s)` +
                (data.ocrCount ? `, dont ${data.ocrCount} via OCR` : "") +
                (driveN ? `, ${driveN} récupéré(s) depuis Drive` : "")
            : missing.length
              ? `Aucune analyse : ${missing.map((d: { name?: string; skipReason?: string }) => `${d.name} (${d.skipReason})`).join(", ")}`
              : "Aucun document de prêt à analyser",
          data.analyzedCount ? "success" : "error",
        );
        loadDossiers();
      } else {
        showToast(data.error || "Erreur réanalyse", "error");
      }
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleReanalyzeAllDocuments = async () => {
    if (!confirm("Réanalyser les documents de prêt de tous les dossiers ? (OCR si scan — peut prendre plusieurs minutes)")) {
      return;
    }
    try {
      showToast("Réanalyse globale lancée…", "info");
      const res = await fetch(getApiUrl("/api/admin/reanalyze-documents"), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(
          `${data.dossiersProcessed || 0} dossier(s) — ${data.totalAnalyzed || 0} doc(s), ${data.totalOcr || 0} OCR` +
            (data.missingFiles ? ` — ${data.missingFiles} fichier(s) manquant(s)` : ""),
          "success",
        );
        loadDossiers();
      } else {
        showToast(data.error || "Erreur réanalyse globale", "error");
      }
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleResyncAttachments = async () => {
    if (!selectedDossier) return;
    const token = await getAccessToken();
    if (!token) {
      showToast("Connexion Google requise. Reconnectez-vous puis réessayez.", "error");
      return;
    }
    try {
      showToast("Récupération des pièces jointes Gmail...", "info");
      const res = await fetch(
        getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/resync-attachments`),
        { method: "POST", headers: await authHeaders(), body: JSON.stringify({}) },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const errHint =
          data.errors?.length > 0 ? ` Erreurs : ${data.errors.slice(0, 2).join(" | ")}` : "";
        const driveHint =
          data.driveUploaded > 0
            ? ` ${data.driveUploaded} copie(s) sur Drive.`
            : !data.hasDriveFolder && data.added?.length
              ? " Créez le dossier Drive (bouton Drive) puis relancez."
              : "";
        const dedupeHint =
          data.dedupeRemoved > 0
            ? ` ${data.dedupeRemoved} doublon(s) retiré(s) du dossier.`
            : "";
        const driveUploadHint =
          data.driveUploaded === 0 && data.attachmentPartsFound > 0
            ? " Aucune nouvelle copie Drive."
            : "";
        const msg =
          data.added?.length > 0
            ? `${data.added.length} fichier(s) ajouté(s) : ${data.added.join(", ")}.${dedupeHint}${driveHint}`
            : data.attachmentPartsFound > 0
              ? `${data.attachmentPartsFound} PJ détectée(s) — déjà importées, ignorées.${dedupeHint}${driveUploadHint}${driveHint}${errHint}`
              : `Aucune PJ (${data.scanned || 0} mail(s) scanné(s)).${dedupeHint}${driveHint}${errHint}`;
        showToast(msg, data.added?.length ? "success" : "info");
        loadDossiers();
      } else {
        showToast(data.error || "Erreur récupération PJ", "error");
      }
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleSeedGmailImports = async () => {
    if (!selectedDossier) return;
    const token = await getAccessToken();
    if (!token) {
      showToast("Connexion Google requise.", "error");
      return;
    }
    try {
      const res = await fetch(
        getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/seed-gmail-imports`),
        { method: "POST", headers: await authHeaders(), body: JSON.stringify({}) },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Échec enregistrement registre Gmail", "error");
        return;
      }
      showToast(
        `${data.messagesMarked || 0} mail(s) marqué(s) comme déjà importés (${data.scanned || 0} scannés). Les prochains syncs ne recréeront pas les PJ.`,
        "success",
      );
      loadDossiers();
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleComputeEconomyDraft = async () => {
    if (!selectedDossier) return;
    try {
      showToast("Génération du brouillon en cours...", "info");
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/compute-economy`), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Erreur calcul économies", "error");
        return;
      }
      const reliability = data?.computation?.reliability;
      const reasons = data?.computation?.reasons || [];
      setEconomyStatus({ reliability, reasons });
      if (data?.draft?.subject) setEmailSubject(data.draft.subject);
      if (data?.draft?.html) setEmailHtml(data.draft.html);
      showToast(
        reliability === "HIGH"
          ? "Brouillon prêt. Vérifiez puis envoyez au client."
          : `Brouillon généré (fiabilité ${reliability || "?"}). À vérifier avant envoi.`,
        "success",
      );
      loadDossiers();
    } catch {
      showToast("Erreur calcul économies", "error");
    }
  };

  const handleUploadQuote = async (file: File) => {
    if (!selectedDossier) return;
    try {
      const fd = new FormData();
      fd.append("quote", file);
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/quote`), {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Erreur upload devis", "error");
        return;
      }
      showToast("Devis ajouté (un seul devis actif).", "success");
      loadDossiers();
    } catch {
      showToast("Erreur upload devis", "error");
    }
  };

  const handleUploadDocument = async (file: File) => {
    if (!selectedDossier) return;
    try {
      const fd = new FormData();
      fd.append("document", file);
      fd.append("category", uploadDocCategory);
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/documents`), {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Erreur lors de l'ajout du document", "error");
        return;
      }
      if (data.driveWarning) {
        showToast(data.driveWarning, "info");
      } else if (data.document?.driveLink) {
        showToast("Document ajouté et copié sur Drive.", "success");
      } else {
        showToast("Document ajouté au dossier.", "success");
      }
      loadDossiers();
    } catch {
      showToast("Erreur lors de l'ajout du document", "error");
    }
  };

  const handleReclassifyDocument = async (docId: string, category: string) => {
    if (!selectedDossier) return;
    try {
      const res = await fetch(
        getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/documents/${encodeURIComponent(docId)}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Impossible de reclasser le document", "error");
        return;
      }
      showToast(`Type mis à jour : ${category}`, "success");
      loadDossiers();
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleDeleteQuote = async () => {
    if (!selectedDossier) return;
    try {
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/quote`), {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Erreur suppression devis", "error");
        return;
      }
      showToast("Devis supprimé.", "success");
      loadDossiers();
    } catch {
      showToast("Erreur suppression devis", "error");
    }
  };

  const handleSyncGmail = async () => {
    const token = await getAccessToken();
    if (!token) {
      showToast("Connexion Google requise. Reconnectez-vous puis réessayez.", "error");
      return;
    }
    try {
      showToast("Synchronisation Gmail en cours...", "info");
      const res = await fetch(getApiUrl("/api/admin/sync-emails"), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(
          `Gmail : ${data.processed || 0} message(s), ${data.inbound || 0} reçu(s) client` +
            (data.attachmentsSaved ? `, ${data.attachmentsSaved} PJ enregistrée(s)` : "") +
            (data.driveAttachmentsUploaded
              ? `, ${data.driveAttachmentsUploaded} sur Drive`
              : "") +
            (data.aiReplies ? `, ${data.aiReplies} réponse(s) IA` : ""),
          "success",
        );
        loadDossiers();
      } else {
        showToast(data.error || "Erreur sync Gmail", "error");
      }
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleDriveCheck = async () => {
    const token = await getAccessToken();
    if (!token) {
      showToast("Connexion Google manquante. Déconnectez-vous puis reconnectez-vous.", "error");
      return;
    }
    try {
      showToast("Test Drive en cours...", "info");
      const res = await fetch(getApiUrl("/api/admin/drive-check"), {
        headers: await authHeaders(false),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDriveDiagnostic({ summary: data.error || data.hint || "Erreur", parentOk: false });
        showToast(data.error || data.hint || "Diagnostic Drive impossible", "error");
        return;
      }
      setDriveDiagnostic({
        summary: data.summary || "",
        parentOk: Boolean(data.parentOk),
        email: data.email,
        parentName: data.parent?.name,
        rawEnvParentId: data.rawEnvParentId,
        effectiveParentId: data.effectiveParentId,
        autoCorrected: data.autoCorrectedParent,
      });
      showToast(data.summary || "Diagnostic terminé", data.parentOk ? "success" : "error");
    } catch {
      showToast("Erreur diagnostic Drive", "error");
    }
  };

  const handleValidateChecklistItem = async (key: string, validate: boolean) => {
    if (!selectedDossier) return;
    try {
      const method = validate ? "POST" : "DELETE";
      const res = await fetch(
        getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/checklist/${key}/validate`),
        {
          method,
          headers: await authHeaders(),
          body: validate ? JSON.stringify({ author: user.email }) : undefined,
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(
          validate ? "Document validé manuellement" : "Validation manuelle retirée",
          "success",
        );
        loadDossiers();
      } else {
        showToast(data.error || "Impossible de mettre à jour le statut", "error");
      }
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleExportDrive = async () => {
    if (!selectedDossier) return;
    const token = await getAccessToken();
    if (!token) {
      showToast("Connexion Google manquante (OAuth).", "error");
      return;
    }
    try {
      showToast("Envoi des documents vers Drive...", "info");
      const res = await fetch(getApiUrl(`/api/dossiers/${selectedDossier.id}/retry-workspace`), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.success) {
          const who = data.connectedEmail ? ` (${data.connectedEmail})` : "";
          const where = data.parentFolderName ? ` dans « ${data.parentFolderName} »` : "";
          showToast(
            data.warning
              ? `Drive OK${who} — ${data.warning}`
              : `Dossier créé${where}${who}`,
            data.warning ? "info" : "success",
          );
        } else {
          const who = data.connectedEmail ? ` Compte : ${data.connectedEmail}.` : "";
          showToast((data.error || "Erreur Drive") + who, "error");
        }
        loadDossiers();
      } else {
        showToast(data.error || "Erreur Drive", "error");
      }
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleAddNote = async () => {
    if (!selectedDossier) return;
    const text = newNote.trim();
    if (!text) return;
    try {
      const res = await fetch(getApiUrl(`/api/dossiers/${selectedDossier.id}/notes`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: user.email, text }),
      });
      if (res.ok) {
        setNewNote("");
        showToast("Note ajoutée", "success");
        loadDossiers();
      } else {
        showToast("Impossible d'ajouter la note", "error");
      }
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const taskTypeLabel = (type: string) => {
    switch (type) {
      case "FOLLOWUP_MISSING_DOCS":
        return "Relance pièces manquantes";
      case "FOLLOWUP_NO_REPLY":
        return "Relance sans réponse";
      case "INTERNAL_ALERT":
        return "Alerte interne";
      default:
        return type;
    }
  };

  const eventTypeLabel = (type: string) => {
    switch (type) {
      case "DOSSIER_CREATED":
        return "Dossier créé";
      case "STATUS_CHANGED":
        return "Statut modifié";
      case "NOTE_ADDED":
        return "Note ajoutée";
      case "DOCUMENT_UPLOADED":
        return "Document reçu";
      case "EMAIL_SENT":
        return "Email envoyé";
      case "EMAIL_FAILED":
        return "Email en échec";
      case "REMINDER_SCHEDULED":
        return "Relance planifiée";
      case "REMINDER_SENT":
        return "Relance envoyée";
      case "AI_DECISION":
        return "Camille (IA)";
      default:
        return type;
    }
  };

  const formatEventMeta = (type: string, meta: any) => {
    if (!meta) return null;
    if (type === "EMAIL_SENT" || type === "EMAIL_FAILED") {
      const parts = [
        meta.template ? `Modèle : ${meta.template}` : null,
        meta.to ? `À : ${meta.to}` : null,
        meta.cc ? `Cc : ${meta.cc}` : null,
        meta.subject ? `Objet : ${meta.subject}` : null,
        meta.channel ? `Canal : ${meta.channel}` : null,
        meta.error ? `Erreur : ${meta.error}` : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }
    if (type === "STATUS_CHANGED") {
      return meta.from && meta.to ? `${meta.from} → ${meta.to}` : null;
    }
    if (type === "DOCUMENT_UPLOADED") {
      return meta.source ? `Source : ${meta.source}` : null;
    }
    if (type === "REMINDER_SCHEDULED") {
      const stage = meta.payload?.stage;
      return stage ? `Étape ${stage}` : null;
    }
    if (type === "AI_DECISION") {
      return meta.reason ? String(meta.reason) : null;
    }
    return null;
  };

  const getAlerts = (d: Dossier) => {
    const alerts: { title: string; detail: string }[] = [];
    const checklist = computeDocumentChecklistForDossier(d);
    const missing = checklist.filter(i => !i.ok && (i.key === "cni" || i.key === "rib"));
    if (missing.length) {
      alerts.push({ title: "Pièces bloquantes manquantes", detail: missing.map(m => m.label).join(" · ") });
    }
    const pendingTasks = (d.tasks || []).filter((t: any) => t.status === "PENDING");
    const overdue = pendingTasks.filter((t: any) => new Date(t.dueAt).getTime() < Date.now());
    if (overdue.length) {
      alerts.push({ title: "Relances en retard", detail: `${overdue.length} tâche(s) à exécuter` });
    }
    if ((d as any).workspaceStatus === "FAILED") {
      alerts.push({ title: "Export Drive échoué", detail: (d as any).workspaceError || "Erreur inconnue" });
    }
    return alerts;
  };

  const handleDelete = (id: string) => {
    setShowDeleteConfirmId(id);
  };

  const handleDeleteAction = async (id: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/dossiers/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success !== false) {
        showToast("Dossier supprimé avec succès", "success");
        setSelectedDossier(null);
        loadDossiers();
      } else {
        showToast(
          typeof data?.error === "string" ? data.error : "Erreur lors de la suppression",
          "error",
        );
      }
    } catch (err: any) {
      showToast(err?.message || "Erreur réseau — vérifiez la connexion au serveur", "error");
    }
  };

  const handleSendEmail = async () => {
    if (!selectedDossier) return;

    try {
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/send-email`), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ subject: replySubject, html: replyBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(data.channel === "gmail" ? "Email envoyé via Gmail" : "Email envoyé", "success");
        setReplyBody("");
        loadDossiers();
      } else {
        showToast(data.error || "Erreur d'envoi", "error");
      }
    } catch (e) {
      showToast("Erreur réseau", "error");
    }
  };

  const handleSendPastedEmail = async () => {
    if (!selectedDossier) return;
    if (!emailSubject.trim()) {
      showToast("Veuillez saisir l'objet du mail", "error");
      return;
    }
    if (!emailHtml.trim()) {
      showToast("Veuillez coller le HTML du mail", "error");
      return;
    }

    try {
      showToast("Envoi de l'email en cours...", "info");
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/send-email`), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ subject: emailSubject, html: emailHtml }),
      });
      const errData = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(errData.channel === "gmail" ? "Email client envoyé via Gmail" : "Email client envoyé", "success");
        setEmailHtml("");
        setPreviewActive(false);
        loadDossiers();
      } else {
        showToast(errData.error || "Erreur d'envoi", "error");
      }
    } catch (e) {
      showToast("Erreur réseau", "error");
    }
  };

  const filteredDossiers = dossiers.filter(d => {
    if (!isVisibleAdminDossier(d.id)) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    const p = d.formData?.assures?.[0];
    return (p?.nom?.toLowerCase().includes(s) || p?.prenom?.toLowerCase().includes(s) || d.id.toLowerCase().includes(s));
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <AdminActivityBar metrics={metrics} onReanalyzeAll={handleReanalyzeAllDocuments} />
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold flex items-center gap-4">
          Espace conseiller — Assurance emprunteur
          <button onClick={async () => {
            try {
              showToast("Exécution des relances...", "info");
              const res = await fetch(getApiUrl("/api/admin/run-scheduler"), { method: "POST" });
              const data = await res.json().catch(() => ({}));
              if (res.ok) {
                showToast(`Relances envoyées : ${data.sent || 0} · Échecs : ${data.failed || 0}`, "success");
                loadDossiers();
              } else {
                showToast("Impossible de lancer les relances.", "error");
              }
            } catch {
              showToast("Erreur réseau", "error");
            }
          }} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2">
            <CalendarClock className="w-3.5 h-3.5" />
            Lancer les relances
          </button>
        </h1>
        <button onClick={onLogout} className="flex gap-2 text-slate-500 hover:text-slate-900 transition-colors">
          <LogOut className="w-5 h-5"/> Déconnexion
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-1/3 max-w-sm bg-white border-r border-slate-200 flex flex-col">
          <div className="flex border-b">
            <button
              type="button"
              onClick={() => setSidebarMode("queue")}
              className={`flex-1 py-2 text-xs font-black ${sidebarMode === "queue" ? "bg-amber-50 text-amber-900 border-b-2 border-amber-500" : "text-slate-500"}`}
            >
              À traiter
            </button>
            <button
              type="button"
              onClick={() => setSidebarMode("dossiers")}
              className={`flex-1 py-2 text-xs font-black ${sidebarMode === "dossiers" ? "bg-indigo-50 text-indigo-900 border-b-2 border-indigo-500" : "text-slate-500"}`}
            >
              Tous les dossiers
            </button>
          </div>
          {sidebarMode === "queue" ? (
            <AdminWorkQueuePanel
              authHeaders={authHeaders}
              selectedId={selectedDossier?.id}
              onSelect={(id) => {
                const d = dossiers.find((x) => x.id === id);
                if (d) setSelectedDossier(d);
                setSidebarMode("dossiers");
              }}
            />
          ) : (
            <>
          <div className="p-4 border-b border-slate-100">
            <div className="flex gap-2 items-center bg-slate-100 p-2 rounded-lg">
              <Search className="w-4 h-4 text-slate-400" />
              <input 
                className="bg-transparent border-none outline-none text-sm w-full"
                placeholder="Rechercher (nom, prénom, dossier)..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredDossiers.map(d => (
              <div key={d.id} 
                onClick={() => setSelectedDossier(d)}
                className={`p-4 border-b cursor-pointer transition flex flex-col gap-1 ${selectedDossier?.id === d.id ? 'bg-indigo-50 border-indigo-100' : 'hover:bg-slate-50'}`}>
                <div className="font-bold flex justify-between items-center">
                  <span>{d.formData?.assures?.[0]?.prenom} {d.formData?.assures?.[0]?.nom}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-mono">{d.id}</span>
                  <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">{d.status}</span>
                </div>
              </div>
            ))}
          </div>
            </>
          )}
        </div>

        {/* Main Workspace */}
        <div className="flex-1 overflow-y-auto p-8">
          {selectedDossier ? (
            <div className="space-y-6 max-w-5xl mx-auto">
              <div className="flex justify-between items-start bg-white p-6 rounded-2xl border shadow-sm">
                <div>
                  <h2 className="text-3xl font-black bg-gradient-to-r from-slate-900 to-indigo-900 bg-clip-text text-transparent mb-1">
                    {selectedDossier.formData?.assures?.[0]?.prenom} {selectedDossier.formData?.assures?.[0]?.nom}
                  </h2>
                  <p className="text-slate-500 font-mono text-sm">{selectedDossier.id}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {getAlerts(selectedDossier).slice(0, 3).map((a, idx) => (
                      <span key={idx} className="inline-flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-full text-xs font-bold">
                        <Bell className="w-3.5 h-3.5" /> {a.title}
                      </span>
                    ))}
                  </div>
                </div>
                <AdminDossierBannerControls
                  dossier={selectedDossier}
                  onStatusChange={updateStatus}
                  onPhaseUpdated={loadDossiers}
                  onDelete={handleDelete}
                />
              </div>

              {/* Tabs Navigation */}
              <div className="flex border-b border-slate-200">
                {(["SUIVI", "MESSAGES", "INFORMATIONS", "DOCUMENTS", "ENVOI_MAIL"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === tab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                  >
                    {tab === "SUIVI"
                      ? "Suivi"
                      : tab === "MESSAGES"
                        ? "Échanges"
                        : tab === "ENVOI_MAIL"
                          ? "Envoi Mail"
                          : tab === "INFORMATIONS"
                            ? "Informations"
                            : "Documents"}
                  </button>
                ))}
                <button
                  onClick={async () => {
                    try {
                      setAiSuggestions(null);
                      showToast("Analyse IA en cours...", "info");
                      const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/next-actions`));
                      const data = await res.json().catch(() => ({}));
                      if (res.ok) {
                        setAiSuggestions(data.actions || []);
                        showToast("Suggestions IA prêtes", "success");
                      } else {
                        showToast(data.error || "Erreur IA", "error");
                      }
                    } catch {
                      showToast("Erreur réseau", "error");
                    }
                  }}
                  className="ml-auto px-4 py-2 my-2 mr-2 text-xs font-black rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition flex items-center gap-2"
                  title="Proposer la prochaine action (IA)"
                >
                  <Sparkles className="w-4 h-4" /> IA
                </button>
              </div>

              {activeTab === "SUIVI" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white border rounded-2xl p-6 shadow-sm">
                    <h3 className="font-bold mb-4 text-slate-800 flex items-center gap-2">
                      <ListTodo className="w-4 h-4 text-indigo-600" /> Checklist & notes
                    </h3>
                    <AdminOpsDailyReportPanel />
                    <AdminCamilleKnowledgePanel />
                    <AdminCamillePanel dossier={selectedDossier} onDossierUpdated={loadDossiers} />
                    <div className="mb-4 p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-900">
                      <div className="font-black mb-1">Automatisation Gmail</div>
                      <p>
                        Camille répond aux clients ; les relances respectent un délai anti-spam (pas de doublon si contact récent).
                      </p>
                    </div>
                    <div className="flex gap-3 flex-wrap mb-4">
                      <button
                        onClick={handleSyncGmail}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 px-4 rounded-xl border border-slate-200 text-xs transition-all flex items-center gap-2"
                      >
                        <Mail className="w-4 h-4" /> Synchroniser Gmail
                      </button>
                      <button
                        type="button"
                        onClick={handleResyncAttachments}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold py-2.5 px-4 rounded-xl border border-emerald-200 text-xs transition-all flex items-center gap-2"
                      >
                        <FileText className="w-4 h-4" /> Importer les pièces jointes
                      </button>
                      <button
                        type="button"
                        onClick={handleSeedGmailImports}
                        className="bg-amber-50 hover:bg-amber-100 text-amber-950 font-bold py-2.5 px-4 rounded-xl border border-amber-200 text-xs transition-all"
                        title="Après un gros nettoyage Drive : marque les mails comme déjà traités sans retélécharger"
                      >
                        Bloquer re-imports Gmail
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReanalyzeDocuments()}
                        className="bg-violet-50 hover:bg-violet-100 text-violet-900 font-bold py-2.5 px-4 rounded-xl border border-violet-200 text-xs transition-all flex items-center gap-2"
                        title="Relire offre/tableau (PDF natif + OCR si scan)"
                      >
                        <Sparkles className="w-4 h-4" /> Réanalyser (OCR)
                      </button>
                    <label className="bg-white border border-slate-200 text-slate-700 font-bold py-2.5 px-4 rounded-xl text-xs transition-all flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoSyncGmail}
                        onChange={(e) => setAutoSyncGmail(e.target.checked)}
                      />
                      Auto (20 min)
                    </label>
                      {!(selectedDossier as any).workspaceFolderId ||
                      (selectedDossier as any).workspaceStatus === "FAILED" ? (
                        <button
                          onClick={handleExportDrive}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all flex items-center gap-2"
                        >
                          <FileText className="w-4 h-4" />
                          {(selectedDossier as any).workspaceStatus === "FAILED"
                            ? "Recréer Drive"
                            : "Créer dossier Drive"}
                        </button>
                      ) : (
                        <a
                          href={`https://drive.google.com/drive/folders/${(selectedDossier as any).workspaceFolderId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-900 font-bold py-2.5 px-4 rounded-xl border border-indigo-200 text-xs transition-all flex items-center gap-2"
                        >
                          <FileText className="w-4 h-4" /> Ouvrir Drive
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={handleDriveCheck}
                        className="bg-white border border-slate-200 text-slate-700 font-bold py-2.5 px-4 rounded-xl text-xs hover:bg-slate-50"
                      >
                        Vérifier Drive
                      </button>
                    </div>
                    {driveDiagnostic && (
                      <div
                        className={`mb-4 p-4 rounded-xl border text-xs ${
                          driveDiagnostic.parentOk
                            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                            : "bg-amber-50 border-amber-200 text-amber-900"
                        }`}
                      >
                        <div className="font-black mb-1">
                          {driveDiagnostic.parentOk ? "Drive prêt" : "Drive à corriger"}
                        </div>
                        <p>{driveDiagnostic.summary}</p>
                        {driveDiagnostic.autoCorrected && (
                          <p className="mt-2 font-semibold text-amber-800">
                            Railway : {driveDiagnostic.rawEnvParentId} → corrigé en {driveDiagnostic.effectiveParentId}
                          </p>
                        )}
                        {driveDiagnostic.parentOk && driveDiagnostic.parentName && (
                          <p className="mt-2 font-semibold">
                            Dossier cible : {driveDiagnostic.parentName}
                          </p>
                        )}
                      </div>
                    )}
                    {aiSuggestions && aiSuggestions.length > 0 && (
                      <div className="mb-6 bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
                        <div className="flex items-center gap-2 font-black text-indigo-900 mb-3">
                          <Sparkles className="w-4 h-4" /> Prochaines actions (IA)
                        </div>
                        <div className="space-y-2">
                          {aiSuggestions.map((a: any, idx: number) => (
                            <div key={idx} className="bg-white border border-indigo-100 rounded-xl p-4">
                              <div className="text-xs font-black text-slate-600">{a.kind} · {a.auto ? "AUTO" : "ASSISTÉ"}</div>
                              <div className="text-sm font-semibold text-slate-900 mt-1">{a.reason}</div>
                              {a.kind === "SEND_EMAIL" && (
                                <div className="mt-2 text-xs text-slate-600">
                                  <div><span className="font-bold">À:</span> {a.to}</div>
                                  <div><span className="font-bold">Objet:</span> {a.subject}</div>
                                  <div className="mt-3 flex justify-end">
                                    <button
                                      className="text-xs font-black bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition"
                                      onClick={async () => {
                                        try {
                                          showToast("Envoi IA en cours...", "info");
                                          const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/send-email`), {
                                            method: "POST",
                                            headers: await authHeaders(),
                                            body: JSON.stringify({ subject: a.subject, html: a.html }),
                                          });
                                          const data = await res.json().catch(() => ({}));
                                          if (res.ok) {
                                            showToast("Email envoyé via Gmail", "success");
                                            loadDossiers();
                                          } else {
                                            showToast(data.error || "Erreur d'envoi IA", "error");
                                          }
                                        } catch {
                                          showToast("Erreur réseau", "error");
                                        }
                                      }}
                                      title="Appliquer la suggestion (envoi email)"
                                    >
                                      Appliquer (envoyer)
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {aiSuggestions && aiSuggestions.length === 0 && (
                      <div className="mb-6 bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm text-slate-600">
                        Aucune suggestion IA pour ce dossier pour le moment.
                      </div>
                    )}
                    <div className="space-y-2 mb-6">
                      {computeDocumentChecklistForDossier(selectedDossier).map((item) => {
                        const adminOverrides = getAdminChecklistOverrides(selectedDossier);
                        const manualOk = adminOverrides[item.key]?.status === "ok";
                        const st = item.status ?? (item.ok ? "ok" : "missing");
                        const boxClass =
                          st === "ok"
                            ? "bg-emerald-50 border-emerald-200"
                            : st === "review"
                              ? "bg-amber-50 border-amber-200"
                              : "bg-slate-50 border-slate-200";
                        const badgeClass =
                          st === "ok"
                            ? "bg-emerald-600 text-white"
                            : st === "review"
                              ? "bg-amber-500 text-white"
                              : "bg-slate-200 text-slate-700";
                        const badgeLabel =
                          st === "ok" ? "OK" : st === "review" ? "À vérifier" : "MANQUANT";
                        const fileClass =
                          st === "review" ? "text-amber-900/90" : st === "ok" ? "text-emerald-800/90" : "text-slate-600";
                        // Offre / tableau en « À vérifier » : item.ok est souvent false — il faut quand même pouvoir valider.
                        const showChecklistValidateActions = manualOk || st !== "ok";
                        return (
                        <div key={item.key} className={`p-3 rounded-xl border ${boxClass}`}>
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="text-sm font-semibold text-slate-800">{item.label}</div>
                            <div className="flex items-center gap-2 shrink-0">
                              {showChecklistValidateActions && (
                                manualOk ? (
                                  <button
                                    type="button"
                                    onClick={() => handleValidateChecklistItem(item.key, false)}
                                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                  >
                                    Annuler validation
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleValidateChecklistItem(item.key, true)}
                                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1"
                                  >
                                    <CheckCircle className="w-3 h-3" /> Valider
                                  </button>
                                )
                              )}
                              <div className={`text-xs font-black px-2 py-1 rounded-full ${badgeClass}`}>
                                {manualOk ? "VALIDÉ (vous)" : badgeLabel}
                              </div>
                            </div>
                          </div>
                          {item.reviewHint && st !== "ok" && (
                            <p className="mt-1.5 text-[11px] font-semibold text-amber-800 leading-snug">
                              {item.reviewHint}
                            </p>
                          )}
                          {st === "ok" && item.reviewHint && (
                            <p className="mt-1.5 text-[11px] text-emerald-800 leading-snug">{item.reviewHint}</p>
                          )}
                          {item.files && item.files.length > 0 ? (
                            <ul className="mt-2 space-y-1.5">
                              {item.files.map((f) => {
                                const fSt = f.status;
                                const fBadge =
                                  fSt === "ok"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : fSt === "review"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-slate-100 text-slate-600";
                                return (
                                  <li
                                    key={f.docId}
                                    className="text-[11px] rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5"
                                  >
                                    <div className="flex justify-between gap-2 items-start">
                                      <span className="font-medium text-slate-800 truncate" title={f.name}>
                                        {f.name}
                                      </span>
                                      <span className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${fBadge}`}>
                                        {fSt === "ok" ? "OK" : fSt === "review" ? "À vérifier" : "—"}
                                      </span>
                                    </div>
                                    {f.category && f.category !== item.key && (
                                      <p className="text-[10px] text-slate-500 mt-0.5">Type : {f.category}</p>
                                    )}
                                    {f.reviewHint && (
                                      <p className="text-[10px] text-amber-800 mt-0.5 leading-snug">{f.reviewHint}</p>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            item.ok &&
                            item.matchedFiles &&
                            item.matchedFiles.length > 0 && (
                              <p
                                className={`mt-1.5 text-[11px] truncate ${fileClass}`}
                                title={item.matchedFiles.join(", ")}
                              >
                                Fichier : {item.matchedFiles.join(", ")}
                              </p>
                            )
                          )}
                        </div>
                        );
                      })}
                    </div>
                    <div className="mb-6 text-xs text-slate-600">
                      <div className="font-black text-slate-700 mb-1">Export Drive</div>
                      {(selectedDossier as any).workspaceStatus ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`px-2 py-1 rounded-full font-black ${
                            (selectedDossier as any).workspaceStatus === "SUCCESS"
                              ? "bg-emerald-100 text-emerald-800"
                              : (selectedDossier as any).workspaceStatus === "FAILED"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                          }`}>
                            {(selectedDossier as any).workspaceStatus}
                          </span>
                          {(selectedDossier as any).workspaceFolderId && (
                            <a
                              className="underline font-bold text-indigo-700"
                              href={`https://drive.google.com/drive/folders/${(selectedDossier as any).workspaceFolderId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ouvrir le dossier
                            </a>
                          )}
                          {(selectedDossier as any).workspaceError && (
                            <span className="text-red-700">
                              {(selectedDossier as any).workspaceError}
                              {isStaleLegacyDriveError((selectedDossier as any).workspaceError) && (
                                <span className="block mt-1 text-amber-800 font-semibold">
                                  Message obsolète (ancien dossier Drive). Utilisez « Recréer Drive » si l'export a échoué, ou « Vérifier Drive » pour valider la configuration.
                                </span>
                              )}
                            </span>
                          )}
                          {(selectedDossier as any).workspaceWarning && (
                            <span className="text-amber-700">{(selectedDossier as any).workspaceWarning}</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-slate-500 italic">Pas encore exporté sur Drive. Cliquez sur « Drive ».</div>
                      )}
                    </div>
                    <div className="space-y-3">
                      <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        className="w-full text-sm border-2 border-slate-200 p-3 rounded-xl h-28 focus:border-indigo-500 focus:outline-none transition-colors resize-none"
                        placeholder="Ajouter une note interne (ex: appel client, pièces manquantes, décision...)"
                      />
                      <div className="flex justify-end">
                        <button
                          onClick={handleAddNote}
                          disabled={!newNote.trim()}
                          className="bg-slate-900 text-white font-bold py-2.5 px-5 rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-all"
                        >
                          Ajouter la note
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 border-t pt-5 space-y-3">
                      {(selectedDossier.notes || []).slice().reverse().map((n: any) => (
                        <div key={n.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                          <div className="flex justify-between text-xs text-slate-500 font-medium">
                            <span>{n.author || "ADMIN"}</span>
                            <span>{n.at ? new Date(n.at).toLocaleString() : ""}</span>
                          </div>
                          <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
                        </div>
                      ))}
                      {!(selectedDossier.notes || []).length && (
                        <div className="text-sm text-slate-400 border border-dashed rounded-xl p-6 text-center bg-slate-50">
                          Aucune note interne pour le moment.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white border rounded-2xl p-6 shadow-sm">
                    <h3 className="font-bold mb-4 text-slate-800">Relances & historique</h3>
                    <div className="mb-5 space-y-2">
                      {(selectedDossier.tasks || []).slice().reverse().map((t: any) => (
                        <div key={t.id} className="flex items-center justify-between p-3 rounded-xl border bg-slate-50 border-slate-200">
                          <div>
                            <div className="text-xs font-black text-slate-800">{taskTypeLabel(t.type)}</div>
                            <div className="text-xs text-slate-500">
                              {t.dueAt ? new Date(t.dueAt).toLocaleString() : ""} ·{" "}
                              <span className={`font-black ${
                                t.status === "PENDING" ? "text-amber-700" : t.status === "DONE" ? "text-emerald-700" : "text-slate-500"
                              }`}>
                                {t.status}
                              </span>
                              {t.lastError ? <span className="text-red-700"> · {t.lastError}</span> : null}
                            </div>
                          </div>
                          <div className="text-xs font-bold text-slate-600">{t.attempts || 0} essai(s)</div>
                        </div>
                      ))}
                      {!(selectedDossier.tasks || []).length && (
                        <div className="text-sm text-slate-400 border border-dashed rounded-xl p-6 text-center bg-slate-50">
                          Aucune relance planifiée.
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 max-h-[520px] overflow-y-auto pr-2">
                      {(selectedDossier.eventLog || []).slice().reverse().map((evt: any) => (
                        <div key={evt.id} className="flex gap-3 items-start">
                          <div className="mt-2 w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                          <div className="flex-1 border border-slate-200 rounded-xl p-4 bg-white">
                            <div className="flex justify-between items-start gap-3">
                              <div className="text-xs font-black uppercase tracking-widest text-slate-500">
                                {eventTypeLabel(evt.type)}
                              </div>
                              <div className="text-xs text-slate-400 font-medium">
                                {evt.at ? new Date(evt.at).toLocaleString() : ""}
                              </div>
                            </div>
                            {evt.message && (
                              <div className="mt-2 text-sm text-slate-800">{evt.message}</div>
                            )}
                            {formatEventMeta(evt.type, evt.meta) && (
                              <p className="mt-2 text-xs text-slate-600">{formatEventMeta(evt.type, evt.meta)}</p>
                            )}
                            {evt.meta && !formatEventMeta(evt.type, evt.meta) && evt.type !== "REMINDER_SCHEDULED" && (
                              <pre className="mt-2 text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-700">
                                {JSON.stringify(evt.meta, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))}
                      {!(selectedDossier.eventLog || []).length && (
                        <div className="text-sm text-slate-400 border border-dashed rounded-xl p-6 text-center bg-slate-50">
                          Aucun événement enregistré.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "MESSAGES" && (
                <>
                  {/* Alertes / Suivi Intel */}
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
                    <h3 className="font-bold text-amber-800 flex gap-2 items-center mb-4">Alertes / Opportunités IA</h3>
                    <ul className="list-disc pl-5 text-sm text-amber-700 space-y-2">
			{(selectedDossier.workspaceWarning || selectedDossier.extractedData?.warning) ? (
                        <li><AlertTriangle className="inline w-4 h-4 mr-1"/> {selectedDossier.workspaceWarning || selectedDossier.extractedData?.warning}</li>
                      ) : (
                        <li>Nouveau dossier — Pensez à vérifier que les documents sont valides.</li>
                      )}
                      <li>L'IA vérifiera automatiquement les mails pour alerter en cas de questions bloquantes.</li>
                      <li>Délai Loi Lemoine: Aucune alerte de délai non respecté par la banque actuellement.</li>
                    </ul>
                  </div>

                  {/* CRM Messages */}
                  <div className="bg-white border rounded-2xl p-6 shadow-sm">
                    <h3 className="font-bold flex gap-2 items-center mb-2 text-slate-800">
                      <Mail className="w-5 h-5 text-indigo-600"/> Historique des échanges
                    </h3>
                    <p className="text-xs text-slate-500 mb-4">
                      Cliquez sur <strong>Synchroniser Gmail</strong> dans l’onglet Suivi pour importer les emails reçus et envoyés (30 derniers jours).
                      Si la sync échoue, déconnectez-vous puis reconnectez-vous à Google pour autoriser la lecture Gmail.
                    </p>

                    <div className="space-y-4 mb-6 max-h-[400px] overflow-y-auto pr-2">
                      {(selectedDossier as any).communications?.map((c: any) => (
                        <div key={c.id} className={`p-5 rounded-2xl border ${c.direction === 'inbound' ? 'bg-slate-50 border-slate-200 mr-12' : 'bg-indigo-50 border-indigo-100 ml-12'}`}>
                          <div className="flex justify-between items-center mb-3">
                            <div className={`text-[10px] font-black uppercase tracking-widest ${c.direction === 'inbound' ? 'text-slate-500' : 'text-indigo-500'}`}>
                              {c.direction === 'inbound' ? `Reçu de ${c.from}` : `Envoyé à ${c.to}`}
                            </div>
                            <div className="text-xs text-slate-400 font-medium">
                              {new Date(c.date).toLocaleString()}
                            </div>
                          </div>
                          <div className="font-medium text-sm mb-2 text-slate-900">{c.subject}</div>
                          {c.attachments?.length > 0 && (
                            <div className="text-xs font-semibold text-emerald-700 mb-2 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                              Pièces jointes enregistrées : {c.attachments.map((a: any) => a.name).join(" · ")}
                            </div>
                          )}
                          {/<[a-z][\s\S]*>/i.test(c.text) ? (
                            <div 
                              className="text-sm text-slate-700 overflow-x-auto p-4 bg-white rounded border"
                              dangerouslySetInnerHTML={{ __html: c.text }}
                            />
                          ) : (
                            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{c.text}</div>
                          )}
                        </div>
                      ))}
                      {!(selectedDossier as any).communications?.length && (
                        <div className="text-sm text-slate-400 border border-dashed rounded-xl p-8 text-center bg-slate-50">
                          Aucune communication trouvée pour ce dossier.
                        </div>
                      )}
                    </div>

                    <div className="border-t pt-6 space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Sujet du mail</label>
                        <input 
                          placeholder="Sujet de votre message..."
                          value={replySubject}
                          onChange={e => setReplySubject(e.target.value)}
                          className="w-full text-sm border-2 border-slate-200 p-3 rounded-xl focus:border-indigo-500 focus:outline-none transition-colors"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Corps du message</label>
                          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer text-slate-600">
                            <input 
                              type="checkbox" 
                              checked={showHtmlPreview} 
                              onChange={(e) => setShowHtmlPreview(e.target.checked)}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            Aperçu HTML
                          </label>
                        </div>
                        {showHtmlPreview ? (
                          <div 
                            className="w-full text-sm border-2 border-slate-200 p-3 rounded-xl h-64 overflow-y-auto bg-white mb-2"
                            dangerouslySetInnerHTML={{ __html: replyBody || '<span class="text-slate-400 italic">Vide...</span>' }}
                          />
                        ) : (
                          <textarea 
                            placeholder="Tapez (ou collez) la réponse au client..."
                            value={replyBody}
                            onChange={e => setReplyBody(e.target.value)}
                            className="w-full text-sm border-2 border-slate-200 p-3 rounded-xl h-64 focus:border-indigo-500 focus:outline-none transition-colors resize-none mb-2 font-mono"
                          />
                        )}
                      </div>
                      <div className="flex justify-end">
                        <button 
                          onClick={handleSendEmail} 
                          disabled={!replyBody.trim()}
                          className="bg-indigo-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all flex gap-3 items-center"
                        >
                          <Send className="w-4 h-4"/> 
                          Envoyer avec Gmail
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "INFORMATIONS" && (
                <div className="bg-white border rounded-2xl p-6 shadow-sm">
                  <h3 className="font-bold flex gap-2 items-center mb-6 text-slate-800">
                    <CheckCircle className="w-5 h-5 text-indigo-600"/> Données du Formulaire
                  </h3>
                  <div className="space-y-6">
                    <div className="bg-slate-50 border rounded-xl p-4 text-sm">
                      <span className="text-slate-500 block text-xs font-bold uppercase">Objet de financement</span>
                      <span className="text-slate-900 font-semibold">{selectedDossier.formData?.objetFinancement || "-"}</span>
                    </div>

                    {selectedDossier.formData?.assures?.map((assure: any, idx: number) => (
                      <div key={idx} className="bg-slate-50 border rounded-xl p-5">
                        <h4 className="font-bold text-slate-800 mb-4 border-b pb-2">
                          Assuré(e) {idx + 1} : {assure.civilite} {assure.prenom} {assure.nom}
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                          <div><span className="text-slate-500 block text-xs">Qualité</span>{labelFromOptions(assure.qualite, QUALITE_OPTIONS)}</div>
                          <div><span className="text-slate-500 block text-xs">Email</span>{assure.email || "-"}</div>
                          <div><span className="text-slate-500 block text-xs">Téléphone</span>{assure.telephone || "-"}</div>
                          <div><span className="text-slate-500 block text-xs">Date de naissance</span>{assure.dateNaissance || "-"}</div>
                          <div><span className="text-slate-500 block text-xs">Pays de résidence</span>{assure.paysResidence || "-"}</div>
                          <div><span className="text-slate-500 block text-xs">Code postal</span>{assure.cpResidence || "-"}</div>
                          <div><span className="text-slate-500 block text-xs">Statut professionnel</span>{labelFromOptions(assure.statutPro, STATUT_PRO_OPTIONS)}</div>
                          <div><span className="text-slate-500 block text-xs">Profession</span>{assure.profession || "-"}</div>
                          <div><span className="text-slate-500 block text-xs">Profession à risque</span>{labelFromOptions(assure.professionRisque, PROFESSION_RISQUE_OPTIONS)}</div>
                          <div><span className="text-slate-500 block text-xs">Profession manuelle</span>{assure.professionManuelle ? "Oui" : "Non"}</div>
                          <div><span className="text-slate-500 block text-xs">Travaux en hauteur</span>{assure.travauxHauteur ? "Oui" : "Non"}</div>
                          <div><span className="text-slate-500 block text-xs">Déplacements pro</span>{labelFromOptions(assure.deplacementsPro, DEPLACEMENTS_PRO_OPTIONS)}</div>
                          <div><span className="text-slate-500 block text-xs">Sports à risque</span>{assure.sportsRisque ? "Oui" : "Non"}</div>
                          <div className="md:col-span-2"><span className="text-slate-500 block text-xs">Sports déclarés</span>{(assure.selectedSports || []).join(", ") || "-"}</div>
                          <div><span className="text-slate-500 block text-xs">Fumeur</span>{assure.fumeur ? "Oui" : "Non"}</div>
                        </div>
                      </div>
                    ))}

                    {selectedDossier.formData?.prets?.map((pret: any, idx: number) => (
                      <div key={idx} className="bg-indigo-50 border border-indigo-100 rounded-xl p-5">
                        <h4 className="font-bold text-indigo-900 mb-4 border-b border-indigo-200 pb-2">Prêt {idx + 1}</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                          <div><span className="text-indigo-700 block text-xs">Nature du prêt</span>{pret.naturePret || "-"}</div>
                          <div><span className="text-indigo-700 block text-xs">Capital restant dû</span>{pret.capitalRestant ? `${pret.capitalRestant} €` : "-"}</div>
                          <div><span className="text-indigo-700 block text-xs">Banque prêteuse</span>{pret.banquePreteuse || "-"}</div>
                          <div><span className="text-indigo-700 block text-xs">1ère échéance</span>{pret.datePremiereEcheance || "-"}</div>
                          <div><span className="text-indigo-700 block text-xs">Taux</span>{pret.taux ? `${pret.taux} %` : "-"}</div>
                          <div><span className="text-indigo-700 block text-xs">Type de taux</span>{pret.typeTaux || "-"}</div>
                          <div><span className="text-indigo-700 block text-xs">Périodicité</span>{pret.periodicite || "-"}</div>
                          <div><span className="text-indigo-700 block text-xs">Durée restante</span>{pret.dureeRestante ? `${pret.dureeRestante} mois` : "-"}</div>
                          <div><span className="text-indigo-700 block text-xs">Différé amortissement</span>{pret.differeAmortissement ?? "-"}</div>
                          <div className="md:col-span-2"><span className="text-indigo-700 block text-xs">Modalité de remboursement</span>{pret.modaliteRemboursement || "-"}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedDossier.extractedData && (
                     <div className="mt-8 border-t pt-6">
                        <h4 className="font-bold mb-4 text-emerald-800 flex items-center gap-2">
                          <CheckCircle className="w-5 h-5"/> Synthèse de l'expertise (IA)
                        </h4>
                        <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-xl grid grid-cols-2 gap-4 text-sm">
                          {Object.entries(selectedDossier.extractedData).map(([key, value]) => (
                            <div key={key} className={key === 'observations' ? 'col-span-2' : ''}>
                              <span className="text-emerald-700 block text-xs font-bold uppercase mb-1">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                              <span className="text-emerald-950">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                     </div>
                  )}
                </div>
              )}

              {activeTab === "DOCUMENTS" && (
                <div className="bg-white border rounded-2xl p-6 shadow-sm">
                  <h3 className="font-bold flex gap-2 items-center mb-6 text-slate-800">
                    <FileText className="w-5 h-5 text-indigo-600"/> Documents joints
                  </h3>
                  <div className="mb-5 flex flex-col gap-2">
                    <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Devis (1 actif)</div>
                    <div className="flex items-center gap-3">
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUploadQuote(f);
                          e.currentTarget.value = "";
                        }}
                        className="text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleDeleteQuote}
                        className="text-xs font-bold text-slate-600 hover:text-slate-900"
                      >
                        Supprimer le devis
                      </button>
                    </div>
                    <div className="text-xs text-slate-500">
                      Ajoutez ici le PDF du devis. Il sert au suivi interne et au contexte de Camille (sans citer l’assureur au client).
                    </div>
                  </div>
                  <div className="mb-6 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                    <p className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
                      <Upload className="w-4 h-4" /> Ajouter un document au dossier
                    </p>
                    <p className="text-xs text-slate-500 mb-3">
                      Le fichier est enregistré dans le dossier et copié sur Google Drive si le dossier Drive existe déjà.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        value={uploadDocCategory}
                        onChange={(e) => setUploadDocCategory(e.target.value)}
                        className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-2 bg-white"
                      >
                        <option value="auto">Type : détection auto</option>
                        <option value="offre">Offre de prêt</option>
                        <option value="fiche">Fiche standardisée (FSI)</option>
                        <option value="tableau">Tableau d&apos;amortissement</option>
                        <option value="cni">Pièce d&apos;identité</option>
                        <option value="rib">RIB</option>
                        <option value="devis">Devis assureur</option>
                        <option value="autre">Autre</option>
                      </select>
                      <label className="text-xs font-bold bg-[#1E3A8A] hover:bg-[#172554] text-white px-4 py-2 rounded-lg cursor-pointer">
                        Choisir un fichier
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUploadDocument(f);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {selectedDossier.formData?.documents?.length ? (
                      selectedDossier.formData.documents.map((doc, idx) => (
                        <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 border rounded-xl">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-slate-400" />
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-slate-800">{doc.name}</p>
                                {doc.quality && doc.quality.ok === false && (
                                  <span
                                    className="text-[11px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full"
                                    title={(doc.quality.reasons || []).join(" | ")}
                                  >
                                    À vérifier
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500">
                                {(doc.size / 1024).toFixed(1)} KB
                                {(doc as any).category ? ` · ${(doc as any).category}` : ""}
                                {(doc as any).loanSignal?.ocrUsed ? " · OCR" : ""}
                                {(doc as any).loanSignal?.textSource
                                  ? ` · ${(doc as any).loanSignal.textSource === "pdf_native" ? "PDF" : "OCR"}`
                                  : ""}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <label className="text-[10px] font-bold text-slate-600">Type :</label>
                                <select
                                  className="text-[10px] border border-slate-200 rounded-md px-2 py-1 bg-white"
                                  value={String((doc as any).category || "autre")}
                                  onChange={(e) => handleReclassifyDocument(String(doc.id), e.target.value)}
                                >
                                  <option value="offre">Offre de prêt</option>
                                  <option value="fiche">Fiche standardisée</option>
                                  <option value="tableau">Tableau d&apos;amortissement</option>
                                  <option value="cni">Pièce d&apos;identité</option>
                                  <option value="rib">RIB</option>
                                  <option value="devis">Devis</option>
                                  <option value="autre">Autre</option>
                                </select>
                              </div>
                              {(doc as any).loanSignal?.summary && (
                                <p
                                  className={`text-[11px] mt-1 leading-snug ${
                                    (doc as any).loanSignal.ok
                                      ? "text-emerald-800"
                                      : "text-amber-800"
                                  }`}
                                >
                                  {(doc as any).loanSignal.adminLabel || (doc as any).loanSignal.summary}
                                </p>
                              )}
                            </div>
                          </div>
                          <a
                            href={
                              doc.driveLink
                                ? doc.driveLink
                                : getApiUrl(`/api/dossiers/${selectedDossier.id}/documents/${doc.id}/download`)
                            }
                            target={doc.driveLink ? "_blank" : undefined}
                            rel={doc.driveLink ? "noreferrer" : undefined}
                            download={!doc.driveLink ? doc.name : undefined}
                            className="bg-white border text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-500 text-sm italic">Aucun document joint pour le moment.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "ENVOI_MAIL" && (
                <div className="bg-white border rounded-2xl p-6 shadow-sm flex flex-col gap-6">
                  <div>
                    <h3 className="font-bold flex gap-2 items-center text-slate-800 text-base">
                      <Mail className="w-5 h-5 text-indigo-600"/> Envoi au client
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Collez le HTML du mail. L’envoi se fait via votre compte Gmail connecté (assurance@leclubimmobilier.fr).
                    </p>
                    {selectedDossier && (() => {
                      const email = String(selectedDossier.formData?.assures?.[0]?.email || "")
                        .trim()
                        .toLowerCase();
                      const siblings = email
                        ? dossiers.filter(
                            (d) =>
                              d.id !== selectedDossier.id &&
                              String(d.formData?.assures?.[0]?.email || "")
                                .trim()
                                .toLowerCase() === email,
                          )
                        : [];
                      return (
                        <div className="mt-3 space-y-2">
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                            <p className="font-bold">Destinataire de ce dossier</p>
                            <p className="mt-1">
                              <span className="font-mono text-xs">{selectedDossier.id}</span>
                              {" — "}
                              {selectedDossier.formData?.assures?.[0]?.prenom}{" "}
                              {selectedDossier.formData?.assures?.[0]?.nom}
                              {" → "}
                              <strong>{selectedDossier.formData?.assures?.[0]?.email || "email manquant"}</strong>
                            </p>
                            <p className="text-xs mt-1 text-amber-800">
                              L&apos;envoi part toujours vers l&apos;email du dossier ouvert — regénérez le brouillon
                              ici après avoir changé de LCIF.
                            </p>
                          </div>
                          {siblings.length > 0 && (
                            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                              <p className="font-bold">Même email sur plusieurs dossiers</p>
                              <p className="text-xs mt-1">
                                {siblings.map((d) => d.id).join(", ")} — risque d&apos;envoyer l&apos;étude de{" "}
                                {selectedDossier.formData?.assures?.[0]?.prenom} à un autre dossier si vous vous
                                trompez de fiche.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        onClick={handleComputeEconomyDraft}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-colors inline-flex items-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        Calculer économies (auto)
                      </button>
                      {economyStatus?.reliability && (
                        <span className="text-xs font-bold text-slate-600">
                          Fiabilité: <span className="text-slate-900">{economyStatus.reliability}</span>
                        </span>
                      )}
                    </div>
                    {economyStatus?.reasons?.length ? (
                      <div className="text-xs text-slate-500">
                        {economyStatus.reasons.slice(0, 2).join(" · ")}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Objet du mail</label>
                    <input 
                      type="text" 
                      className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      placeholder="Ex: Jean, votre étude personnalisée d'assurance emprunteur"
                      value={emailSubject}
                      onChange={e => setEmailSubject(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Coller le HTML du mail ici</label>
                    <textarea 
                      className="border border-slate-200 rounded-xl p-4 text-xs font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder:font-sans placeholder:text-slate-400"
                      style={{ height: "400px" }}
                      placeholder="<div style='font-family: Arial, sans-serif;'>...</div>"
                      value={emailHtml}
                      onChange={e => setEmailHtml(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-3">
                    <button 
                      type="button"
                      onClick={() => setPreviewActive(!previewActive)}
                      className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all flex items-center gap-2 ${
                        previewActive 
                          ? "bg-slate-100 border-slate-300 text-slate-800 animate-pulse" 
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <Eye className="w-4 h-4"/>
                      {previewActive ? "Masquer la prévisualisation" : "Prévisualiser"}
                    </button>

                    <button 
                      type="button"
                      onClick={handleSendPastedEmail}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2 rounded-xl text-sm transition-all shadow-sm flex items-center gap-2 ml-auto"
                    >
                      <Send className="w-4 h-4"/>
                      Envoyer au client ▶
                    </button>
                  </div>

                  {previewActive && (
                    <div className="mt-4 border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
                      <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-xs font-semibold text-slate-500 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        Aperçu réel du message HTML envoyé au client
                      </div>
                      <iframe 
                        className="w-full bg-white border-0"
                        style={{ height: "450px" }}
                        srcDoc={emailHtml}
                        title="Prévisualisation du Mail Client"
                      />
                    </div>
                  )}
                </div>
              )}


            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-400 h-full">
              <MessageSquareText className="w-20 h-20 mb-6 opacity-20"/>
              <p className="font-medium text-lg">Sélectionnez un dossier dans la liste pour afficher le CRM.</p>
              <p className="text-sm mt-2">Vous pourrez suivre les échanges Gmail en temps réel et gérer les alertes.</p>
            </div>
          )}
        </div>
      </div>

      {showDeleteConfirmId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99999]">
          <div className="bg-white rounded-3xl border border-slate-100 max-w-sm w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Confirmer la suppression</h3>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Êtes-vous sûr de vouloir supprimer définitivement ce dossier ? 
              Cette action est irréversible et supprimera également les données associées de Google Drive et Firestore.
            </p>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setShowDeleteConfirmId(null)} 
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                Annuler
              </button>
              <button 
                onClick={() => {
                  const id = showDeleteConfirmId;
                  setShowDeleteConfirmId(null);
                  handleDeleteAction(id);
                }} 
                className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors shadow-sm"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
