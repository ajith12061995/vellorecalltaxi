package app.velloretaxi.driver;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.getcapacitor.JSObject;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Pushes from the server (Firebase Cloud Messaging). From 1.0.17 the server sends new rides to this app as a
 * high-priority DATA message (type=ride), which Android delivers even in Doze / with the screen off, and which reaches
 * this code instead of becoming a plain system notification:
 *   - the page is running → it is told at once ("wake"): it fetches the ride and rings (over the lock screen if locked);
 *   - the page is gone (process restarted) → the app is opened behind the other app; the page starts and rings.
 * Everything else goes on to Capacitor's push plugin as before.
 */
public class VctMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage m) {
        try { handle(this, m.getData()); } catch (Exception e) { Log.w("VctPush", "handle", e); }
        super.onMessageReceived(m);
    }

    /** 1.0.22: Google gave this phone a new push address: put it on the driver record at once (native REST, signed in as the driver) */
    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        try { NativeLive.get(this).saveToken(token); } catch (Exception e) { Log.w("VctPush", "new token", e); }
    }

    static void handle(Context c, Map<String, String> d) {
        String type = d == null ? null : d.get("type");
        if ("taken".equals(type)) {   // 1.0.25: another driver took it (or it was cancelled): stop ringing it here at once
            String id = d.get("bookingId"); Log.i("VctPush", "taken " + id);
            RideFallback.cancelled(id); RideOverlayPlugin.cancelRing(id); RideRingActivity.closeIf(c, id);
            JSObject o = new JSObject(); for (Map.Entry<String, String> e : d.entrySet()) o.put(e.getKey(), e.getValue());
            RideOverlayPlugin.wake(o);   // the page (if awake) takes the card away too
            return;
        }
        if (type == null || !(type.equals("ride") || type.equals("wake"))) return;
        boolean on = DutyService.isOn(c);
        Log.i("VctPush", type + " " + d.get("bookingId") + " on=" + on + " visible=" + DutyService.appVisible);
        if (!on) return;
        if ("ride".equals(type)) NativeLive.get(c).pushSeen(d.get("bookingId"));   // 1.0.21: tell the server this phone got it
        JSObject o = new JSObject(); for (Map.Entry<String, String> e : d.entrySet()) o.put(e.getKey(), e.getValue());
        if (!RideOverlayPlugin.wake(o)) DutyService.openBg(c);
        DutyService.setOn(c, true);   // make sure the duty service (and the position sender) is running
        RideFallback.onPush(c, d);    // 1.0.20: if the page does not ring in a few seconds, the phone rings by itself
    }
}
