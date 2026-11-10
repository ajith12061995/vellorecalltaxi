package app.velloretaxi.driver;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.phone.SmsRetriever;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Status;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the sign-in OTP from the SMS with Google's SMS User Consent API: Android shows the message and asks
 * "Allow Vellore Taxi to read this message?". Only after Allow does the app get that ONE message; it needs no SMS
 * permission and reads nothing else. start() resolves {code:"123456"} or {code:null} (denied, timeout after 5 minutes,
 * no 6-digit code in the message). Called from the web page through the Capacitor bridge: SmsOtp.start / SmsOtp.stop.
 */
@CapacitorPlugin(name = "SmsOtp")
public class SmsOtpPlugin extends Plugin {
    private static final Pattern CODE = Pattern.compile("(?<!\\d)(\\d{6})(?!\\d)");
    private PluginCall pending;
    private BroadcastReceiver receiver;

    @PluginMethod
    public void start(PluginCall call) {
        finish(null);               // a new start replaces an older one (e.g. "resend OTP")
        pending = call;
        bridge.saveCall(call);
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!SmsRetriever.SMS_RETRIEVED_ACTION.equals(intent.getAction())) return;
                Bundle extras = intent.getExtras();
                Status status = extras == null ? null : (Status) extras.get(SmsRetriever.EXTRA_STATUS);
                if (status == null || status.getStatusCode() != CommonStatusCodes.SUCCESS) { finish(null); return; }   // TIMEOUT etc.
                Intent consent = extras.getParcelable(SmsRetriever.EXTRA_CONSENT_INTENT);
                // only launch Google Play services' own consent screen (no intent redirection)
                ComponentName target = consent == null ? null : consent.resolveActivity(getContext().getPackageManager());
                if (target == null || !"com.google.android.gms".equals(target.getPackageName())
                        || (consent.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) != 0) {
                    finish(null); return;
                }
                if (pending == null) return;
                unregister();
                try { startActivityForResult(pending, consent, "onConsent"); } catch (Exception e) { finish(null); }
            }
        };
        IntentFilter filter = new IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION);
        ContextCompat.registerReceiver(getContext(), receiver, filter, SmsRetriever.SEND_PERMISSION, null, ContextCompat.RECEIVER_EXPORTED);
        SmsRetriever.getClient(getContext()).startSmsUserConsent(null)
            .addOnFailureListener(e -> finish(null));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        finish(null);
        call.resolve();
    }

    @ActivityCallback
    private void onConsent(PluginCall call, ActivityResult result) {
        String code = null;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            String msg = result.getData().getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE);
            if (msg != null) { Matcher m = CODE.matcher(msg); if (m.find()) code = m.group(1); }
        }
        if (call != null && call != pending) { resolveCall(call, code); }
        finish(code);
    }

    private void resolveCall(PluginCall call, String code) {
        JSObject r = new JSObject();
        r.put("code", code == null ? JSObject.NULL : code);
        call.resolve(r);
        bridge.releaseCall(call);
    }

    private void finish(String code) {
        unregister();
        PluginCall c = pending;
        pending = null;
        if (c != null) resolveCall(c, code);
    }

    private void unregister() {
        if (receiver != null) {
            try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) { }
            receiver = null;
        }
    }

    @Override
    protected void handleOnDestroy() { finish(null); }
}
