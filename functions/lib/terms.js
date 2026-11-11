// Agreement versions currently in force. A version is the date its text took effect;
// change it whenever terms.html changes in substance, together with assets/terms.js.
export const TERMS_VERSION = { developer: '2026-11-11', partner: '2026-11-11' };

// Returns an error code when the request does not carry consent to the current text.
export function termsError(doc, version) {
  if (!version) return 'terms_required';
  return version === TERMS_VERSION[doc] ? '' : 'terms_outdated';
}

// One row per account, agreement and version; the first acceptance time is kept.
export async function recordTermsAcceptance(DB, accountId, doc) {
  await DB.prepare('INSERT OR IGNORE INTO terms_acceptances (account_id, doc, version) VALUES (?, ?, ?)')
    .bind(accountId, doc, TERMS_VERSION[doc]).run();
}
