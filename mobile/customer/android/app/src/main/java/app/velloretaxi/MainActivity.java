package app.velloretaxi;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsOtpPlugin.class);   // OTP from the SMS after the person taps Allow (see SmsOtpPlugin)
        super.onCreate(savedInstanceState);
    }
}
