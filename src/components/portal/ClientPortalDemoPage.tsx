import React from "react";
import { ClientPortalContent } from "./ClientPortalContent";
import { CLIENT_PORTAL_DEMO_DATA } from "./clientPortalDemoData";

/** Aperçu interne : même rendu que le lien client réel, avec données d'exemple. */
export default function ClientPortalDemoPage() {
  return (
    <div className="min-h-[100dvh] bg-[#f8f9fb] flex flex-col">
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center">
        <p className="text-[12px] font-bold text-amber-900">
          Aperçu réservé à l&apos;équipe — ce n&apos;est pas le lien d&apos;un client réel
        </p>
      </div>
      <div className="flex-1 flex items-center justify-center py-10 px-4">
        <ClientPortalContent data={CLIENT_PORTAL_DEMO_DATA} />
      </div>
    </div>
  );
}
