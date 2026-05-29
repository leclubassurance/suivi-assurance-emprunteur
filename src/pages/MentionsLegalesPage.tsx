import React from "react";
import LegalDocumentPage from "../components/legal/LegalDocumentPage";
import { mentionsLegalesAssurance } from "../content/mentionsLegalesAssurance";

export default function MentionsLegalesPage({ onBack }: { onBack: () => void }) {
  return <LegalDocumentPage document={mentionsLegalesAssurance} onBack={onBack} />;
}
