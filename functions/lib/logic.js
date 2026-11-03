// Pure decision logic for the Cloud Functions (no Firebase imports), unit-tested in test/logic.test.js.
const n = v => { const x = +v; return isFinite(x) && x > 0 ? x : 0; };
const MIN = 60e3;

// Commission for a finished booking: on the trip amount only (tip, toll, parking, permit are not charged)
function commissionFor(b, pct) {
  const trip = b && b.fx && b.fx.trip != null ? n(b.fx.trip) : (b && b.fareFinal != null ? n(b.fareFinal) : n(b && b.fare));
  return { trip, comm: Math.round(trip * n(pct) / 100) };
}

// Ledger entry + how much the wallet still has to move (if the driver app already took some commission)
function settle(b, pct, serverComm) {
  const { trip, comm } = commissionFor(b, pct);
  const taken = b.commLocal ? n(b.comm) : 0;          // already taken by the driver app
  const walletDelta = serverComm ? -(comm - taken) : 0; // server mode: correct to the exact commission
  return { trip, comm, taken, walletDelta, mismatch: !serverComm && b.commLocal && n(b.comm) !== comm };
}

// Housekeeping decisions for one booking at time `now`
function housekeeping(b, now) {
  if (!b) return null;
  const when = n(b.when), created = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : when;
  if (b.status === 'scheduled' && !b.driverPhone && (b.kind === 'schedule' || b.kind === 'ride') && when - now <= 30 * MIN)
    return { status: 'searching', dispatchedBy: 'server' };
  if (b.status === 'searching' && !b.dispatch &&
      ((b.kind === 'ride' && now - created > 15 * MIN) || (b.kind === 'schedule' && now - when > 15 * MIN)))
    return { status: 'cancelled', cancelReason: 'nodriver', cancelledBy: 'server' };
  return null;
}

// Expected local fare from office prices; flag bookings that look tampered (far below the price list)
function fareLooksWrong(b, fares) {
  if (!b || b.src !== 'app' || (b.kind && b.kind !== 'ride' && b.kind !== 'schedule')) return false;
  const f = fares && fares[b.veh]; if (!f) return false;
  const expected = n(f.base) + n(f.per) * Math.max(0, n(b.km) - (f.incl != null ? n(f.incl) : 1.5));
  return expected > 0 && n(b.fare) < expected * 0.6;
}

// A live position older than 10 minutes means the app is closed or offline: mark the driver not available
const liveStale = (l, now) => !!l && l.online === true && (!l.updatedAt || now - l.updatedAt.toMillis() > 10 * MIN);

module.exports = { commissionFor, settle, housekeeping, fareLooksWrong, liveStale };
