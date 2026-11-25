package app.velloretaxi.driver;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsOtpPlugin.class);   // OTP from the SMS after the person taps Allow (see SmsOtpPlugin)
        registerPlugin(RideOverlayPlugin.class); // ride card + ringtone over other apps while online (see RideOverlayPlugin)
        super.onCreate(savedInstanceState);
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
