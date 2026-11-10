// Weather for the small line in the customer and driver apps.
// Source: MET Norway Locationforecast 2.0 (https://api.met.no), licence CC BY 4.0 — credit "MET Norway" is shown in the apps.
// Their rules: call from a server (not from phones), identify yourself in User-Agent, at most 4 decimals in lat/lon,
// send If-Modified-Since and do not ask again before it changes. One request per 30 minutes from weatherTick.
const URL_ = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=12.92&lon=79.13'; // Vellore
const UA = 'VelloreTaxi/1.0 https://velloretaxi.app';
const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;

// forecast JSON → { t (°C), sym, r1 (mm next hour), r3 (mm next 3 hours), kind: rain|soon|hot|ok, heavy } or null
function summary(j, now) {
  const ts = j && j.properties && j.properties.timeseries;
  if (!Array.isArray(ts) || !ts.length) return null;
  // the hour we are in: the last entry that has started (entries are hourly, oldest first)
  let i = 0;
  for (let k = 0; k < ts.length; k++) { const t = Date.parse(ts[k] && ts[k].time); if (isFinite(t) && t <= now) i = k; else if (isFinite(t)) break; }
  const hour = k => { const d = ts[k] && ts[k].data, n = d && d.next_1_hours; return { t: num(d && d.instant && d.instant.details && d.instant.details.air_temperature), sym: n && n.summary && typeof n.summary.symbol_code === 'string' ? n.summary.symbol_code : '', r: num(n && n.details && n.details.precipitation_amount) || 0 }; };
  const h = hour(i);
  if (h.t === null || h.t < -10 || h.t > 60) return null;
  if (Math.abs(Date.parse(ts[i].time) - now) > 3 * 3600e3) return null;   // forecast too old / too far ahead
  const r1 = h.r, r3 = r1 + (ts[i + 1] ? hour(i + 1).r : 0) + (ts[i + 2] ? hour(i + 2).r : 0);
  const wet = /rain|sleet|thunder/.test(h.sym);
  const kind = (r1 >= 0.3 || (wet && r1 > 0)) ? 'rain' : r3 >= 0.5 ? 'soon' : h.t >= 36 ? 'hot' : 'ok';
  return { t: Math.round(h.t * 10) / 10, sym: h.sym.slice(0, 40), r1: Math.round(r1 * 10) / 10, r3: Math.round(r3 * 10) / 10, kind, heavy: kind === 'rain' && r1 >= 4 };
}

// one polite request. → { status: 200, data, lastMod } | { status: 304 } | { status: <other> }
async function get(fetchFn, since) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (since) headers['If-Modified-Since'] = since;
  const r = await fetchFn(URL_, { headers });
  if (r.status === 304) return { status: 304 };
  if (r.status !== 200 && r.status !== 203) return { status: r.status };
  return { status: 200, data: await r.json(), lastMod: r.headers.get('last-modified') || '' };
}
module.exports = { summary, get, URL: URL_, UA };
