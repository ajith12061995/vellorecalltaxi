package app.velloretaxi.driver;

import java.util.ArrayList;
import java.util.Locale;

/**
 * GPS trip meter — a line-by-line port of core/meter.js (tests/unit/meter.test.js runs both on the same fixes and
 * checks they agree). No Android classes here, so it can be tested on a plain JVM.
 * Fixes with accuracy worse than 40 m are skipped; a move faster than 130 km/h is a jump (skipped, counted); a move
 * shorter than 30 m (or half the accuracy) is drift (not counted yet; the next real move is measured from the last used point, so a stop is a slow segment → waiting); a gap of over 60 s and
 * over 300 m adds the straight line × 1.3; slower than 5 km/h between used points counts as waiting.
 */
public final class TripMeter {
    static final double MAX_ACC = 40, MAX_KMH = 130, DRIFT_M = 30, GAP_S = 60, GAP_M = 300, GAP_ROAD = 1.3, SLOW_KMH = 5;
    public long t0 = 0;
    public double m = 0, gapM = 0, waitS = 0, pendS = 0;
    public int gaps = 0, jumps = 0, bad = 0, mock = 0, n = 0;
    private double lLat, lLon, lAcc; private long lT; private boolean has = false;
    private final ArrayList<String> pts = new ArrayList<>();

    static double dist(double aLat, double aLon, double bLat, double bLon) {
        double R = 6371000, dLa = Math.toRadians(bLat - aLat), dLo = Math.toRadians(bLon - aLon);
        double h = Math.pow(Math.sin(dLa / 2), 2) + Math.cos(Math.toRadians(aLat)) * Math.cos(Math.toRadians(bLat)) * Math.pow(Math.sin(dLo / 2), 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    private static double r5(double x) { return Math.round(x * 1e5) / 1e5; }
    private static String num(double x) { // same text as JS: no trailing ".0"
        if (x == Math.rint(x) && Math.abs(x) < 1e15) return String.valueOf((long) x);
        String s = String.format(Locale.US, "%.5f", x); s = s.replaceAll("0+$", ""); return s.endsWith(".") ? s.substring(0, s.length() - 1) : s;
    }
    private String pack(double lat, double lon, long t, double acc) {
        return num(r5(lat)) + "," + num(r5(lon)) + "," + Math.round((t - t0) / 1000.0) + "," + Math.round(acc);
    }

    /** one fix; t in ms, acc in m (0 = unknown) → true when used */
    public synchronized boolean add(double lat, double lon, long t, double acc, boolean isMock) {
        if (Double.isNaN(lat) || Double.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || t <= 0) { bad++; return false; }
        if (isMock) mock++;
        if (!(acc > 0)) acc = 0;
        if (acc > MAX_ACC) { bad++; return false; }
        if (t0 == 0) t0 = t;
        if (!has) { lLat = lat; lLon = lon; lT = t; lAcc = acc; has = true; n++; pts.add(pack(lat, lon, t, acc)); return true; }
        double dt = (t - lT) / 1000.0; if (!(dt > 0)) { bad++; return false; }
        double d = dist(lLat, lLon, lat, lon);
        if (dt > GAP_S && d > GAP_M) {
            double g = d * GAP_ROAD; m += g; gapM += g; gaps++; pendS = 0;
            lLat = lat; lLon = lon; lT = t; lAcc = acc; n++; pts.add(pack(lat, lon, t, acc)); return true;
        }
        if (d / dt * 3.6 > MAX_KMH) { jumps++; return false; }
        if (d < Math.max(DRIFT_M, acc / 2)) { pendS = dt; return false; }
        pendS = 0; if (d / dt * 3.6 < SLOW_KMH) waitS += dt;
        m += d; lLat = lat; lLon = lon; lT = t; lAcc = acc; n++; pts.add(pack(lat, lon, t, acc)); return true;
    }

    public synchronized double km() { return Math.round(m / 10) / 100.0; }
    public synchronized long waitMin() { return Math.round((waitS + pendS) / 60); }
    public synchronized double gapKm() { return Math.round(gapM / 10) / 100.0; }
    public synchronized int pointCount() { return pts.size(); }
    /** all stored points "lat,lon,t,acc;…" */
    public synchronized String points() { return String.join(";", pts); }
    /** stored points from index `from` (for uploading in chunks) */
    public synchronized String points(int from, int to) { return String.join(";", pts.subList(Math.max(0, from), Math.min(pts.size(), to))); }

    /** state for SharedPreferences (survives the service being restarted mid-trip) */
    public synchronized String save() {
        return t0 + "|" + pendS + "|" + m + "|" + gapM + "|" + waitS + "|" + gaps + "|" + jumps + "|" + bad + "|" + mock + "|" + n + "|"
                + (has ? lLat + "|" + lLon + "|" + lT + "|" + lAcc : "|||") + "|" + String.join(";", pts);
    }
    public static TripMeter load(String s) {
        TripMeter t = new TripMeter();
        if (s == null || s.isEmpty()) return t;
        try {
            String[] x = s.split("\\|", -1);
            t.t0 = Long.parseLong(x[0]); t.pendS = Double.parseDouble(x[1]); t.m = Double.parseDouble(x[2]); t.gapM = Double.parseDouble(x[3]); t.waitS = Double.parseDouble(x[4]);
            t.gaps = Integer.parseInt(x[5]); t.jumps = Integer.parseInt(x[6]); t.bad = Integer.parseInt(x[7]); t.mock = Integer.parseInt(x[8]); t.n = Integer.parseInt(x[9]);
            if (!x[10].isEmpty()) { t.lLat = Double.parseDouble(x[10]); t.lLon = Double.parseDouble(x[11]); t.lT = Long.parseLong(x[12]); t.lAcc = Double.parseDouble(x[13]); t.has = true; }
            if (x.length > 14 && !x[14].isEmpty()) for (String p : x[14].split(";")) t.pts.add(p);
        } catch (Exception e) { return new TripMeter(); }
        return t;
    }
}
