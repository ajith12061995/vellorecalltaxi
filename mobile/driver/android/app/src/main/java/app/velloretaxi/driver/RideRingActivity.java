package app.velloretaxi.driver;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ClipDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.lang.ref.WeakReference;

/**
 * A new ride while the phone is LOCKED or the screen is OFF — like an incoming call (Rapido / Uber / Ola):
 * the screen turns on and the ride shows over the lock screen with the ringtone (played by RideOverlayPlugin).
 * Accept → the driver unlocks (fingerprint / PIN) → the app opens and the page accepts the ride with all its checks.
 * "Later" → quiet; the request stays in the app until it ends.
 *
 * How it reaches the screen: a full-screen notification (category CALL) and, when the driver has allowed
 * "Display over other apps", also started directly. Both open this one screen.
 */
public class RideRingActivity extends Activity {
    static final String TAG = "RideRing";
    static final String CH = "ride_ring";
    static final int NOTE_ID = 4712;
    private static WeakReference<RideRingActivity> cur = new WeakReference<>(null);
    static volatile boolean showing = false;

    private String id = "";
    private android.animation.ValueAnimator va;

    /* ---------- open / close (called by RideOverlayPlugin) ---------- */
    static boolean locked(Context c) {
        try {
            KeyguardManager km = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            return (km != null && km.isKeyguardLocked()) || (pm != null && !pm.isInteractive());
        } catch (Exception e) { return false; }
    }

    static void open(Context c, Bundle ride) {
        Context a = c.getApplicationContext();
        Intent i = new Intent(a, RideRingActivity.class).putExtras(ride)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        // 1) full-screen notification: Android shows the screen over the lock screen (if the driver allowed full-screen alerts)
        try {
            NotificationManager nm = (NotificationManager) a.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
                NotificationChannel ch = new NotificationChannel(CH, "Ride requests (lock screen)", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("A new ride while the phone is locked"); ch.setSound(null, null); ch.enableVibration(false);
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(ch);
            }
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pi = PendingIntent.getActivity(a, 7, i, fl);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(a, CH) : new Notification.Builder(a);
            String fare = ride.getString("fare", ""), veh = ride.getString("veh", "");
            b.setSmallIcon(a.getApplicationInfo().icon).setContentTitle((veh.length() > 0 ? veh + " · " : "") + "New ride " + fare)
                    .setContentText(ride.getString("pname", ride.getString("line1", ""))).setCategory(Notification.CATEGORY_CALL)
                    .setPriority(Notification.PRIORITY_MAX).setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(true).setAutoCancel(true)
                    .setContentIntent(pi).setFullScreenIntent(pi, true).setColor(Color.parseColor("#12664A"));
            nm.notify(NOTE_ID, b.build());
        } catch (Exception e) { Log.w(TAG, "notification refused", e); }
        // 2) direct start (allowed from the background while "Display over other apps" is on)
        try { if (Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(a)) a.startActivity(i); } catch (Exception e) { Log.w(TAG, "direct start refused", e); }
    }

    static void closeAll(Context c) {
        try { ((NotificationManager) c.getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_ID); } catch (Exception e) { /* none */ }
        RideRingActivity a = cur.get();
        if (a != null && !a.isFinishing()) a.runOnUiThread(a::finish);
    }

