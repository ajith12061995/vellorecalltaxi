package app.velloretaxi.driver;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.util.Locale;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ride alerts over other apps, for a driver who is ONLINE but looking at another app or on a call.
 *
 *  - online({on})   the web page tells us the driver's switch. While ON and the app is not on screen, a small round
 *                   icon floats at the screen edge; a tap brings the app back.
 *  - ring({id,title,line1,line2,fare,accept,open,secs})  a new ride request: a card over whatever is on screen, the
 *                   phone's ringtone in a loop and vibration, until stop() / a button / secs.
 *  - stop()         the request ended (accepted, declined, taken by another driver, timed out).
 *  - take()         → {action:"accept"|"open"|null, id}: what the driver pressed on the card, read once by the page
 *                   when the app comes to the front (the page then accepts the ride itself, with all its checks).
 *  - status()       → {can:boolean}: is "display over other apps" allowed.   ask() opens that settings screen.
 *
 * Nothing here talks to the network or decides anything about a ride: it only shows what the page gives it.
 * It runs inside the app's own process, which stays alive while the driver is online (the location service).
 * Without the "display over other apps" permission nothing is drawn; the ringtone and vibration still work.
 */
@CapacitorPlugin(name = "RideOverlay")
public class RideOverlayPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private View card;
    private Ringtone tone;
    private Vibrator vib;
    private boolean online, visible = true;
    private static String action, actionId;
    private String ringId;
    private static RideOverlayPlugin inst;
    /* 1.0.17 voice: Tamil if the phone has a Tamil voice, else Indian English, else none */
    private TextToSpeech tts;
    private volatile String ttsLang = "";
    private Runnable timeout;

    @Override
    public void load() {
        wm = (WindowManager) getContext().getApplicationContext().getSystemService(Context.WINDOW_SERVICE);
        vib = (Vibrator) getContext().getApplicationContext().getSystemService(Context.VIBRATOR_SERVICE);
        android.util.Log.i("RideOverlay", "load " + System.identityHashCode(this));
        inst = this;
        try {
            tts = new TextToSpeech(getContext().getApplicationContext(), st -> {
                if (st != TextToSpeech.SUCCESS || tts == null) { android.util.Log.i("RideOverlay", "tts unavailable"); return; }
                int r = tts.setLanguage(new Locale("ta", "IN"));
                if (r >= TextToSpeech.LANG_AVAILABLE) ttsLang = "ta";
                else { r = tts.setLanguage(new Locale("en", "IN")); ttsLang = r >= TextToSpeech.LANG_AVAILABLE ? "en" : ""; }
                tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                android.util.Log.i("RideOverlay", "tts ready lang=" + ttsLang);
            });
        } catch (Exception e) { tts = null; }
    }

    /** a button on the lock-screen ride screen (RideRingActivity): remember it for take(), and go quiet */
    static void pressed(String act, String id) {
        action = act; actionId = id;
        RideFallback.stopTone();
        RideOverlayPlugin p = inst; if (p != null) p.main.post(p::silence);
    }

    /** a push from the server (VctMessagingService): wake the page so it checks for rides now */
    static boolean wake(JSObject data) {
        RideOverlayPlugin p = inst; if (p == null || p.getBridge() == null) { android.util.Log.i("RideOverlay", "wake: no page"); return false; }
        // a window event in the page ("vctwake"): needs no listener registered on this side, so it reaches whatever page is loaded
        // the push fields go as one JSON text in e.vct (a field named like an Event property, e.g. "type", would break the event)
        JSObject ev = new JSObject(); ev.put("vct", data.toString());
        final String json = ev.toString();
        p.main.post(() -> { try { p.getBridge().triggerWindowJSEvent("vctwake", json); } catch (Exception e) { android.util.Log.w("RideOverlay", "wake event", e); } });
        try { if (p.hasListeners("wake")) p.notifyListeners("wake", data, false); } catch (Exception e) { /* page listener is optional */ }
        android.util.Log.i("RideOverlay", "wake sent");
        return true;
    }

    /** a debug build (the CI emulator test app); the Play Store app is never debuggable */
    private boolean debug() { return (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0; }
    private boolean can() { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(getContext()); }
    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics())); }
    private int type() { return Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE; }

    @PluginMethod
    public void status(PluginCall call) { JSObject r = new JSObject(); r.put("can", can()); call.resolve(r); }

    @PluginMethod
    public void ask(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) { /* some phones have no such screen */ }
        call.resolve();
    }

    @PluginMethod
    public void online(PluginCall call) {
        online = Boolean.TRUE.equals(call.getBoolean("on", false));
        android.util.Log.i("RideOverlay", "online " + System.identityHashCode(this) + " " + online);
        // the switch lives in DutyService from now on: notification, floating icon, coming back after being swiped away
        if (online != DutyService.isOn(getContext()) || online) DutyService.setOn(getContext(), online);
        call.resolve();
    }

    @PluginMethod
    public void ring(PluginCall call) {
        final String id = call.getString("id", "");
        final String title = call.getString("title", "New ride");
        final String l1 = call.getString("line1", ""), l2 = call.getString("line2", ""), fare = call.getString("fare", "");
        final String acc = call.getString("accept", "Accept"), open = call.getString("open", "Open");
        final int secs = Math.max(5, Math.min(60, call.getInt("secs", 20)));
        final String say = call.getString("say", ""), sayEn = call.getString("sayEn", "");
        // 1.0.16 card (Rapido-like); older pages send only title / line1 / line2 / fare
        final String[] r = { call.getString("veh", ""), call.getString("pay", ""), call.getString("pkm", ""), call.getString("pname", ""), call.getString("psub", ""),
                call.getString("dkm", ""), call.getString("dname", ""), call.getString("dsub", ""), call.getString("extra", "") };
        RideFallback.handled(id);   // the page rang it: the phone does not ring it a second time
        Bundle bd = new Bundle();
        bd.putString("id", id); bd.putString("title", title); bd.putString("line1", l1); bd.putString("line2", l2); bd.putString("fare", fare);
        bd.putString("accept", acc); bd.putString("open", open); bd.putInt("secs", secs);
        String[] k = {"veh", "pay", "pkm", "pname", "psub", "dkm", "dname", "dsub", "extra"};
        for (int x = 0; x < k.length; x++) bd.putString(k[x], r[x]);
        main.post(() -> doRing(bd, say, sayEn, false));
        call.resolve();
    }

    /** ring one ride: over the lock screen when locked, else the card over other apps (or the ride screen if no card) */
    private void doRing(Bundle bd, String say, String sayEn, boolean fromPhone) {
        final String id = bd.getString("id", "");
        final int secs = bd.getInt("secs", 20);
        endRing();
        ringId = id;
        announce(id, say, sayEn);
        android.util.Log.i("RideOverlay", "ring visible=" + visible + " can=" + can() + " phone=" + fromPhone);
        if (RideRingActivity.locked(getContext()) || (fromPhone && !(!visible && can()))) {
            // phone locked / screen off: like an incoming call, the ride comes over the lock screen
            RideRingActivity.open(getContext(), bd);
        } else if (!visible && can()) {
            String[] r = { bd.getString("veh", ""), bd.getString("pay", ""), bd.getString("pkm", ""), bd.getString("pname", ""), bd.getString("psub", ""),
                    bd.getString("dkm", ""), bd.getString("dname", ""), bd.getString("dsub", ""), bd.getString("extra", "") };
            showCard(id, bd.getString("title", "New ride"), bd.getString("line1", ""), bd.getString("line2", ""), bd.getString("fare", ""),
                    bd.getString("accept", "Accept"), bd.getString("open", "Open"), r, secs);
        }
        timeout = this::endRing;
        main.postDelayed(timeout, secs * 1000L);
    }

    /** 1.0.20: the phone rings a ride by itself (RideFallback) — the page did not answer the push in time */
    static void nativeRing(Context a, Bundle bd, String say, String sayEn) {
        RideFallback.handled(bd.getString("id", ""));   // the same ride pushed again is not rung a second time
        RideOverlayPlugin p = inst;
        if (p != null) { p.main.post(() -> p.doRing(bd, say, sayEn, true)); return; }
        RideFallback.playTone(a);           // no page at all: the ride screen with a plain ringtone
        RideRingActivity.open(a, bd);
    }

    /** 1.0.20: the page took care of a pushed ride (rang it, or it is not for this driver now) */
    @PluginMethod
    public void seen(PluginCall call) { RideFallback.handled(call.getString("id", "")); call.resolve(); }

    @PluginMethod
    public void stop(PluginCall call) { main.post(this::endRing); call.resolve(); }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject r = new JSObject();
        r.put("action", action == null ? JSObject.NULL : action);
        r.put("id", actionId == null ? JSObject.NULL : actionId);
        action = null; actionId = null;
        call.resolve(r);
    }

    @Override
    protected void handleOnResume() { super.handleOnResume(); visible = true; DutyService.owner = System.identityHashCode(this); DutyService.appVisible = true; android.util.Log.i("RideOverlay", "resume " + System.identityHashCode(this)); main.post(() -> { removeCard(); DutyService.sync(); }); }

    @Override
    protected void handleOnPause() { super.handleOnPause(); visible = false; if (DutyService.owner == System.identityHashCode(this)) DutyService.appVisible = false; android.util.Log.i("RideOverlay", "pause " + System.identityHashCode(this) + " online=" + online); DutyService.sync(); }

    @Override
    protected void handleOnDestroy() { android.util.Log.i("RideOverlay", "destroy " + System.identityHashCode(this)); visible = false; if (DutyService.owner == System.identityHashCode(this)) DutyService.appVisible = false; main.post(this::endRing); DutyService.sync(); super.handleOnDestroy(); }

    /** the page is running again (online, location started): an app that DutyService reopened goes back behind the other app */
    @PluginMethod
    public void ready(PluginCall call) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).backIfReopened();
        call.resolve();
    }

    /* ---------- 1.0.17: position from the phone itself, lock-screen rides ---------- */
    /** the page gives what the phone needs to send the position itself while the app is not on screen (see NativeLive) */
    @PluginMethod
    public void liveStart(PluginCall call) {
        String key = call.getString("apiKey", ""), proj = call.getString("project", ""), phone = call.getString("phone", ""), rt = call.getString("refresh", "");
        if (key.isEmpty() || proj.isEmpty() || phone.isEmpty() || rt.isEmpty()) { call.reject("missing"); return; }
        if (debug()) {   // CI emulator test: point the two Google endpoints at the test server
            String tb = call.getString("tokenBase", ""), fb = call.getString("fsBase", "");
            if (!tb.isEmpty()) NativeLive.tokenBase = tb; if (!fb.isEmpty()) NativeLive.fsBase = fb;
        }
        NativeLive.setCreds(getContext(), key, proj, phone, rt);
        if (DutyService.isOn(getContext())) DutyService.setOn(getContext(), true);   // the service starts NativeLive
        call.resolve();
    }

    @PluginMethod
    public void liveStop(PluginCall call) {
        NativeLive.get(getContext()).stop();
        if (Boolean.TRUE.equals(call.getBoolean("forget", false))) NativeLive.clearCreds(getContext());
        call.resolve();
    }

    @PluginMethod
    public void liveStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", NativeLive.get(getContext()).isRunning()); r.put("sends", NativeLive.sends); r.put("fails", NativeLive.fails); r.put("err", NativeLive.lastErr);
        call.resolve(r);
    }

    /** Android 14+: may rides show over the lock screen ("full-screen notifications")? and the settings screen for it */
    @PluginMethod
    public void fsi(PluginCall call) { JSObject r = new JSObject(); r.put("can", RideRingActivity.fsiAllowed(getContext())); call.resolve(r); }

    @PluginMethod
    public void askFsi(PluginCall call) {
        try {
            Intent i = Build.VERSION.SDK_INT >= 34 ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()))
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getContext().startActivity(i);
        } catch (Exception e) { /* no such screen */ }
        call.resolve();
    }

    /** CI emulator test only: what the phone does when it is being switched off */
    @PluginMethod
    public void testShutdown(PluginCall call) {
        if (!debug()) { call.reject("debug only"); return; }
        new Thread(() -> NativeLive.get(getContext()).shuttingDown()).start();
        call.resolve();
    }

    /** CI emulator test only: what a server push does when it arrives */
    @PluginMethod
    public void testPush(PluginCall call) {
        if (!debug()) { call.reject("debug only"); return; }
        java.util.Map<String, String> m = new java.util.HashMap<>();
        JSObject d = call.getObject("data", new JSObject());
        java.util.Iterator<String> it = d.keys(); while (it.hasNext()) { String k = it.next(); m.put(k, d.optString(k)); }
        final int delay = call.getInt("delay", 0);
        main.postDelayed(() -> VctMessagingService.handle(getContext(), m), delay);
        call.resolve();
    }

    /** battery: is the app free of the phone's battery limits ("No restrictions"), and the settings screen to set it */
    @PluginMethod
    public void power(PluginCall call) {
        JSObject r = new JSObject();
        boolean free = true;
        try { if (Build.VERSION.SDK_INT >= 23) free = ((android.os.PowerManager) getContext().getSystemService(Context.POWER_SERVICE)).isIgnoringBatteryOptimizations(getContext().getPackageName()); } catch (Exception e) { /* unknown → true */ }
        r.put("free", free); r.put("maker", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        call.resolve(r);
    }

    @PluginMethod
    public void askPower(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) { /* no such screen */ }
        call.resolve();
    }

    /* ---------- sound ---------- */
    private void startSound() {
        try {
            Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            tone = RingtoneManager.getRingtone(getContext().getApplicationContext(), u);
            if (tone != null) {
                tone.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                if (Build.VERSION.SDK_INT >= 28) tone.setLooping(true);
                tone.play();
            }
        } catch (Exception e) { tone = null; }
        try {
            long[] p = {0, 500, 300, 500, 900};
            if (vib != null && vib.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createWaveform(p, 0)); else vib.vibrate(p, 0);
            }
        } catch (Exception e) { /* no vibrator / not allowed */ }
    }

    /** say the ride first (a few seconds), then the ringtone; without a voice (or nothing to say) the ringtone starts at once */
    private void announce(final String id, String say, String sayEn) {
        String text = "ta".equals(ttsLang) && say.length() > 0 ? say : ("en".equals(ttsLang) || "ta".equals(ttsLang)) && sayEn.length() > 0 ? sayEn : "";
        if (tts == null || text.isEmpty()) { startSound(); return; }
        if ("ta".equals(ttsLang) && say.isEmpty()) { try { tts.setLanguage(new Locale("en", "IN")); } catch (Exception e) { /* keep */ } }
        vibrateOnly();
        final boolean[] started = { false };
        final Runnable ring = () -> { if (started[0] || !id.equals(ringId)) return; started[0] = true; startSound(); };
        try {
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String u) { android.util.Log.i("RideOverlay", "tts speaking " + ttsLang); }
                @Override public void onDone(String u) { main.post(ring); }
                @Override public void onError(String u) { main.post(ring); }
            });
            int r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ride-" + id);
            if (r != TextToSpeech.SUCCESS) { main.post(ring); return; }
        } catch (Exception e) { main.post(ring); return; }
        main.postDelayed(ring, 8000);   // never wait longer than this for the voice
    }

    private void vibrateOnly() {
        try { long[] p = {0, 500, 300, 500, 900}; if (vib != null && vib.hasVibrator()) { if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createWaveform(p, 0)); else vib.vibrate(p, 0); } } catch (Exception e) { /* none */ }
    }

    @PluginMethod
    public void voice(PluginCall call) { JSObject r = new JSObject(); r.put("lang", ttsLang); call.resolve(r); }

    private void endRing() {
        if (timeout != null) { main.removeCallbacks(timeout); timeout = null; }
        RideFallback.stopTone();
        try { if (tts != null) tts.stop(); } catch (Exception e) { /* not speaking */ }
        try { if (tone != null) tone.stop(); } catch (Exception e) { /* already stopped */ }
        tone = null;
        try { if (vib != null) vib.cancel(); } catch (Exception e) { /* nothing to cancel */ }
        removeCard();
        RideRingActivity.closeAll(getContext());
        ringId = null;
    }

    /* ---------- ride card ---------- */
    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(getContext().getApplicationContext());
        t.setText(s); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private int col(String h) { return Color.parseColor(h); }

    /** one stop of the ride: "● 0.8 km  Katpadi Junction" and the address under it, grey */
    private void stop(LinearLayout box, Context c, boolean pickup, String km, String name, String sub) {
        LinearLayout row = new LinearLayout(c); row.setOrientation(LinearLayout.HORIZONTAL); row.setPadding(0, dp(pickup ? 10 : 8), 0, 0);
        TextView dot = text(pickup ? "\u25CF" : "\u25BC", pickup ? 12 : 11, col(pickup ? "#1E8A5A" : "#0B4A36"), true);
        dot.setPadding(0, dp(3), dp(10), 0); row.addView(dot);
        LinearLayout col = new LinearLayout(c); col.setOrientation(LinearLayout.VERTICAL);
        if (km.length() > 0) col.addView(text(km, 19, col("#111111"), true));
        if (name.length() > 0) { TextView n = text(name, 15, col("#1B1B1B"), true); n.setMaxLines(1); n.setEllipsize(android.text.TextUtils.TruncateAt.END); col.addView(n); }
        if (sub.length() > 0) { TextView t = text(sub, 13, col("#66706B"), false); t.setMaxLines(2); t.setEllipsize(android.text.TextUtils.TruncateAt.END); col.addView(t); }
        row.addView(col, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        box.addView(row);
    }

    private void showCard(final String id, String title, String l1, String l2, String fare, String acc, String open, String[] r, int secs) {
        try {
            Context c = getContext().getApplicationContext();
            boolean rich = r != null && (r[2].length() > 0 || r[3].length() > 0);
            LinearLayout box = new LinearLayout(c);
            box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(18), dp(14), dp(18), dp(14));
            GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.WHITE); bg.setCornerRadius(dp(18)); bg.setStroke(dp(3), col("#1E8A5A"));
            box.setBackground(bg);
            if (Build.VERSION.SDK_INT >= 21) box.setElevation(dp(14));

            // vehicle type (or "New ride!") and, on the right, the extra / tip note
            LinearLayout top = new LinearLayout(c); top.setOrientation(LinearLayout.HORIZONTAL); top.setGravity(Gravity.CENTER_VERTICAL);
            TextView tt = text(rich && r[0].length() > 0 ? r[0] : title, 15, col("#0B4A36"), true);
            GradientDrawable chip = new GradientDrawable(); chip.setColor(col("#EEF3F0")); chip.setCornerRadius(dp(10)); tt.setBackground(chip); tt.setPadding(dp(10), dp(3), dp(10), dp(3));
            top.addView(tt);
            View sp = new View(c); top.addView(sp, new LinearLayout.LayoutParams(0, 1, 1));
            if (rich && r[8].length() > 0) top.addView(text(r[8], 13, col("#1E8A5A"), true));
            box.addView(top);

            // fare, big, with how it is paid
            if (fare != null && fare.length() > 0) {
                LinearLayout fr = new LinearLayout(c); fr.setOrientation(LinearLayout.HORIZONTAL); fr.setGravity(Gravity.BOTTOM); fr.setPadding(0, dp(6), 0, 0);
                fr.addView(text(fare, 32, col("#0B4A36"), true));
                if (rich && r[1].length() > 0) { TextView pm = text("  (" + r[1] + ")", 14, col("#66706B"), false); pm.setPadding(0, 0, 0, dp(6)); fr.addView(pm); }
                box.addView(fr);
            }
            if (rich) {
                stop(box, c, true, r[2], r[3], r[4]);
                stop(box, c, false, r[5], r[6], r[7]);
            } else {
                if (l1 != null && l1.length() > 0) { TextView a = text(l1, 15, col("#1B1B1B"), false); a.setPadding(0, dp(8), 0, 0); a.setMaxLines(2); box.addView(a); }
                if (l2 != null && l2.length() > 0) { TextView b = text(l2, 14, col("#5B6660"), false); b.setPadding(0, dp(4), 0, 0); b.setMaxLines(2); box.addView(b); }
            }

            // "−" hides the card (the request stays in the app), big Accept with the time left running down inside it
            LinearLayout row = new LinearLayout(c); row.setOrientation(LinearLayout.HORIZONTAL); row.setGravity(Gravity.CENTER_VERTICAL); row.setPadding(0, dp(14), 0, 0);
            TextView hide = text("\u2212", 26, col("#0B4A36"), false); hide.setGravity(Gravity.CENTER); hide.setContentDescription(open);
            GradientDrawable hb = new GradientDrawable(); hb.setShape(GradientDrawable.OVAL); hb.setColor(Color.WHITE); hb.setStroke(dp(2), col("#C9D3CE")); hide.setBackground(hb);
            LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(dp(50), dp(50)); hp.rightMargin = dp(12);
            row.addView(hide, hp);
            Button ba = new Button(c); ba.setText(acc); ba.setAllCaps(false); ba.setTextColor(col("#0B2A20")); ba.setTypeface(Typeface.DEFAULT_BOLD);
            ba.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
            GradientDrawable base = new GradientDrawable(); base.setColor(col("#FFE7A3")); base.setCornerRadius(dp(26));
            GradientDrawable fill = new GradientDrawable(); fill.setColor(col("#FFC21A")); fill.setCornerRadius(dp(26));
            final android.graphics.drawable.ClipDrawable clip = new android.graphics.drawable.ClipDrawable(fill, Gravity.START, android.graphics.drawable.ClipDrawable.HORIZONTAL);
            clip.setLevel(10000);
            ba.setBackground(new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[]{ base, clip }));
            row.addView(ba, new LinearLayout.LayoutParams(0, dp(54), 1));
            box.addView(row);
            try {
                android.animation.ValueAnimator va = android.animation.ValueAnimator.ofInt(10000, 0);
                va.setDuration(secs * 1000L); va.setInterpolator(new android.view.animation.LinearInterpolator());
                va.addUpdateListener(an -> clip.setLevel((int) an.getAnimatedValue()));
                va.start(); box.setTag(va);
            } catch (Exception e) { /* no countdown */ }
            hide.setOnClickListener(v -> { action = "open"; actionId = id; silence(); });
            ba.setOnClickListener(v -> { action = "accept"; actionId = id; silence(); DutyService.openApp(getContext().getApplicationContext()); });
            box.setOnClickListener(v -> { action = "open"; actionId = id; silence(); DutyService.openApp(getContext().getApplicationContext()); });

            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, type(),
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED, PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP; lp.y = dp(30);
            lp.width = getContext().getResources().getDisplayMetrics().widthPixels - dp(20);
            wm.addView(box, lp); card = box; DutyService.cardShown = true; DutyService.sync();
        } catch (Exception e) { card = null; DutyService.cardShown = false; android.util.Log.w("RideOverlay", "card not shown", e); }
    }

    /** a button was pressed: stop the noise and the card now; the page ends the request itself once it has acted */
    private void silence() {
        ringId = null;   // a voice still finishing must not start the ringtone
        try { if (tts != null) tts.stop(); } catch (Exception e) { /* not speaking */ }
        try { if (tone != null) tone.stop(); } catch (Exception e) { /* already stopped */ }
        tone = null;
        try { if (vib != null) vib.cancel(); } catch (Exception e) { /* nothing */ }
        removeCard();
    }

    private void removeCard() {
        if (card != null) {
            try { Object t = card.getTag(); if (t instanceof android.animation.ValueAnimator) ((android.animation.ValueAnimator) t).cancel(); } catch (Exception e) { /* none */ }
            try { wm.removeView(card); } catch (Exception e) { /* gone */ }
            card = null;
        }
        DutyService.cardShown = false; DutyService.sync();
    }

    private void openApp() { DutyService.openApp(getContext().getApplicationContext()); }
}
