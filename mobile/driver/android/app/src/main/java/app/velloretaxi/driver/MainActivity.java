package app.velloretaxi.driver;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsOtpPlugin.class);   // OTP from the SMS after the person taps Allow (see SmsOtpPlugin)
        registerPlugin(RideOverlayPlugin.class); // ride card + ringtone over other apps while online (see RideOverlayPlugin)
        super.onCreate(savedInstanceState);
    }
}
