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
    private View bubble, card;
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
        main.post(this::syncBubble);
        call.resolve();
    }

    @PluginMethod
    public void ring(PluginCall call) {
        final String id = call.getString("id", "");
        final String title = call.getString("title", "New ride");
        final String l1 = call.getString("line1", ""), l2 = call.getString("line2", ""), fare = call.getString("fare", "");
        final String acc = call.getString("accept", "Accept"), open = call.getString("open", "Open");
        final int secs = Math.max(5, Math.min(60, call.getInt("secs", 20)));
        main.post(() -> {
            endRing();
            ringId = id;
            startSound();
            android.util.Log.i("RideOverlay", "ring visible=" + visible + " can=" + can());
            if (!visible && can()) showCard(id, title, l1, l2, fare, acc, open);
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
    protected void handleOnResume() { super.handleOnResume(); visible = true; android.util.Log.i("RideOverlay", "resume " + System.identityHashCode(this)); main.post(() -> { removeCard(); syncBubble(); }); }

    @Override
    protected void handleOnPause() { super.handleOnPause(); visible = false; android.util.Log.i("RideOverlay", "pause " + System.identityHashCode(this) + " online=" + online); main.post(this::syncBubble); }

    @Override
    protected void handleOnDestroy() { android.util.Log.i("RideOverlay", "destroy " + System.identityHashCode(this)); main.post(() -> { endRing(); removeBubble(); }); super.handleOnDestroy(); }

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

    /* ---------- floating icon while online ---------- */
    private void syncBubble() {
        boolean want = online && !visible && can() && card == null;
        android.util.Log.i("RideOverlay", "sync " + System.identityHashCode(this) + " online=" + online + " visible=" + visible + " card=" + (card != null) + " bubble=" + (bubble != null) + " want=" + want);
        // the icon was taken off the screen by the system (it is no longer attached): draw it again
        if (want && bubble != null && Build.VERSION.SDK_INT >= 19 && !bubble.isAttachedToWindow()) { try { wm.removeView(bubble); } catch (Exception e) { /* gone */ } bubble = null; }
        if (want && bubble == null) showBubble(); else if (!want) removeBubble();
    }

    private void showBubble() {
        try {
            ImageView v = new ImageView(getContext().getApplicationContext());
            v.setImageResource(getContext().getApplicationInfo().icon);
            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.OVAL); bg.setColor(Color.WHITE); bg.setStroke(dp(2), Color.parseColor("#12664A"));
            v.setBackground(bg); v.setPadding(dp(4), dp(4), dp(4), dp(4));
            if (Build.VERSION.SDK_INT >= 21) v.setElevation(dp(6));
            final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(dp(52), dp(52), type(),
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START; lp.x = dp(6); lp.y = dp(220);
            v.setOnTouchListener(new View.OnTouchListener() {
                float sx, sy; int ox, oy; boolean moved;
                @Override public boolean onTouch(View view, MotionEvent e) {
                    switch (e.getAction()) {
                        case MotionEvent.ACTION_DOWN: sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y; moved = false; return true;
                        case MotionEvent.ACTION_MOVE:
                            if (Math.abs(e.getRawX() - sx) > dp(6) || Math.abs(e.getRawY() - sy) > dp(6)) moved = true;
                            lp.x = ox + (int) (e.getRawX() - sx); lp.y = oy + (int) (e.getRawY() - sy);
                            try { wm.updateViewLayout(view, lp); } catch (Exception x) { /* view gone */ }
                            return true;
                        case MotionEvent.ACTION_UP: if (!moved) openApp(); return true;
                        default: return false;
                    }
                }
            });
            wm.addView(v, lp); bubble = v;
        } catch (Exception e) { bubble = null; android.util.Log.w("RideOverlay", "icon not shown", e); }
    }

    private void removeBubble() { if (bubble != null) { try { wm.removeView(bubble); } catch (Exception e) { /* gone */ } bubble = null; } }

    /* ---------- ride card ---------- */
    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(getContext().getApplicationContext());
        t.setText(s); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private void showCard(final String id, String title, String l1, String l2, String fare, String acc, String open) {
        try {
            removeBubble();
            Context c = getContext().getApplicationContext();
            LinearLayout box = new LinearLayout(c);
            box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(18), dp(16), dp(18), dp(16));
            GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.WHITE); bg.setCornerRadius(dp(20)); bg.setStroke(dp(2), Color.parseColor("#FFC21A"));
            box.setBackground(bg);
            if (Build.VERSION.SDK_INT >= 21) box.setElevation(dp(12));

            LinearLayout top = new LinearLayout(c); top.setOrientation(LinearLayout.HORIZONTAL); top.setGravity(Gravity.CENTER_VERTICAL);
            TextView tt = text(title, 17, Color.parseColor("#0B4A36"), true);
            top.addView(tt, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            if (fare != null && fare.length() > 0) top.addView(text(fare, 24, Color.parseColor("#0B4A36"), true));
            box.addView(top);
            if (l1 != null && l1.length() > 0) { TextView a = text(l1, 15, Color.parseColor("#1B1B1B"), false); a.setPadding(0, dp(8), 0, 0); a.setMaxLines(2); box.addView(a); }
            if (l2 != null && l2.length() > 0) { TextView b = text(l2, 14, Color.parseColor("#5B6660"), false); b.setPadding(0, dp(4), 0, 0); b.setMaxLines(2); box.addView(b); }

            LinearLayout row = new LinearLayout(c); row.setOrientation(LinearLayout.HORIZONTAL); row.setPadding(0, dp(14), 0, 0);
            Button bo = new Button(c); bo.setText(open); bo.setAllCaps(false); bo.setTextColor(Color.parseColor("#0B4A36"));
            GradientDrawable g1 = new GradientDrawable(); g1.setColor(Color.parseColor("#EEF3F0")); g1.setCornerRadius(dp(14)); bo.setBackground(g1);
            Button ba = new Button(c); ba.setText(acc); ba.setAllCaps(false); ba.setTextColor(Color.parseColor("#0B4A36")); ba.setTypeface(Typeface.DEFAULT_BOLD);
            ba.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
            GradientDrawable g2 = new GradientDrawable(); g2.setColor(Color.parseColor("#FFC21A")); g2.setCornerRadius(dp(14)); ba.setBackground(g2);
            LinearLayout.LayoutParams p1 = new LinearLayout.LayoutParams(0, dp(52), 1); p1.rightMargin = dp(10);
            row.addView(bo, p1); row.addView(ba, new LinearLayout.LayoutParams(0, dp(52), 2));
            box.addView(row);
            bo.setOnClickListener(v -> { action = "open"; actionId = id; silence(); openApp(); });
            ba.setOnClickListener(v -> { action = "accept"; actionId = id; silence(); openApp(); });

            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, type(),
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED, PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP; lp.y = dp(36); lp.horizontalMargin = 0.03f;
            lp.width = getContext().getResources().getDisplayMetrics().widthPixels - dp(24);
            wm.addView(box, lp); card = box;
        } catch (Exception e) { card = null; android.util.Log.w("RideOverlay", "card not shown", e); }
    }

    /** a button was pressed: stop the noise and the card now; the page ends the request itself once it has acted */
    private void silence() {
        try { if (tone != null) tone.stop(); } catch (Exception e) { /* already stopped */ }
        tone = null;
        try { if (vib != null) vib.cancel(); } catch (Exception e) { /* nothing */ }
        removeCard();
    }

    private void removeCard() { if (card != null) { try { wm.removeView(card); } catch (Exception e) { /* gone */ } card = null; } }

    private void openApp() {
        try {
            Intent i = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
            if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP); getContext().getApplicationContext().startActivity(i); }
        } catch (Exception e) { /* cannot come to the front: the notification is still there */ }
    }
}
