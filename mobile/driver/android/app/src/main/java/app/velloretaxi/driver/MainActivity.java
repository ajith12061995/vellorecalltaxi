package app.velloretaxi.driver;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /* DutyService opened the app again after it was swiped away / killed while the driver is ON: once the page is running
       again (RideOverlay.ready()) — or at the latest after 15 s — the app goes back behind whatever the driver was using. */
    private boolean reopened = false;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable back = this::backIfReopened;

    void backIfReopened() { runOnUiThread(() -> { if (reopened) { reopened = false; h.removeCallbacks(back); moveTaskToBack(true); } }); }

    private void readIntent(Intent i) {
        if (i != null && i.getBooleanExtra(DutyService.EXTRA_BG, false)) { reopened = true; i.removeExtra(DutyService.EXTRA_BG); h.removeCallbacks(back); h.postDelayed(back, 15000); }
    }

    @Override
    protected void onNewIntent(Intent intent) { super.onNewIntent(intent); readIntent(intent); }

    @Override
    public void onResume() { super.onResume(); if (!reopened) InAppUpdate.check(this, false); }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsOtpPlugin.class);   // OTP from the SMS after the person taps Allow (see SmsOtpPlugin)
        registerPlugin(RideOverlayPlugin.class); // ride card + ringtone over other apps while online (see RideOverlayPlugin)
        super.onCreate(savedInstanceState);
        readIntent(getIntent());
        InAppUpdate.check(this, true);   // 1.0.22: a newer version on Google Play → its Update screen at once
        /* Back on the first screen used to close the app: the page stopped, the floating icon went away and no ride
           could reach the driver until the app was opened again (owner's 26 Nov recording). Now Back steps back inside
           the page while it can, and otherwise sends the app to the background like Home, so it keeps running. */
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView w = getBridge() != null ? getBridge().getWebView() : null;
                if (w != null && w.canGoBack()) w.goBack(); else moveTaskToBack(true);
            }
        });
    }
}
