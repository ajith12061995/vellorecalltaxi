package app.velloretaxi.driver;

import android.app.Activity;
import android.util.Log;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * 1.0.22: like Rapido / Ola — when a newer version is on Google Play, opening the app shows Google Play's own
 * "Update" screen at once (immediate in-app update). Checked when the app opens and when it comes back after an hour;
 * an update that was started and interrupted is resumed. Works only for an app installed from Google Play.
 */
final class InAppUpdate {
    static final int RC = 9411;
    private static long last = 0;

    static void check(final Activity a, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - last < 3600_000L) return;
        last = now;
        try {
            final AppUpdateManager m = AppUpdateManagerFactory.create(a);
            m.getAppUpdateInfo().addOnSuccessListener(info -> start(a, m, info))
                    .addOnFailureListener(e -> Log.i("InAppUpdate", "no info: " + e.getClass().getSimpleName()));
        } catch (Exception e) { Log.i("InAppUpdate", "unavailable: " + e.getClass().getSimpleName()); }
    }

    private static void start(Activity a, AppUpdateManager m, AppUpdateInfo info) {
        try {
            int av = info.updateAvailability();
            boolean go = av == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                    || (av == UpdateAvailability.UPDATE_AVAILABLE && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE));
            Log.i("InAppUpdate", "availability=" + av + " start=" + go);
            if (go && !a.isFinishing()) m.startUpdateFlowForResult(info, a, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(), RC);
        } catch (Exception e) { Log.w("InAppUpdate", "start", e); }
    }
}
