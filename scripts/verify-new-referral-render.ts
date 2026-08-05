/**
 * Smoke test: formulaire reco + garde-fou anti-régression `submitting`.
 *
 *   npx tsx scripts/verify-new-referral-render.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import NewReferralForm from "../src/components/portal/NewReferralForm";

function main() {
  const html = renderToString(
    React.createElement(NewReferralForm, {
      values: { prenom: "Ada", nom: "Lovelace", email: "", phone: "0600000000", notes: "" },
      onChange: () => {},
      onSubmit: (e: React.FormEvent) => e.preventDefault(),
      submitting: false,
      error: null,
      onCancel: () => {},
    }),
  );

  assert.match(html, /Envoyer la recommandation/);
  assert.match(html, /Ada|Prénom/);

  const src = fs.readFileSync("src/components/portal/ApporteurPortalPage.tsx", "utf8");
  assert.match(
    src,
    /const \[submitting,\s*setSubmitting\]\s*=\s*useState\(false\)/,
    "ApporteurPortalPage must declare submitting state (missing = white screen on Nouvelle recommandation)",
  );
  // Usages JSX / handlers must exist
  assert.match(src, /submitting=\{submitting\}/);
  assert.match(src, /setSubmitting\(true\)/);
  assert.match(src, /setSubmitting\(false\)/);

  console.log("verify-new-referral-render: OK");
}

main();
