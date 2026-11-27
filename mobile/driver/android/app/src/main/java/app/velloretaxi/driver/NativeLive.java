package app.velloretaxi.driver;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The driver's position straight from the phone to the office and the rider (live/{phone}), while the driver is ON and
 * the app's screen is NOT in front: phone locked, another app open (Facebook, a call), screen off.
 *
 * Why: the page (WebView) sends the position while it is on screen, but Android slows or stops a page in the
 * background, so the office lost the signal as soon as the driver left the app (owner's 27 Nov recording).
 * This runs inside DutyService (a foreground service of type "location"), which Android keeps running.
 *
 * - The page gives us, once per ON: the Firebase web API key, project, the driver's phone and the sign-in refresh token
 *   (the same token the page keeps on this phone). We swap it for a 1-hour ID token at securetoken.googleapis.com and
 *   write with it through the Firestore REST API, so the database rules apply exactly as for the page.
 * - We change only lat, lon, gh, hd, sp, acc, online and updatedAt (update mask): the page's busy / bk / veh stay.
 * - Sent when moved 20 m (at most every 8 s), and at least every 30 s while standing (the office sees "signal OK").
 * - Nothing is sent while the app's screen is in front (the page sends then) or after OFF.
 */
final class NativeLive {
    static final String TAG = "NativeLive";
    private static final String PREFS = "vct_live";
    private static NativeLive inst;

    private final Context ctx;
    private final HandlerThread th = new HandlerThread("vct-live");
    private Handler h;
    private FusedLocationProviderClient fused;
    private LocationCallback cb;
    private Location last, sent;
    private long sentAt = 0, tokenExp = 0;
    private String idToken;
    private boolean running = false;
    /* test hook (debug builds only use it): base URLs of the two Google endpoints */
    static String tokenBase = "https://securetoken.googleapis.com", fsBase = "https://firestore.googleapis.com";
    static volatile int sends = 0, fails = 0;
    static volatile String lastErr = "";

    private NativeLive(Context c) { ctx = c.getApplicationContext(); }

    static synchronized NativeLive get(Context c) { if (inst == null) inst = new NativeLive(c); return inst; }

    /* ---------- credentials from the page ---------- */
    static void setCreds(Context c, String apiKey, String project, String phone, String refresh) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("key", apiKey).putString("proj", project).putString("phone", phone).putString("rt", refresh).apply();
        NativeLive n = get(c); n.idToken = null; n.tokenExp = 0;
    }
    static void setVeh(Context c, String veh) { if (veh != null && veh.length() > 0 && veh.length() <= 20) c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("veh", veh).apply(); }
    static void clearCreds(Context c) { c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply(); NativeLive n = get(c); n.idToken = null; n.tokenExp = 0; }
    private String pref(String k) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(k, ""); }
    static boolean hasCreds(Context c) { SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); return p.getString("rt", "").length() > 0 && p.getString("phone", "").length() > 0; }

    /* ---------- start / stop (DutyService) ---------- */
    @SuppressLint("MissingPermission")
    synchronized void start() {
        if (running) return;
        if (!hasCreds(ctx)) { Log.i(TAG, "no credentials yet"); return; }
        running = true;
        if (h == null) { th.start(); h = new Handler(th.getLooper()); }
        try {
            fused = LocationServices.getFusedLocationProviderClient(ctx);
            LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000).setMinUpdateIntervalMillis(3000).build();
            cb = new LocationCallback() { @Override public void onLocationResult(LocationResult r) { Location l = r.getLastLocation(); if (l != null) onFix(l); } };
            fused.requestLocationUpdates(req, cb, th.getLooper());
            fused.getLastLocation().addOnSuccessListener(l -> { if (l != null) h.post(() -> onFix(l)); });
        } catch (Exception e) { Log.w(TAG, "location updates refused", e); lastErr = "loc:" + e.getClass().getSimpleName(); }
        h.removeCallbacks(beat); h.postDelayed(beat, 30000);
        h.removeCallbacks(poll); h.postDelayed(poll, POLL_MS);
        saveToken(null);
        Log.i(TAG, "started");
    }

    synchronized void stop() {
        if (!running) return;
        running = false;
        try { if (fused != null && cb != null) fused.removeLocationUpdates(cb); } catch (Exception e) { /* gone */ }
        if (h != null) { h.removeCallbacks(beat); h.removeCallbacks(poll); }
        Log.i(TAG, "stopped");
    }

    boolean isRunning() { return running; }

    /** standing still with no new fixes: send the last position again so the office still sees a live signal */
    private final Runnable beat = new Runnable() { @Override public void run() {
        if (!running) return;
        if (last != null && System.currentTimeMillis() - sentAt >= 29000) send(last);
        h.postDelayed(this, 30000);
    } };

    private void onFix(Location l) {
        if (!running) return;
        Log.d(TAG, "fix " + l.getProvider() + " " + String.format(java.util.Locale.US, "%.4f,%.4f", l.getLatitude(), l.getLongitude()) + " acc=" + (l.hasAccuracy() ? Math.round(l.getAccuracy()) : -1) + " visible=" + DutyService.appVisible);
        if (l.hasAccuracy() && l.getAccuracy() > 80 && last != null && last.hasAccuracy() && last.getAccuracy() <= 80
                && l.getTime() - last.getTime() < 30000) return;   // a poor reading right after a good one
        last = l;
        long now = System.currentTimeMillis();
        boolean moved = sent == null || sent.distanceTo(l) >= 20;
        if ((moved && now - sentAt >= 8000) || now - sentAt >= 30000) send(l);
    }

    /* ---------- network (on the vct-live thread) ---------- */
    private void send(Location l) {
        if (DutyService.appVisible || !DutyService.isOn(ctx)) return;   // the page sends while it is on screen
        sentAt = System.currentTimeMillis();
        try {
            String tok = token();
            if (tok == null) return;
            String proj = pref("proj"), phone = pref("phone");
            String doc = "projects/" + proj + "/databases/(default)/documents/live/" + phone;
            JSONObject f = new JSONObject();
            f.put("lat", dbl(l.getLatitude())); f.put("lon", dbl(l.getLongitude()));
            f.put("gh", new JSONObject().put("stringValue", geohash(l.getLatitude(), l.getLongitude(), 7)));
            f.put("hd", dbl(l.hasBearing() && l.hasSpeed() && l.getSpeed() > 1.5f ? Math.round(l.getBearing()) : -1));
            f.put("sp", dbl(l.hasSpeed() ? Math.round(Math.max(0, l.getSpeed()) * 36) / 10.0 : 0));
            f.put("acc", dbl(l.hasAccuracy() ? Math.round(l.getAccuracy()) : 0));
            f.put("online", new JSONObject().put("booleanValue", true));
            int[] bt = battery(ctx);
            if (bt[0] >= 0) f.put("bat", new JSONObject().put("integerValue", String.valueOf(bt[0])));
            f.put("chg", new JSONObject().put("booleanValue", bt[1] == 1));
            f.put("pwr", new JSONObject().put("stringValue", "on"));
            JSONObject w = new JSONObject()
                    .put("update", new JSONObject().put("name", doc).put("fields", f))
                    .put("updateMask", new JSONObject().put("fieldPaths", new JSONArray().put("lat").put("lon").put("gh").put("hd").put("sp").put("acc").put("online").put("bat").put("chg").put("pwr")))
                    .put("updateTransforms", new JSONArray().put(new JSONObject().put("fieldPath", "updatedAt").put("setToServerValue", "REQUEST_TIME")));
            JSONObject body = new JSONObject().put("writes", new JSONArray().put(w));
            int code = http(fsBase + "/v1/projects/" + proj + "/databases/(default)/documents:commit", "application/json", body.toString(), tok, null);
            if (code == 200) { sent = l; sends++; }
            else { fails++; lastErr = "write:" + code; if (code == 401 || code == 403) { idToken = null; tokenExp = 0; } Log.w(TAG, "write " + code); }
        } catch (Exception e) { fails++; lastErr = "write:" + e.getClass().getSimpleName(); Log.w(TAG, "send failed", e); }
    }

    /** battery % (−1 unknown) and charging (1/0), from the sticky battery broadcast — no permission needed */
    static int[] battery(Context c) {
        try {
            android.content.Intent b = c.registerReceiver(null, new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            if (b == null) return new int[]{-1, 0};
            int lv = b.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1), sc = b.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100);
            int st = b.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
            boolean chg = st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL;
            return new int[]{ lv < 0 || sc <= 0 ? -1 : Math.round(lv * 100f / sc), chg ? 1 : 0 };
        } catch (Exception e) { return new int[]{-1, 0}; }
    }

    /**
     * The phone is being switched off (power button → Power off / Restart, or the battery is empty): tell the office
     * right now — pwr = "off" — so it can say "phone switched off" instead of guessing, and a waiting ride can go to
     * another driver at once. Android gives only a few seconds here, so this is one short write, at most ~4 s.
     */
    void shuttingDown() {
        if (!DutyService.isOn(ctx) || !hasCreds(ctx)) return;
        Thread t = new Thread(() -> {
            try {
                String tok = token(); if (tok == null) return;
                String proj = pref("proj"), phone = pref("phone");
                JSONObject f = new JSONObject().put("pwr", new JSONObject().put("stringValue", "off"));
                int[] bt = battery(ctx); if (bt[0] >= 0) f.put("bat", new JSONObject().put("integerValue", String.valueOf(bt[0])));
                JSONObject w = new JSONObject()
                        .put("update", new JSONObject().put("name", "projects/" + proj + "/databases/(default)/documents/live/" + phone).put("fields", f))
                        .put("updateMask", new JSONObject().put("fieldPaths", new JSONArray().put("pwr").put("bat")))
                        .put("updateTransforms", new JSONArray().put(new JSONObject().put("fieldPath", "updatedAt").put("setToServerValue", "REQUEST_TIME")));
                int code = http(fsBase + "/v1/projects/" + proj + "/databases/(default)/documents:commit", "application/json",
                        new JSONObject().put("writes", new JSONArray().put(w)).toString(), tok, null);
                Log.i(TAG, "shutdown sent " + code);
            } catch (Exception e) { Log.w(TAG, "shutdown send failed", e); }
        });
        t.start();
        try { t.join(4000); } catch (InterruptedException e) { /* time is up */ }
    }

    /**
     * 1.0.21: a ride push reached this phone — written to live/{phone} as pk (ride id) + pkAt (server time), so the office
     * (and we) can see for sure whether a missed ride never reached the phone or reached it and did not show.
     */
    void pushSeen(final String id) {
        if (id == null || id.isEmpty() || !hasCreds(ctx)) return;
        new Thread(() -> {
            try {
                String tok = token(); if (tok == null) return;
                String proj = pref("proj"), phone = pref("phone");
                JSONObject f = new JSONObject().put("pk", new JSONObject().put("stringValue", id.length() > 40 ? id.substring(0, 40) : id));
                JSONObject w = new JSONObject()
                        .put("update", new JSONObject().put("name", "projects/" + proj + "/databases/(default)/documents/live/" + phone).put("fields", f))
                        .put("updateMask", new JSONObject().put("fieldPaths", new JSONArray().put("pk")))
                        .put("updateTransforms", new JSONArray().put(new JSONObject().put("fieldPath", "pkAt").put("setToServerValue", "REQUEST_TIME")));
                int code = http(fsBase + "/v1/projects/" + proj + "/databases/(default)/documents:commit", "application/json",
                        new JSONObject().put("writes", new JSONArray().put(w)).toString(), tok, null);
                Log.i(TAG, "push seen " + id + " " + code);
            } catch (Exception e) { Log.w(TAG, "push seen failed", e); }
        }, "vct-pk").start();
    }

    /* ---------- 1.0.22: push address saved by the phone itself ---------- */
    static volatile String tokenState = "";   // "" not tried, "ok", "none", "err:<code>", "nosignin"
    /** this phone's FCM token → drivers/{phone}.fcm (+ fcmAt server time); token null = ask Google for it */
    void saveToken(final String given) {
        if (!hasCreds(ctx)) { tokenState = "nosignin"; return; }
        if (given != null && given.length() > 0) { new Thread(() -> writeToken(given), "vct-tok").start(); return; }
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                    .addOnSuccessListener(t -> { if (t == null || t.isEmpty()) { tokenState = "none"; return; } new Thread(() -> writeToken(t), "vct-tok").start(); })
                    .addOnFailureListener(e -> { tokenState = "none:" + e.getClass().getSimpleName(); Log.w(TAG, "fcm token", e); });
        } catch (Exception e) { tokenState = "none:" + e.getClass().getSimpleName(); Log.w(TAG, "fcm token", e); }
    }
    private String lastTok = "";
    private void writeToken(String t) {
        try {
            if (t.equals(lastTok) && "ok".equals(tokenState)) return;
            String tok = token(); if (tok == null) { tokenState = "err:signin"; return; }
            String proj = pref("proj"), phone = pref("phone");
            JSONObject w = new JSONObject()
                    .put("update", new JSONObject().put("name", "projects/" + proj + "/databases/(default)/documents/drivers/" + phone)
                            .put("fields", new JSONObject().put("fcm", new JSONObject().put("stringValue", t))))
                    .put("updateMask", new JSONObject().put("fieldPaths", new JSONArray().put("fcm")))
                    .put("currentDocument", new JSONObject().put("exists", true))
                    .put("updateTransforms", new JSONArray().put(new JSONObject().put("fieldPath", "fcmAt").put("setToServerValue", "REQUEST_TIME")));
            int code = http(fsBase + "/v1/projects/" + proj + "/databases/(default)/documents:commit", "application/json",
                    new JSONObject().put("writes", new JSONArray().put(w)).toString(), tok, null);
            if (code == 200) { lastTok = t; tokenState = "ok"; } else { tokenState = "err:" + code; if (code == 401 || code == 403) { idToken = null; tokenExp = 0; } }
            Log.i(TAG, "token saved " + code);
        } catch (Exception e) { tokenState = "err:" + e.getClass().getSimpleName(); Log.w(TAG, "token save", e); }
    }

    /* ---------- 1.0.22: the phone looks for waiting rides itself (works even when a push never arrives) ---------- */
    static long POLL_MS = 15000;
    static volatile int polls = 0, found = 0;
    private final java.util.LinkedHashSet<String> seenRides = new java.util.LinkedHashSet<>();
    private final Runnable poll = new Runnable() { @Override public void run() {
        if (!running) return;
        try { if (!DutyService.appVisible && DutyService.isOn(ctx)) pollOnce(); } catch (Exception e) { Log.w(TAG, "poll", e); }
        h.postDelayed(this, POLL_MS);
    } };
    private void pollOnce() throws Exception {
        String veh = pref("veh"); if (veh.isEmpty()) return;      // an older page that does not say the vehicle type: push only
        String tok = token(); if (tok == null) return;
        String proj = pref("proj");
        JSONObject f1 = new JSONObject().put("fieldFilter", new JSONObject().put("field", new JSONObject().put("fieldPath", "status")).put("op", "EQUAL").put("value", new JSONObject().put("stringValue", "searching")));
        JSONObject f2 = new JSONObject().put("fieldFilter", new JSONObject().put("field", new JSONObject().put("fieldPath", "veh")).put("op", "EQUAL").put("value", new JSONObject().put("stringValue", veh)));
        JSONObject q = new JSONObject().put("structuredQuery", new JSONObject()
                .put("from", new JSONArray().put(new JSONObject().put("collectionId", "bookings")))
                .put("where", new JSONObject().put("compositeFilter", new JSONObject().put("op", "AND").put("filters", new JSONArray().put(f1).put(f2))))
                .put("limit", 5));
        StringBuilder out = new StringBuilder();
        int code = http("POST", fsBase + "/v1/projects/" + proj + "/databases/(default)/documents:runQuery", "application/json", q.toString(), tok, out);
        polls++;
        if (code != 200) { if (code == 401 || code == 403) { idToken = null; tokenExp = 0; } Log.w(TAG, "poll " + code); return; }
        JSONArray rows = new JSONArray(out.toString());
        for (int i = 0; i < rows.length(); i++) {
            JSONObject d = rows.optJSONObject(i); d = d == null ? null : d.optJSONObject("document"); if (d == null) continue;
            String id = d.optString("name"); id = id.substring(id.lastIndexOf('/') + 1);
            if (id.isEmpty() || seenRides.contains(id)) continue;
            seenRides.add(id); if (seenRides.size() > 60) { java.util.Iterator<String> it = seenRides.iterator(); it.next(); it.remove(); }
            JSONObject f = d.optJSONObject("fields"), from = mv(f, "from"), to = mv(f, "to");
            java.util.Map<String, String> m = new java.util.HashMap<>();
            m.put("type", "ride"); m.put("bookingId", id); m.put("veh", veh); m.put("kind", sv(f, "kind"));
            double fare = nv(f, "fare"), tip = nv(f, "tip"), w = nv(f, "when"), la = nv(from, "lat"), lo = nv(from, "lon");
            m.put("fare", Double.isNaN(fare) ? "" : String.valueOf(Math.round(fare))); m.put("tip", Double.isNaN(tip) ? "0" : String.valueOf(Math.round(tip)));
            m.put("from", sv(from, "ta").isEmpty() ? sv(from, "en") : sv(from, "ta")); m.put("to", sv(to, "ta").isEmpty() ? sv(to, "en") : sv(to, "ta"));
            m.put("flat", Double.isNaN(la) ? "" : String.valueOf(la)); m.put("flon", Double.isNaN(lo) ? "" : String.valueOf(lo)); m.put("when", Double.isNaN(w) ? "" : String.valueOf((long) w));
            found++;
            Log.i(TAG, "poll found " + id);
            RideFallback.onPush(ctx, m);   // same checks and the same single ring as a pushed ride
        }
    }

    /** network came back after a gap: send the position at once (not at the next 30 s beat) */
    void networkBack() { if (running && h != null && last != null) h.post(() -> { sentAt = 0; send(last); }); }

    private static JSONObject dbl(double v) throws Exception { return new JSONObject().put("doubleValue", v); }

    /* ---------- 1.0.20: the checks before the phone rings a ride by itself (RideFallback) ---------- */
    static final double R1 = 3, R2 = 4;   // km, the same as the page (LOCAL_R1 / LOCAL_R2)

    /** km from this phone's last position to a pickup point, or -1 if either is unknown */
    static double lastKm(String lat, String lon) {
        NativeLive n = inst; Location l = n == null ? null : n.last;
        try { if (l == null || lat == null || lat.isEmpty() || lon == null || lon.isEmpty()) return -1; return hav(l.getLatitude(), l.getLongitude(), Double.parseDouble(lat), Double.parseDouble(lon)); }
        catch (Exception e) { return -1; }
    }
    static double hav(double a1, double o1, double a2, double o2) {
        double r = Math.PI / 180, dl = (a2 - a1) * r, dn = (o2 - o1) * r;
        double h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
        return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    private static String sv(JSONObject f, String k) { JSONObject v = f == null ? null : f.optJSONObject(k); return v == null ? "" : v.optString("stringValue", ""); }
    private static double nv(JSONObject f, String k) {
        JSONObject v = f == null ? null : f.optJSONObject(k); if (v == null) return Double.NaN;
        if (v.has("doubleValue")) return v.optDouble("doubleValue", Double.NaN);
        if (v.has("integerValue")) try { return Double.parseDouble(v.optString("integerValue")); } catch (Exception e) { return Double.NaN; }
        return Double.NaN;
    }
    private static JSONObject mv(JSONObject f, String k) { JSONObject v = f == null ? null : f.optJSONObject(k); v = v == null ? null : v.optJSONObject("mapValue"); return v == null ? null : v.optJSONObject("fields"); }

    /**
     * Read the ride (signed in as this driver; the database rules apply) and decide like the page: null = ring now,
     * "wait:&lt;ms&gt;" = 3–4 km, its turn comes later, anything else = why not. Runs on the caller's thread (not the main one).
     */
    String checkRide(String id) {
        try {
            if (!hasCreds(ctx)) return "no sign-in";
            String tok = token(); if (tok == null) return "token";
            String proj = pref("proj"), phone = pref("phone");
            String base = fsBase + "/v1/projects/" + proj + "/databases/(default)/documents";
            StringBuilder out = new StringBuilder();
            int code = http("GET", base + "/bookings/" + URLEncoder.encode(id, "UTF-8"), null, null, tok, out);
            if (code == 404) return "gone";
            if (code != 200) { if (code == 401 || code == 403) { idToken = null; tokenExp = 0; } return "read:" + code; }
            JSONObject f = new JSONObject(out.toString()).optJSONObject("fields");
            if (f == null) return "empty";
            String st = sv(f, "status"); if (!"searching".equals(st)) return "status:" + st;
            String kind = sv(f, "kind"); if ("outstation".equals(kind) || "rental".equals(kind)) return "kind:" + kind;
            JSONObject ex = f.optJSONObject("exclude"); ex = ex == null ? null : ex.optJSONObject("arrayValue");
            if (ex != null && ex.optJSONArray("values") != null) { JSONArray vs = ex.optJSONArray("values"); for (int i = 0; i < vs.length(); i++) if (phone.equals(vs.optJSONObject(i).optString("stringValue"))) return "excluded"; }
            long now = System.currentTimeMillis();
            double when = nv(f, "when");
            if (!Double.isNaN(when) && now - when > 15 * 60000) return "stale";
            JSONObject from = mv(f, "from");
            double plat = nv(from, "lat"), plon = nv(from, "lon"), tip = nv(f, "tip");
            Location l = last;
            if (l != null && !Double.isNaN(plat) && !Double.isNaN(plon)) {
                double km = hav(l.getLatitude(), l.getLongitude(), plat, plon);
                if (km > R2) return "far:" + Math.round(km * 10) / 10.0;
                if (km > R1 && !(tip > 0)) { long due = (long) (Double.isNaN(when) ? now : when) + RideFallback.WAVE_MS - now; if (due > 0) return "wait:" + due; }
            }
            // already on a ride (assigned now, or on the trip): the page offers nothing new then
            JSONObject q = new JSONObject().put("structuredQuery", new JSONObject()
                    .put("from", new JSONArray().put(new JSONObject().put("collectionId", "bookings")))
                    .put("where", new JSONObject().put("fieldFilter", new JSONObject().put("field", new JSONObject().put("fieldPath", "driverPhone"))
                            .put("op", "EQUAL").put("value", new JSONObject().put("stringValue", phone))))
                    .put("orderBy", new JSONArray().put(new JSONObject().put("field", new JSONObject().put("fieldPath", "createdAt")).put("direction", "DESCENDING")))
                    .put("limit", 10));
            out.setLength(0);
            code = http("POST", base + ":runQuery", "application/json", q.toString(), tok, out);
            if (code != 200) return "busy?:" + code;
            JSONArray rows = new JSONArray(out.toString());
            for (int i = 0; i < rows.length(); i++) {
                JSONObject d = rows.optJSONObject(i); d = d == null ? null : d.optJSONObject("document"); if (d == null) continue;
                JSONObject bf = d.optJSONObject("fields"); String s2 = sv(bf, "status");
                double w2 = nv(bf, "when");
                if ("ontrip".equals(s2) || ("assigned".equals(s2) && (Double.isNaN(w2) || w2 <= now + 45 * 60000))) return "busy";
            }
            return null;
        } catch (Exception e) { Log.w(TAG, "checkRide", e); return "error:" + e.getClass().getSimpleName(); }
    }

    /** a fresh ID token from the sign-in refresh token (valid 1 h; renewed 5 min before it ends) */
    private String token() throws Exception {
        if (idToken != null && System.currentTimeMillis() < tokenExp - 300000) return idToken;
        String key = pref("key"), rt = pref("rt");
        if (key.isEmpty() || rt.isEmpty()) return null;
        StringBuilder out = new StringBuilder();
        int code = http(tokenBase + "/v1/token?key=" + URLEncoder.encode(key, "UTF-8"), "application/x-www-form-urlencoded",
                "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(rt, "UTF-8"), null, out);
        if (code != 200) { lastErr = "token:" + code; Log.w(TAG, "token " + code); return null; }
        JSONObject j = new JSONObject(out.toString());
        idToken = j.getString("id_token");
        tokenExp = System.currentTimeMillis() + 1000L * Long.parseLong(j.optString("expires_in", "3600"));
        String nrt = j.optString("refresh_token", "");
        if (nrt.length() > 0 && !nrt.equals(rt)) ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("rt", nrt).apply();
        return idToken;
    }

    private static int http(String url, String type, String body, String bearer, StringBuilder out) throws Exception { return http("POST", url, type, body, bearer, out); }

    private static int http(String method, String url, String type, String body, String bearer, StringBuilder out) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(10000); c.setReadTimeout(10000); c.setRequestMethod(method);
            if (bearer != null) c.setRequestProperty("Authorization", "Bearer " + bearer);
            if (body != null) {
                c.setDoOutput(true); c.setRequestProperty("Content-Type", type);
                byte[] b = body.getBytes("UTF-8");
                try (OutputStream os = c.getOutputStream()) { os.write(b); }
            }
            int code = c.getResponseCode();
            if (out != null) {
                InputStream is = code < 400 ? c.getInputStream() : c.getErrorStream();
                if (is != null) { ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[4096]; int n; while ((n = is.read(buf)) > 0) bo.write(buf, 0, n); out.append(bo.toString("UTF-8")); is.close(); }
            }
            return code;
        } finally { c.disconnect(); }
    }

    /** the same geohash the page writes (core/geo.js VGEO.gh, 7 characters) */
    static String geohash(double lat, double lon, int prec) {
        final String B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
        double[] la = {-90, 90}, lo = {-180, 180};
        StringBuilder s = new StringBuilder(); int bit = 0, ch = 0; boolean even = true;
        while (s.length() < prec) {
            double[] r = even ? lo : la; double v = even ? lon : lat, mid = (r[0] + r[1]) / 2;
            if (v >= mid) { ch = ch * 2 + 1; r[0] = mid; } else { ch = ch * 2; r[1] = mid; }
            even = !even; if (++bit == 5) { s.append(B32.charAt(ch)); bit = 0; ch = 0; }
        }
        return s.toString();
    }
}
