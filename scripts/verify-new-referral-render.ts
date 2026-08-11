/**
 * Smoke test: formulaire reco autonome + garde-fou anti-régression.
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
      onSubmit: async () => {},
      onCancel: () => {},
      initialValues: { prenom: "Ada", nom: "Lovelace", phone: "0600000000" },
    }),
  );

  assert.match(html, /Envoyer la recommandation/);
  assert.match(html, /Ada|Prénom/);

  const formSrc = fs.readFileSync("src/components/portal/NewReferralForm.tsx", "utf8");
  assert.match(
    formSrc,
    /const \[submitting,\s*setSubmitting\]\s*=\s*useState\(false\)/,
    "NewReferralForm must own submitting state internally",
  );

  const pageSrc = fs.readFileSync("src/components/portal/ApporteurPortalPage.tsx", "utf8");
  assert.match(pageSrc, /<NewReferralForm[\s\S]*?onSubmit=\{submitReferral\}/);
  assert.doesNotMatch(
    pageSrc,
    /submitting=\{submitting\}/,
    "Portal must not pass submitting into NewReferralForm (owned by the form)",
  );
  // Partner recruit keeps its own flag — must not reuse an undeclared `submitting`
  assert.match(pageSrc, /const \[partnerSubmitting,\s*setPartnerSubmitting\]\s*=\s*useState\(false\)/);
  assert.doesNotMatch(
    pageSrc,
    /\bdisabled=\{submitting\}/,
    "No bare `submitting` reference left in portal page",
  );

  console.log("verify-new-referral-render: OK");
}

main();
