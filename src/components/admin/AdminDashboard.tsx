import React, { useState, useEffect } from "react";
import { Dossier, UserInfo } from "../../types";
import { LogOut, Search, MessageSquareText, Mail, Send, Eye, FileText, Download, CheckCircle, AlertTriangle, Trash2, CalendarClock, ListTodo, Bell, Sparkles } from "lucide-react";
import { showToast } from "../../lib/toast";
import { getApiUrl } from "../../lib/utils";
import { getAccessToken } from "../../lib/auth";

export default function AdminDashboard({ user, onLogout }: { user: UserInfo; onLogout: () => void; }) {
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [search, setSearch] = useState("");
  const [selectedDossier, setSelectedDossier] = useState<Dossier | null>(null);
  const [activeTab, setActiveTab] = useState<"SUIVI" | "CRM" | "INFORMATIONS" | "DOCUMENTS" | "ENVOI_MAIL">("SUIVI");
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [autoSyncGmail, setAutoSyncGmail] = useState(true);
  
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [showDeleteConfirmId, setShowDeleteConfirmId] = useState<string | null>(null);

  const [emailSubject, setEmailSubject] = useState("");
  const [emailHtml, setEmailHtml] = useState("");
  const [previewActive, setPreviewActive] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState<any[] | null>(null);

  useEffect(() => {
    if (selectedDossier) {
      const clientName = selectedDossier.formData?.assures?.[0]?.prenom || 'Client';
      setEmailSubject(`${clientName}, votre étude personnalisée - Assurance Emprunteur`);
      setEmailHtml("");
      setPreviewActive(false);
    }
  }, [selectedDossier]);

  const loadDossiers = async () => {
    try {
      const res = await fetch(getApiUrl("/api/dossiers"));
      if (res.ok) {
        const data = await res.json();
        // Filtrer selon le rôle
        const filteredData = user.role === 'CONSEILLER' 
          ? data.filter((d: Dossier) => d.formData?.assures?.[0]?.email === user.email || (d as any).uid === user.uid)
          : data;
        setDossiers(filteredData);
        setSelectedDossier(prev => {
          if (!prev) return null;
          return data.find((d: Dossier) => d.id === prev.id) || prev;
        });
      }
    } catch (err) {
      showToast("Erreur de chargement", "error");
    }
  };

  useEffect(() => {
    loadDossiers();
    const interval = setInterval(loadDossiers, 15000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto Gmail sync (while admin dashboard is open)
  useEffect(() => {
    if (!autoSyncGmail) return;
    const interval = setInterval(() => {
      handleSyncGmail().catch(() => undefined);
    }, 30000);
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

  const handleSyncGmail = async () => {
    const token = await getAccessToken();
    if (!token) {
      showToast("Connexion Google manquante (OAuth).", "error");
      return;
    }
    try {
      showToast("Synchronisation Gmail (IA) en cours...", "info");
      const res = await fetch(getApiUrl("/api/admin/sync-emails"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast("Emails synchronisés", "success");
        loadDossiers();
      } else {
        showToast(data.error || "Erreur sync Gmail", "error");
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast("Docs Drive mis à jour", "success");
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

  const normalizeDocName = (value: unknown) => {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      // remove accents/diacritics
      .replace(/[\u0300-\u036f]/g, "");
  };

  const computeChecklist = (d: Dossier) => {
    const docs: any[] = d.formData?.documents || [];
    const names = docs.map((x) => normalizeDocName(x?.name));

    const hasCNI = names.some(
      (n) =>
        n.includes("cni") ||
        n.includes("identit") ||
        n.includes("piece") && n.includes("identit") ||
        n.includes("passeport") ||
        n.includes("carte") && n.includes("identit"),
    );
    const hasRib = names.some((n) => n.includes("rib") || n.includes("iban") || n.includes("releve") && n.includes("identite"));
    const hasOffrePret = names.some(
      (n) =>
        (n.includes("offre") && (n.includes("pret") || n.includes("credit") || n.includes("banque"))) ||
        (n.includes("contrat") && (n.includes("pret") || n.includes("credit"))) ||
        n.includes("offrepret"),
    );
    const hasAmortissement = names.some(
      (n) =>
        n.includes("amort") ||
        (n.includes("tableau") && (n.includes("amort") || n.includes("pret") || n.includes("credit"))) ||
        n.includes("echeancier") ||
        n.includes("plan") && n.includes("amort"),
    );
    return [
      { key: "cni", label: "Pièce d'identité (CNI/Passeport)", ok: hasCNI },
      { key: "rib", label: "RIB", ok: hasRib },
      { key: "offre", label: "Offre de prêt (si disponible)", ok: hasOffrePret },
      { key: "amort", label: "Tableau d'amortissement (si disponible)", ok: hasAmortissement },
    ];
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
        return "Document ajouté";
      case "EMAIL_SENT":
        return "Email envoyé";
      case "EMAIL_FAILED":
        return "Email en échec";
      case "REMINDER_SCHEDULED":
        return "Relance planifiée";
      case "REMINDER_SENT":
        return "Relance envoyée";
      case "AI_DECISION":
        return "IA: suggestions";
      default:
        return type;
    }
  };

  const getAlerts = (d: Dossier) => {
    const alerts: { title: string; detail: string }[] = [];
    const checklist = computeChecklist(d);
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
      const res = await fetch(getApiUrl(`/api/dossiers/${id}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) {
        showToast("Dossier supprimé avec succès", "success");
        setSelectedDossier(null);
        loadDossiers();
      } else {
        showToast("Erreur lors de la suppression", "error");
      }
    } catch {
      showToast("Erreur réseau", "error");
    }
  };

  const handleSendEmail = async () => {
    if (!selectedDossier) return;

    try {
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${selectedDossier.id}/send-email`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: replySubject, html: replyBody })
      });
      if (res.ok) {
        showToast("Email envoyé !", "success");
        setReplyBody("");
        loadDossiers();
      } else {
        showToast("Erreur d'envoi", "error");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: emailSubject, html: emailHtml })
      });
      if (res.ok) {
        showToast("Email envoyé de manière sécurisée !", "success");
        setEmailHtml("");
        setPreviewActive(false);
        loadDossiers();
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || "Erreur d'envoi", "error");
      }
    } catch (e) {
      showToast("Erreur réseau", "error");
    }
  };

  const filteredDossiers = dossiers.filter(d => {
    if (!search) return true;
    const s = search.toLowerCase();
    const p = d.formData?.assures?.[0];
    return (p?.nom?.toLowerCase().includes(s) || p?.prenom?.toLowerCase().includes(s) || d.id.toLowerCase().includes(s));
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold flex items-center gap-4">
          CRM Assurance Emprunteur
          <button onClick={async () => {
            try {
              showToast("Exécution des relances...", "info");
              const res = await fetch(getApiUrl("/api/admin/run-scheduler"), { method: "POST" });
              const data = await res.json().catch(() => ({}));
              if (res.ok) {
                showToast(`Relances: ${data.sent || 0} envoyée(s), ${data.failed || 0} échec(s)`, "success");
                loadDossiers();
              } else {
                showToast("Erreur scheduler", "error");
              }
            } catch {
              showToast("Erreur réseau", "error");
            }
          }} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2">
            <CalendarClock className="w-3.5 h-3.5" />
            Lancer relances
          </button>
        </h1>
        <button onClick={onLogout} className="flex gap-2 text-slate-500 hover:text-slate-900 transition-colors">
          <LogOut className="w-5 h-5"/> Déconnexion
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-1/3 max-w-sm bg-white border-r border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-100">
            <div className="flex gap-2 items-center bg-slate-100 p-2 rounded-lg">
              <Search className="w-4 h-4 text-slate-400" />
              <input 
                className="bg-transparent border-none outline-none text-sm w-full"
                placeholder="Rechercher un client..."
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
                <div className="flex items-center gap-4">
                  <select 
                    value={selectedDossier.status}
                    onChange={(e) => updateStatus(selectedDossier.id, e.target.value)}
                    className="bg-white border-2 border-slate-200 text-sm rounded-lg p-2 font-bold cursor-pointer hover:border-indigo-300 transition-colors"
                  >
                    <option value="NOUVEAU">NOUVEAU</option>
                    <option value="EN_COURS">EN COURS D'ÉTUDE</option>
                    <option value="TRAITÉ">TRAITÉ</option>
                    <option value="EN_ATTENTE_CLIENT">ATTENTE REPONSE CLIENT</option>
                    <option value="REFUSÉ">REFUSÉ / SANS SUITE</option>
                  </select>
                  <button 
                    onClick={() => handleDelete(selectedDossier.id)}
                    className="flex justify-center items-center bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 transition w-10 h-10 rounded-lg border border-red-200"
                    title="Supprimer définitivement"
                  >
                    <Trash2 className="w-4 h-4"/>
                  </button>
                </div>
              </div>

              {/* Tabs Navigation */}
              <div className="flex border-b border-slate-200">
                {["SUIVI", "CRM", "INFORMATIONS", "DOCUMENTS", "ENVOI_MAIL"].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === tab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                  >
                    {tab === "SUIVI" ? "Suivi" : tab === "ENVOI_MAIL" ? "Envoi Mail" : tab.charAt(0) + tab.slice(1).toLowerCase()}
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
                    <div className="flex gap-3 flex-wrap mb-4">
                      <button
                        onClick={handleSyncGmail}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 px-4 rounded-xl border border-slate-200 text-xs transition-all flex items-center gap-2"
                      >
                        <Mail className="w-4 h-4" /> Sync Gmail (IA)
                      </button>
                    <label className="bg-white border border-slate-200 text-slate-700 font-bold py-2.5 px-4 rounded-xl text-xs transition-all flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoSyncGmail}
                        onChange={(e) => setAutoSyncGmail(e.target.checked)}
                      />
                      Auto (30s)
                    </label>
                      <button
                        onClick={handleExportDrive}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all flex items-center gap-2"
                      >
                        <FileText className="w-4 h-4" /> Drive
                      </button>
                    </div>
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
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ subject: a.subject, html: a.html }),
                                          });
                                          const data = await res.json().catch(() => ({}));
                                          if (res.ok) {
                                            showToast("Email envoyé", "success");
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
                      {computeChecklist(selectedDossier).map(item => (
                        <div key={item.key} className={`flex items-center justify-between p-3 rounded-xl border ${item.ok ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
                          <div className="text-sm font-semibold text-slate-800">{item.label}</div>
                          <div className={`text-xs font-black px-2 py-1 rounded-full ${item.ok ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}>
                            {item.ok ? "OK" : "MANQUANT"}
                          </div>
                        </div>
                      ))}
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
                            <span className="text-red-700">{(selectedDossier as any).workspaceError}</span>
                          )}
                          {(selectedDossier as any).workspaceWarning && (
                            <span className="text-amber-700">{(selectedDossier as any).workspaceWarning}</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-slate-500 italic">Pas encore exporté. Cliquez sur “Drive”.</div>
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
                            {evt.meta && (
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

              {activeTab === "CRM" && (
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
                    <h3 className="font-bold flex gap-2 items-center mb-6 text-slate-800">
                      <Mail className="w-5 h-5 text-indigo-600"/> Historique des échanges & Messagerie
                    </h3>
                    
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
                    {/* Assurés */}
                    {selectedDossier.formData?.assures?.map((assure: any, idx: number) => (
                      <div key={idx} className="bg-slate-50 border rounded-xl p-5">
                        <h4 className="font-bold text-slate-800 mb-4 border-b pb-2">Assuré(e) {idx + 1} : {assure.prenom} {assure.nom}</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                          <div><span className="text-slate-500 block text-xs">Email</span>{assure.email || '-'}</div>
                          <div><span className="text-slate-500 block text-xs">Téléphone</span>{assure.telephone || '-'}</div>
                          <div><span className="text-slate-500 block text-xs">Date Naissance</span>{assure.dateNaissance || '-'}</div>
                          <div><span className="text-slate-500 block text-xs">Profession</span>{assure.profession || '-'}</div>
                          <div><span className="text-slate-500 block text-xs">Fumeur</span>{assure.fumeur ? 'Oui' : 'Non'}</div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Prêts */}
                    {selectedDossier.formData?.prets?.map((pret: any, idx: number) => (
                      <div key={idx} className="bg-indigo-50 border border-indigo-100 rounded-xl p-5">
                        <h4 className="font-bold text-indigo-900 mb-4 border-b border-indigo-200 pb-2">Prêt {idx + 1}</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                          <div><span className="text-indigo-700 block text-xs">Capital Restant</span>{pret.capitalRestant ? `${pret.capitalRestant} €` : '-'}</div>
                          <div><span className="text-indigo-700 block text-xs">Durée Restante</span>{pret.dureeRestante ? `${pret.dureeRestante} mois` : '-'}</div>
                          <div><span className="text-indigo-700 block text-xs">Taux</span>{pret.taux ? `${pret.taux} %` : '-'}</div>
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
                  <div className="space-y-3">
                    {selectedDossier.formData?.documents?.length ? (
                      selectedDossier.formData.documents.map((doc, idx) => (
                        <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 border rounded-xl">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-slate-400" />
                            <div>
                              <p className="font-medium text-slate-800">{doc.name}</p>
                              <p className="text-xs text-slate-500">{(doc.size / 1024).toFixed(1)} KB</p>
                            </div>
                          </div>
                          <a 
                            href={getApiUrl(`/api/files?path=${encodeURIComponent(doc.localPath)}`)} 
                            download={doc.name}
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
                      <Mail className="w-5 h-5 text-indigo-600"/> Envoi du Mail Client
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Collez le code HTML d'une étude d'assurance générée pour l'envoyer directement au client depuis votre Gmail.
                    </p>
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
