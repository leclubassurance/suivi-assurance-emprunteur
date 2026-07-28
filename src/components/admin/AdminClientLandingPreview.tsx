import React from "react";
import { ArrowLeft } from "lucide-react";
import ClientLandingPage from "../ClientLandingPage";

/** Preview admin de la landing client (même page que le site public). */
export default function AdminClientLandingPreview({
  onBack,
  onStartStudy,
}: {
  onBack: () => void;
  onStartStudy: () => void;
}) {
  return (
    <ClientLandingPage
      onStart={onStartStudy}
      adminChrome={
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            background: "#0b1633",
            color: "white",
            padding: "10px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontFamily: "Poppins, Arial, sans-serif",
            fontSize: 12,
          }}
        >
          <button
            type="button"
            onClick={onBack}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "transparent",
              border: "1px solid rgba(255,255,255,.25)",
              color: "white",
              borderRadius: 999,
              padding: "8px 14px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Retour admin
          </button>
          <span style={{ opacity: 0.85, textAlign: "right" }}>
            Preview = page publique live (site, conseillers, apporteurs)
          </span>
        </div>
      }
    />
  );
}
