import assert from "node:assert/strict";
import { patchStudyHtmlBrokerageFee, formatEuroFr } from "../shared/studyHtmlPatch";

assert.equal(formatEuroFr(190), "190,00\u00a0€");
assert.equal(formatEuroFr(1900), "1\u00a0900,00\u00a0€");

// Bug : template brandé PDF → « 190,00 € 190 € »
const branded = `
  <div style="margin:6px 0;">
    <span style="font-weight:600;">Frais de courtage :</span>
    <strong>190&nbsp;€</strong>
  </div>
`;
const patched = patchStudyHtmlBrokerageFee(branded, 190);
assert.equal(patched.patched, true);
assert.match(patched.html, /Frais de courtage\s*:[\s\S]*?<strong>190,00\u00a0€<\/strong>/);
assert.equal((patched.html.match(/190/g) || []).length, 1, "un seul montant 190");
assert.doesNotMatch(patched.html, /190,00.*190/);

const strongOnly = `Frais de courtage : <strong>400 €</strong>`;
const p2 = patchStudyHtmlBrokerageFee(strongOnly, 640);
assert.equal(p2.patched, true);
assert.match(p2.html, /<strong>640,00\u00a0€<\/strong>/);
assert.doesNotMatch(p2.html, /400/);

const spanDraft = `
  <span style="font-weight:600;">Frais de courtage :</span>
  <span>selon barème</span>
`;
const p3 = patchStudyHtmlBrokerageFee(spanDraft, 190);
assert.equal(p3.patched, true);
assert.match(p3.html, /<span>190,00\u00a0€<\/span>/);

console.log("verify-study-html-patch: OK");
