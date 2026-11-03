/* VCT core · ride PIN check that works even when the customer's phone is offline or the app is closed.
   The customer app saves only a salted, slow hash of the 4-digit PIN in the booking (pinSalt + pinHash).
   The driver app hashes the PIN the customer tells them and compares. The PIN itself stays in
   bookings/{id}/private/pin (customer + office only). PBKDF2 with many rounds makes guessing slow;
   the full fix (check on the server) is the Cloud Function `verifyPin` in functions/. */
const VCTPIN = (() => {
  const ROUNDS = 120000;
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function hash(salt, pin) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('vct:' + salt), iterations: ROUNDS }, key, 256);
    return hex(bits);
  }
  const salt = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
  async function fields(pin) { const s = salt(); return { pinSalt: s, pinHash: await hash(s, pin) }; }
  async function check(b, pin) { if (!b || !b.pinHash || !b.pinSalt) return null; return (await hash(b.pinSalt, pin)) === b.pinHash; }
  return { hash, fields, check, ROUNDS };
})();