    /** can Android show it over the lock screen without the "Display over other apps" route? (Android 14+ asks the driver) */
    static boolean fsiAllowed(Context c) {
        if (Build.VERSION.SDK_INT < 34) return true;
        try { return ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).canUseFullScreenIntent(); } catch (Exception e) { return true; }
    }

    /* ---------- the screen ---------- */
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        cur = new WeakReference<>(this); showing = true;
        // 1.0.23: the ride was stopped (taken by another driver) before this screen finished opening: close at once
        String rid = getIntent() == null ? "" : getIntent().getStringExtra("id");
        if (RideFallback.wasCancelled(rid)) { showing = false; finish(); return; }
        build(getIntent());
    }

    @Override
    protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); build(i); }

    @Override
    protected void onDestroy() {
        if (va != null) va.cancel();
        if (cur.get() == this) { cur = new WeakReference<>(null); showing = false; }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() { later(); }

    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }
    private int col(String h) { return Color.parseColor(h); }
    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this); t.setText(s); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD); return t;
    }
    private String ex(Intent i, String k) { String v = i.getStringExtra(k); return v == null ? "" : v; }

    private void stop(LinearLayout box, boolean pickup, String km, String name, String sub) {
        LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); row.setPadding(0, dp(pickup ? 14 : 10), 0, 0);
        TextView dot = text(pickup ? "●" : "▼", pickup ? 13 : 12, col(pickup ? "#1E8A5A" : "#0B4A36"), true);
        dot.setPadding(0, dp(3), dp(10), 0); row.addView(dot);
        LinearLayout c = new LinearLayout(this); c.setOrientation(LinearLayout.VERTICAL);
        if (km.length() > 0) c.addView(text(km, 20, col("#111111"), true));
        if (name.length() > 0) { TextView n = text(name, 16, col("#1B1B1B"), true); n.setMaxLines(2); c.addView(n); }
        if (sub.length() > 0) { TextView t = text(sub, 13.5f, col("#66706B"), false); t.setMaxLines(2); c.addView(t); }
        row.addView(c, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        box.addView(row);
    }

    private void build(Intent i) {
        id = ex(i, "id");
        int secs = Math.max(5, Math.min(60, i.getIntExtra("secs", 25)));
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(col("#0B4A36")); root.setPadding(dp(16), dp(28), dp(16), dp(28));

        TextView head = text(ex(i, "title").length() > 0 ? ex(i, "title") : "New ride", 22, Color.WHITE, true);
        head.setGravity(Gravity.CENTER); root.addView(head);
        TextView brand = text("Vellore Taxi", 14, col("#F5B800"), true); brand.setGravity(Gravity.CENTER); brand.setPadding(0, dp(2), 0, dp(16)); root.addView(brand);

        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(18), dp(16), dp(18), dp(18));
        GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.WHITE); bg.setCornerRadius(dp(20)); box.setBackground(bg);
        LinearLayout top = new LinearLayout(this); top.setOrientation(LinearLayout.HORIZONTAL); top.setGravity(Gravity.CENTER_VERTICAL);
        if (ex(i, "veh").length() > 0) { TextView v = text(ex(i, "veh"), 15, col("#0B4A36"), true); GradientDrawable chip = new GradientDrawable(); chip.setColor(col("#EEF3F0")); chip.setCornerRadius(dp(10)); v.setBackground(chip); v.setPadding(dp(10), dp(3), dp(10), dp(3)); top.addView(v); }
        top.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
        if (ex(i, "extra").length() > 0) top.addView(text(ex(i, "extra"), 13, col("#1E8A5A"), true));
        box.addView(top);
        if (ex(i, "fare").length() > 0) {
            LinearLayout fr = new LinearLayout(this); fr.setOrientation(LinearLayout.HORIZONTAL); fr.setGravity(Gravity.BOTTOM); fr.setPadding(0, dp(8), 0, 0);
            fr.addView(text(ex(i, "fare"), 36, col("#0B4A36"), true));
            if (ex(i, "pay").length() > 0) { TextView pm = text("  (" + ex(i, "pay") + ")", 15, col("#66706B"), false); pm.setPadding(0, 0, 0, dp(7)); fr.addView(pm); }
            box.addView(fr);
        }
        if (ex(i, "pname").length() > 0 || ex(i, "pkm").length() > 0) {
            stop(box, true, ex(i, "pkm"), ex(i, "pname"), ex(i, "psub"));
            stop(box, false, ex(i, "dkm"), ex(i, "dname"), ex(i, "dsub"));
        } else {
            if (ex(i, "line1").length() > 0) { TextView a = text(ex(i, "line1"), 16, col("#1B1B1B"), false); a.setPadding(0, dp(10), 0, 0); box.addView(a); }
            if (ex(i, "line2").length() > 0) { TextView b2 = text(ex(i, "line2"), 14, col("#5B6660"), false); b2.setPadding(0, dp(4), 0, 0); box.addView(b2); }
        }
        root.addView(box, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        Button acc = new Button(this); acc.setText(ex(i, "accept").length() > 0 ? ex(i, "accept") : "Accept"); acc.setAllCaps(false);
        acc.setTextColor(col("#0B2A20")); acc.setTypeface(Typeface.DEFAULT_BOLD); acc.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        GradientDrawable base = new GradientDrawable(); base.setColor(col("#FFE7A3")); base.setCornerRadius(dp(30));
        GradientDrawable fill = new GradientDrawable(); fill.setColor(col("#FFC21A")); fill.setCornerRadius(dp(30));
        final ClipDrawable clip = new ClipDrawable(fill, Gravity.START, ClipDrawable.HORIZONTAL); clip.setLevel(10000);
        acc.setBackground(new LayerDrawable(new Drawable[]{ base, clip }));
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)); ap.topMargin = dp(22);
        root.addView(acc, ap);
        Button later = new Button(this); later.setText(ex(i, "open").length() > 0 ? ex(i, "open") : "Later"); later.setAllCaps(false);
        later.setTextColor(Color.WHITE); later.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        GradientDrawable lb = new GradientDrawable(); lb.setColor(Color.TRANSPARENT); lb.setStroke(dp(2), col("#6FA58C")); lb.setCornerRadius(dp(26)); later.setBackground(lb);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)); lp.topMargin = dp(12);
        root.addView(later, lp);
        setContentView(root);

        if (va != null) va.cancel();
        try {
            va = android.animation.ValueAnimator.ofInt(10000, 0); va.setDuration(secs * 1000L); va.setInterpolator(new android.view.animation.LinearInterpolator());
            va.addUpdateListener(an -> clip.setLevel((int) an.getAnimatedValue())); va.start();
        } catch (Exception e) { /* no countdown */ }
        acc.setOnClickListener(v -> accept());
        later.setOnClickListener(v -> later());
        Log.i(TAG, "shown id=" + id + " locked=" + locked(this));
    }

    private void accept() {
        RideOverlayPlugin.pressed("accept", id);
        closeNote();
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && km != null && km.isKeyguardLocked()) {
            // fingerprint / PIN first; the app opens after it (the ride is accepted by the page once it is on screen)
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { DutyService.openApp(getApplicationContext()); finish(); }
                @Override public void onDismissCancelled() { DutyService.openApp(getApplicationContext()); finish(); }
                @Override public void onDismissError() { DutyService.openApp(getApplicationContext()); finish(); }
            });
        } else { DutyService.openApp(getApplicationContext()); finish(); }
    }

    private void later() { RideOverlayPlugin.pressed("open", id); closeNote(); finish(); }

    private void closeNote() { try { ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(NOTE_ID); } catch (Exception e) { /* none */ } }
}
