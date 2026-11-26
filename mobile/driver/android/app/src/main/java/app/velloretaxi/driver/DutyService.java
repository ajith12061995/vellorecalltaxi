package app.velloretaxi.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;

/**
 * "On duty" — like Rapido's "Rapido Service · Waiting for orders". Runs while the driver's switch is ON, whatever the
 * app's screen is doing, and is what keeps the driver reachable:
 *
 *  - a small, silent notification ("Online · waiting for rides") for as long as the driver is ON;
 *  - the round floating icon over other apps whenever the app is not on screen — owned here, not by the app's screen,
 *    so it stays even if the screen is closed (swiped away in recent apps, Back, the system tidying memory);
 *  - if the app's screen is swiped away / cleared from recent apps, or the process is killed and Android restarts this
 *    service, the app is opened again and sent straight to the background ({@link #EXTRA_BG}); the page then carries
 *    on: location to the office, ride requests, ride card. The driver does nothing.
 *
 * Only the driver switches it off (the page calls RideOverlay.online({on:false})). Nothing here talks to the network.
 */
public class DutyService extends Service {
    static final String TAG = "DutyService";
    static final String ACT_ON = "app.velloretaxi.driver.DUTY_ON", ACT_OFF = "app.velloretaxi.driver.DUTY_OFF", ACT_SYNC = "app.velloretaxi.driver.DUTY_SYNC";
    static final String EXTRA_BG = "vct_bg";
    static final int NOTE_ID = 4711;
    private static final String PREFS = "vct_duty", K_ON = "on";

    /** the app's screen is in front (set by RideOverlayPlugin on resume / pause / destroy) */
    static volatile boolean appVisible = false;
    /** which screen (plugin instance) set appVisible: an old screen closing after a new one opened must not clear it */
    static volatile int owner = 0;
    /** a ride card is on screen: no icon meanwhile */
    static volatile boolean cardShown = false;
    private static DutyService inst;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private View bubble;
    private WindowManager.LayoutParams blp;
    private final Runnable heal = new Runnable() { @Override public void run() { syncBubble(); main.postDelayed(this, 4000); } };

    /* ---------- called from the plugin ---------- */
    static boolean isOn(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(K_ON, false); }

    static void setOn(Context c, boolean on) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(K_ON, on).apply();
        Intent i = new Intent(c, DutyService.class).setAction(on ? ACT_ON : ACT_OFF);
        try {
            if (on && Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception e) { Log.w(TAG, "start " + on, e); }
    }

    static void sync() { DutyService s = inst; if (s != null) s.main.post(s::syncBubble); }

    /* ---------- service ---------- */
    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        inst = this;
        wm = (WindowManager) getApplicationContext().getSystemService(Context.WINDOW_SERVICE);
        Log.i(TAG, "create");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        Log.i(TAG, "start action=" + a + " on=" + isOn(this) + " visible=" + appVisible);
        if (ACT_OFF.equals(a) || !isOn(this)) { stopAll(); return START_NOT_STICKY; }
        if (!foreground()) {
            // Android refused a background start (e.g. the system restarted us while nothing of the app is on screen):
            // open the app — it starts duty again from the front — and step aside.
            reopen(0);
            stopAll();
            return START_NOT_STICKY;
        }
        // restarted by Android after the process was killed (intent == null): the app's screen is gone, bring it back
        if (intent == null && !appVisible) reopen(500);
        main.removeCallbacks(heal); main.post(heal);
        return START_STICKY;
    }

    /** the app's screen was swiped away from recent apps: open it again in the background */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "task removed on=" + isOn(this));
        appVisible = false;
        if (isOn(this)) { reopen(1200); main.post(this::syncBubble); }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "destroy");
        main.removeCallbacks(heal);
        removeBubble();
        if (inst == this) inst = null;
        super.onDestroy();
    }

    private void stopAll() {
        main.removeCallbacks(heal);
        removeBubble();
        try { if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true); } catch (Exception e) { /* not foreground */ }
        stopSelf();
    }

    private boolean foreground() {
        try {
            Notification n = note();
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTE_ID, n);
            return true;
        } catch (Exception e) { Log.w(TAG, "foreground refused", e); return false; }
    }

    private Notification note() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("duty") == null) {
            NotificationChannel ch = new NotificationChannel("duty", "On duty", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while you are online for rides"); ch.setShowBadge(false); ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "duty") : new Notification.Builder(this);
        b.setSmallIcon(getApplicationInfo().icon).setContentTitle("Vellore Taxi · Online").setContentText("Ride requests will come — ride வந்தா இங்க வரும்")
                .setOngoing(true).setShowWhen(false).setColor(Color.parseColor("#12664A"));
        if (pi != null) b.setContentIntent(pi);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    /** open the app's screen and let it go straight to the background (MainActivity reads EXTRA_BG) */
    private void reopen(long delay) {
        main.postDelayed(() -> {
            if (appVisible) return;
            try {
                Intent i = new Intent(getApplicationContext(), MainActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                i.putExtra(EXTRA_BG, true);
                getApplicationContext().startActivity(i);
                Log.i(TAG, "reopened app in the background");
            } catch (Exception e) { Log.w(TAG, "reopen refused", e); }
        }, delay);
    }

    /* ---------- floating icon ---------- */
    private boolean can() { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this); }
    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }

    private void syncBubble() {
        boolean want = isOn(this) && !appVisible && !cardShown && can();
        if (want && bubble != null && Build.VERSION.SDK_INT >= 19 && !bubble.isAttachedToWindow()) { try { wm.removeView(bubble); } catch (Exception e) { /* gone */ } bubble = null; }
        if (want && bubble == null) showBubble(); else if (!want) removeBubble();
    }

    private void showBubble() {
        try {
            ImageView v = new ImageView(getApplicationContext());
            v.setImageResource(getApplicationInfo().icon);
            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.OVAL); bg.setColor(Color.WHITE); bg.setStroke(dp(2), Color.parseColor("#12664A"));
            v.setBackground(bg); v.setPadding(dp(4), dp(4), dp(4), dp(4));
            if (Build.VERSION.SDK_INT >= 21) v.setElevation(dp(6));
            v.setContentDescription("Vellore Taxi");
            if (blp == null) {
                blp = new WindowManager.LayoutParams(dp(52), dp(52), Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
                blp.gravity = Gravity.TOP | Gravity.START; blp.x = dp(6); blp.y = dp(220);
            }
            final WindowManager.LayoutParams lp = blp;
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
                        case MotionEvent.ACTION_UP:
                            if (!moved) openApp(getApplicationContext());
                            else { // snap to the nearer screen edge, like Rapido's icon
                                int w = getResources().getDisplayMetrics().widthPixels;
                                lp.x = (lp.x + dp(26) < w / 2) ? dp(6) : w - dp(58);
                                try { wm.updateViewLayout(view, lp); } catch (Exception x) { /* view gone */ }
                            }
                            return true;
                        default: return false;
                    }
                }
            });
            wm.addView(v, lp); bubble = v;
            Log.i(TAG, "icon shown visible=" + appVisible);
        } catch (Exception e) { bubble = null; Log.w(TAG, "icon not shown", e); }
    }

    private void removeBubble() { if (bubble != null) { try { wm.removeView(bubble); } catch (Exception e) { /* gone */ } bubble = null; Log.i(TAG, "icon removed"); } }

    static void openApp(Context c) {
        try {
            Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
            if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP); c.startActivity(i); }
        } catch (Exception e) { /* cannot come to the front */ }
    }
}
