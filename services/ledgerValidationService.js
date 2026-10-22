/**
 * ledgerValidationService.js
 * Validates a parsed transaction before it may be confirmed/saved.
 *
 * Financial safety rule: NEVER auto-save a transaction from uncertain speech,
 * and NEVER guess a missing amount or party. If required fields are missing or
 * the intent is ambiguous, we return the specific clarifying question (in Odia)
 * the UI should ask the user.
 */

const ACTIONS = ['SALE', 'PURCHASE', 'RECEIVE_CASH', 'PAY_CASH', 'CREDIT_GIVEN'];
const PAYMENT_TYPES = ['CASH', 'CREDIT', 'ONLINE'];

// Actions that inherently involve a counterparty (party required).
const PARTY_REQUIRED = new Set(['SALE', 'PURCHASE', 'RECEIVE_CASH', 'PAY_CASH', 'CREDIT_GIVEN']);

/**
 * @param {Object} tx - { action, party, amount, item, payment_type }
 * @returns {{ valid: boolean, needsClarification: boolean, missing: string[],
 *            clarification: string|null, normalized: Object }}
 */
function validateTransaction(tx = {}, opts = {}) {
  const lang = opts.language === 'en' ? 'en' : (opts.language === 'hi' || opts.language === 'mix' ? 'hi' : 'or');
  const say = (english, hindi, odia) => (lang === 'en' ? english : lang === 'hi' ? hindi : odia);
  const normalized = {
    action: typeof tx.action === 'string' ? tx.action.toUpperCase() : 'UNKNOWN',
    party: tx.party && tx.party !== 'N/A' ? String(tx.party).trim() : null,
    amount: Number.isFinite(Number(tx.amount)) ? Number(tx.amount) : 0,
    item: tx.item && tx.item !== 'N/A' ? String(tx.item).trim() : null,
    payment_type:
      typeof tx.payment_type === 'string' ? tx.payment_type.toUpperCase() : 'UNKNOWN',
  };

  const missing = [];

  // Ambiguous / unrecognized intent.
  if (!ACTIONS.includes(normalized.action)) {
    return {
      valid: false,
      needsClarification: true,
      missing: ['action'],
      clarification: say(
        'What do you want to record? (sale, purchase, cash received, or cash paid)',
        'क्या दर्ज करना है? बिक्री, खरीद, नकद मिला, या नकद दिया?',
        'ଆପଣ କଣ କରିବାକୁ ଚାହୁଁଛନ୍ତି? (ବିକ୍ରି, କ୍ରୟ, ନଗଦ ଗ୍ରହଣ, ନଗଦ ପ୍ରଦାନ?)'
      ),
      normalized,
    };
  }

  // Amount is mandatory for every financial action — never guess it.
  if (!normalized.amount || normalized.amount <= 0) {
    missing.push('amount');
  }

  if (PARTY_REQUIRED.has(normalized.action) && !normalized.party) {
    missing.push('party');
  }

  if (missing.length > 0) {
    let clarification;
    if (missing.includes('amount') && missing.includes('party')) {
      clarification = say('Who was this with, and for how much?', 'यह किसके साथ था, और कितने का?', 'ଆପଣ କାହାକୁ ଏବଂ କେତେ ଟଙ୍କାର କାରବାର କରିଛନ୍ତି?');
    } else if (missing.includes('amount')) {
      clarification = say('How much was the amount?', 'रकम कितनी थी?', 'ଆପଣ କେତେ ଟଙ୍କା କହିଲେ?');
    } else {
      clarification = say('Who was this transaction with? Say the customer or party name.', 'यह कारोबार किसके साथ था? ग्राहक या पार्टी का नाम बताएं।', 'ଏହା କାହା ସହିତ କାରବାର? (ଗ୍ରାହକ/ପାର୍ଟିର ନାମ କୁହନ୍ତୁ)');
    }
    return { valid: false, needsClarification: true, missing, clarification, normalized };
  }

  // Normalize unknown payment type to a safe default without inventing a value
  // that changes ledger semantics — leave as UNKNOWN so UI can ask if needed.
  if (!PAYMENT_TYPES.includes(normalized.payment_type)) {
    normalized.payment_type = 'UNKNOWN';
  }

  return { valid: true, needsClarification: false, missing: [], clarification: null, normalized };
}

module.exports = { validateTransaction, ACTIONS, PAYMENT_TYPES };
