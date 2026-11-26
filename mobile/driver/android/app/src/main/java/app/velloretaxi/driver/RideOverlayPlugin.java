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
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
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
    private String action, actionId, ringId;
    private Runnable timeout;

    @Override
    public void load() {
        wm = (WindowManager) getContext().getApplicationContext().getSystemService(Context.WINDOW_SERVICE);
        vib = (Vibrator) getContext().getApplicationContext().getSystemService(Context.VIBRATOR_SERVICE);
        android.util.Log.i("RideOverlay", "load " + System.identityHashCode(this));
    }

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
        // 1.0.16 card (Rapido-like); older pages send only title / line1 / line2 / fare
        final String[] r = { call.getString("veh", ""), call.getString("pay", ""), call.getString("pkm", ""), call.getString("pname", ""), call.getString("psub", ""),
                call.getString("dkm", ""), call.getString("dname", ""), call.getString("dsub", ""), call.getString("extra", "") };
        main.post(() -> {
            endRing();
            ringId = id;
            startSound();
            android.util.Log.i("RideOverlay", "ring visible=" + visible + " can=" + can());
            if (!visible && can()) showCard(id, title, l1, l2, fare, acc, open, r, secs);
            timeout = this::endRing;
            main.postDelayed(timeout, secs * 1000L);
        });
        call.resolve();
    }

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

    private void endRing() {
        if (timeout != null) { main.removeCallbacks(timeout); timeout = null; }
        try { if (tone != null) tone.stop(); } catch (Exception e) { /* already stopped */ }
        tone = null;
        try { if (vib != null) vib.cancel(); } catch (Exception e) { /* nothing to cancel */ }
        removeCard();
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
