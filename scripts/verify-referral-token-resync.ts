/**
 * Usage: npx tsx scripts/verify-referral-token-resync.ts
 */
import assert from "assert";
import {
  buildReferralTokenCandidates,
  preferredReferralTokenSlug,
  shouldResyncReferralToken,
  slugifyReferralToken,
} from "../shared/apporteurReferralToken";

assert.equal(slugifyReferralToken("Alex Leprioux"), "alex-leprioux");
assert.equal(slugifyReferralToken("Alex Lepriou"), "alex-lepriou");

assert.deepEqual(buildReferralTokenCandidates("Alex Leprioux", ""), ["alex-leprioux"]);

assert.equal(shouldResyncReferralToken("alex-lepriou", "Alex Leprioux", ""), true);
assert.equal(shouldResyncReferralToken("alex-leprioux", "Alex Leprioux", ""), false);
assert.equal(shouldResyncReferralToken("mon-slug-perso", "Alex Leprioux", ""), false);

assert.equal(preferredReferralTokenSlug("Marie Dupont"), "marie-dupont");

console.log("verify-referral-token-resync: OK");
