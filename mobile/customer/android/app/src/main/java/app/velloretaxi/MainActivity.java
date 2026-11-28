package app.velloretaxi;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(app.velloretaxi.auth.VctAuthPlugin.class);   // 2-tap login (mobile/shared/vctauth)
        registerPlugin(SmsOtpPlugin.class);   // OTP from the SMS after the person taps Allow (see SmsOtpPlugin)
        super.onCreate(savedInstanceState);
        InAppUpdate.check(this, true);   // a newer version on Google Play → its Update screen at once (like Rapido / Ola)
    }

    @Override
    public void onResume() { super.onResume(); InAppUpdate.check(this, false); }
}
