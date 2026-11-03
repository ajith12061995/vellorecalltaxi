/* VCT core · clock: phones' clocks can be minutes off. Dispatch timing (request waves, rounds, "too old")
   compares times written by different phones, so each app learns the server time once and uses VCTCLK.now(). */
const VCTCLK = {
  off: 0,
  now() { return Date.now() + this.off; },
  // write a server timestamp, read it back, and keep the difference (ignored if absurd)
  async sync(F, ref) {
    try {
      const t0 = Date.now();
      await F.setDoc(ref, { clock: F.serverTimestamp() }, { merge: true });
      const s = await F.getDoc(ref), v = s.exists() && s.data().clock, ms = v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
      const o = ms ? ms - (t0 + Date.now()) / 2 : 0;
      if (ms && Math.abs(o) < 12 * 3600e3) this.off = Math.round(o);
    } catch (e) { /* keep the phone clock */ }
    return this.off;
  },
};
