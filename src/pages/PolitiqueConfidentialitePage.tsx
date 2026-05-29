import React from "react";
import LegalDocumentPage from "../components/legal/LegalDocumentPage";
import { politiqueConfidentialiteAssurance } from "../content/politiqueConfidentialiteAssurance";

export default function PolitiqueConfidentialitePage({ onBack }: { onBack: () => void }) {
  return <LegalDocumentPage document={politiqueConfidentialiteAssurance} onBack={onBack} />;
}
