package app.velloretaxi.driver;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import java.util.Map;

/**
 * 1.0.20: a new ride must ring even after the phone has slept for a long time (Android "Doze", 10–30 min locked).
 *
 * Normally the server push wakes the page and the page rings. After a long sleep the page's database connection can
 * take minutes to come back, so it could not ring in time. Now: if the page has not rung (or said "not for me") within a
 * few seconds of the push, the phone itself reads the ride from the server and rings over the lock screen.
 * It rings only when the page would: the ride is still waiting, it is a local ride, the pickup is near enough
 * (0–3 km at once; 3–4 km after 25 s or at once with a tip), this driver did not cancel it before, and the driver is not
 * already on a ride. "Accept" opens the app and the page accepts it with all its checks.
 */
public class RideFallback {
    static final String TAG = "RideFallback";
    static long WAIT_MS = 7000;            // how long the page gets to answer first
    static final long WAVE_MS = 25000;     // 3–4 km drivers get the ride 25 s after it was booked (as the page does)
    private static volatile String handledId = "";
    private static final java.util.Set<String> INFLIGHT = new java.util.HashSet<>();
    private static Ringtone tone;
    private static Vibrator vib;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Runnable toneEnd = RideFallback::stopTone;

    /** the page rang this ride, or decided it is not for this driver now */
    static void handled(String id) { if (id != null && id.length() > 0) handledId = id; }

    static void onPush(Context c, Map<String, String> d) {
        if (d == null || !"ride".equals(d.get("type"))) return;
        final String id = d.get("bookingId");
        if (id == null || id.isEmpty()) return;
        final Context a = c.getApplicationContext();
        synchronized (INFLIGHT) { if (!INFLIGHT.add(id)) return; }   // a push and the phone's own lookup for the same ride: one check, one ring
        new Thread(() -> {
            PowerManager.WakeLock wl = null;
            try { wl = ((PowerManager) a.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vct:ride"); wl.acquire(45000); } catch (Exception e) { wl = null; }
            try {
                if (waitPage(id, WAIT_MS)) { Log.i(TAG, "page handled " + id); return; }
                for (int round = 0; round < 2; round++) {
                    if (!DutyService.isOn(a)) { Log.i(TAG, "off " + id); return; }
                    String why = NativeLive.get(a).checkRide(id);
                    if (why == null) break;
                    if (why.startsWith("wait:") && round == 0) {
                        long ms = Math.min(WAVE_MS + 2000, Math.max(0, Long.parseLong(why.substring(5))));
                        Log.i(TAG, "3–4 km: waiting " + ms + " ms " + id);
                        if (waitPage(id, ms)) { Log.i(TAG, "page handled " + id); return; }
                        continue;
                    }
                    Log.i(TAG, "no ring " + id + ": " + why); return;
                }
                if (id.equals(handledId)) return;
                Log.i(TAG, "fallback ring " + id);
                RideOverlayPlugin.nativeRing(a, bundle(d), say(d, true), say(d, false));
            } catch (Exception e) { Log.w(TAG, "fallback", e); }
            finally { synchronized (INFLIGHT) { INFLIGHT.remove(id); } try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception e) { /* released */ } }
        }, "vct-ride").start();
    }

    private static boolean waitPage(String id, long ms) throws InterruptedException {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) { if (id.equals(handledId)) return true; Thread.sleep(250); }
        return id.equals(handledId);
    }

    private static String g(Map<String, String> d, String k) { String v = d.get(k); return v == null ? "" : v; }

    private static String fare(Map<String, String> d) {
        String f = g(d, "fare"); if (f.isEmpty() || "0".equals(f)) return "";
        return "₹" + f;
    }

    static Bundle bundle(Map<String, String> d) {
        Bundle b = new Bundle();
        String kind = g(d, "kind");
        b.putString("id", g(d, "bookingId"));
        b.putString("title", "புது சவாரி · New ride");
        b.putString("fare", fare(d));
        String tip = g(d, "tip");
        b.putString("extra", tip.length() > 0 && !"0".equals(tip) ? "+ ₹" + tip + " tip" : "");
        b.putString("veh", vehName(g(d, "veh")));
        b.putString("pname", g(d, "from")); b.putString("psub", "");
        double km = NativeLive.lastKm(g(d, "flat"), g(d, "flon"));
        b.putString("pkm", km >= 0 ? String.format(java.util.Locale.US, "%.1f km", km) : "");
        b.putString("dname", g(d, "to")); b.putString("dsub", ""); b.putString("dkm", "");
        b.putString("line1", g(d, "from") + (g(d, "to").length() > 0 ? " → " + g(d, "to") : ""));
        b.putString("accept", "Accept"); b.putString("open", "Later");
        b.putInt("secs", 30);
        b.putString("kind", kind);
        return b;
    }

    private static String vehName(String v) {
        switch (v) { case "auto": return "Auto"; case "bike": return "Bike"; case "mini": return "Mini"; case "sedan": return "Sedan"; case "suv": return "SUV"; default: return v; }
    }

    static String say(Map<String, String> d, boolean ta) {
        String from = g(d, "from"), f = g(d, "fare");
        double km = NativeLive.lastKm(g(d, "flat"), g(d, "flon"));
        String dist = km < 0 ? "" : km < 1 ? (Math.round(km * 1000) + (ta ? " மீட்டர் தூரம். " : " metres away. "))
                : (String.format(java.util.Locale.US, "%.1f", km) + (ta ? " கிலோமீட்டர் தூரம். " : " kilometres away. "));
        String money = f.isEmpty() || "0".equals(f) ? "" : f + (ta ? " ரூபாய்." : " rupees.");
        return ((ta ? "புது சவாரி. " : "New ride. ") + (from.isEmpty() ? "" : from + ". ") + dist + money).trim();
    }

    /* ---------- a plain ringtone when no page is loaded at all (the app process was just started by the push) ---------- */
    static synchronized void playTone(Context a) {
        stopTone();
        try {
            Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            tone = RingtoneManager.getRingtone(a, u);
            if (tone != null) {
                tone.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                if (Build.VERSION.SDK_INT >= 28) tone.setLooping(true);
                tone.play();
            }
        } catch (Exception e) { tone = null; }
        try {
            vib = (Vibrator) a.getSystemService(Context.VIBRATOR_SERVICE);
            long[] p = {0, 500, 300, 500, 900};
            if (vib != null && vib.hasVibrator()) { if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createWaveform(p, 0)); else vib.vibrate(p, 0); }
        } catch (Exception e) { /* none */ }
        main.removeCallbacks(toneEnd); main.postDelayed(toneEnd, 30000);
    }

    static synchronized void stopTone() {
        main.removeCallbacks(toneEnd);
        try { if (tone != null) tone.stop(); } catch (Exception e) { /* stopped */ }
        tone = null;
        try { if (vib != null) vib.cancel(); } catch (Exception e) { /* none */ }
        vib = null;
    }
}
