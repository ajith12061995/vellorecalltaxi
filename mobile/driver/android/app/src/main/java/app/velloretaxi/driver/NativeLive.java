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
        Log.i(TAG, "started");
    }

    synchronized void stop() {
        if (!running) return;
        running = false;
        try { if (fused != null && cb != null) fused.removeLocationUpdates(cb); } catch (Exception e) { /* gone */ }
        if (h != null) h.removeCallbacks(beat);
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
        Log.d(TAG, "fix " + l.getProvider() + " acc=" + (l.hasAccuracy() ? Math.round(l.getAccuracy()) : -1) + " visible=" + DutyService.appVisible);
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
            JSONObject w = new JSONObject()
                    .put("update", new JSONObject().put("name", doc).put("fields", f))
                    .put("updateMask", new JSONObject().put("fieldPaths", new JSONArray().put("lat").put("lon").put("gh").put("hd").put("sp").put("acc").put("online")))
                    .put("updateTransforms", new JSONArray().put(new JSONObject().put("fieldPath", "updatedAt").put("setToServerValue", "REQUEST_TIME")));
            JSONObject body = new JSONObject().put("writes", new JSONArray().put(w));
            int code = http(fsBase + "/v1/projects/" + proj + "/databases/(default)/documents:commit", "application/json", body.toString(), tok, null);
            if (code == 200) { sent = l; sends++; }
            else { fails++; lastErr = "write:" + code; if (code == 401 || code == 403) { idToken = null; tokenExp = 0; } Log.w(TAG, "write " + code); }
        } catch (Exception e) { fails++; lastErr = "write:" + e.getClass().getSimpleName(); Log.w(TAG, "send failed", e); }
    }

    private static JSONObject dbl(double v) throws Exception { return new JSONObject().put("doubleValue", v); }

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

    private static int http(String url, String type, String body, String bearer, StringBuilder out) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(15000); c.setReadTimeout(15000); c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", type);
            if (bearer != null) c.setRequestProperty("Authorization", "Bearer " + bearer);
            byte[] b = body.getBytes("UTF-8");
            try (OutputStream os = c.getOutputStream()) { os.write(b); }
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
