package app.velloretaxi.auth;

import android.app.Activity;
import android.app.PendingIntent;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.GetPhoneNumberHintIntentRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.firebase.FirebaseException;
import com.google.firebase.FirebaseTooManyRequestsException;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException;
import com.google.firebase.auth.PhoneAuthCredential;
import com.google.firebase.auth.PhoneAuthOptions;
import com.google.firebase.auth.PhoneAuthProvider;
import java.util.concurrent.TimeUnit;

/**
 * VCT 2-tap login, shared by the customer and the driver app (mobile/shared/vctauth, added to both builds).
 *  hint()  : Google's Phone Number Hint popup → {phone:"+9198…"} or {cancelled:true}. Needs no permission.
 *  send()  : Firebase sends the OTP from the NATIVE SDK (Play Integrity, no reCAPTCHA page) → {vid} or {instant:true}.
 *            Android reads the SMS by itself (SMS Retriever, the app hash is in Firebase's SMS):
 *              event "code"    {code, vid}   → the page fills the 6 boxes and signs in
 *              event "instant" {idToken}     → no SMS was needed (Google already verified the SIM); the page
 *                                               exchanges the token on the server (nativeLogin) for its own session
 *              event "failed"  {code}        → after send() already answered
 *  appCheck(): Play Integrity App Check token for the page's Firebase SDK.
 *  signOut(): ends the native session (the page keeps its own).
 * The page (core/natauth.js) uses this only inside the Play Store app; the website keeps the web login.
 */
@CapacitorPlugin(name = "VctAuth")
public class VctAuthPlugin extends Plugin {
    private static final String TAG = "VctAuth";
    private ActivityResultLauncher<IntentSenderRequest> hintLauncher;
    private PluginCall hintCall, sendCall;
    private PhoneAuthProvider.ForceResendingToken resendToken;
    private String lastVid = null, lastPhone = null;

    @Override
    public void load() {
        try { FirebaseAppCheck.getInstance().installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance()); }
        catch (Exception e) { Log.w(TAG, "app check", e); }
        hintLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::onHint);
    }

    @PluginMethod
    public void hint(PluginCall call) {
        if (hintCall != null) { JSObject r = new JSObject(); r.put("cancelled", true); hintCall.resolve(r); }
        hintCall = call;
        Activity act = getActivity();
        Identity.getSignInClient(act).getPhoneNumberHintIntent(GetPhoneNumberHintIntentRequest.builder().build())
            .addOnSuccessListener(pi -> {
                try { hintLauncher.launch(new IntentSenderRequest.Builder(((PendingIntent) pi).getIntentSender()).build()); }
                catch (Exception e) { endHint(null, "launch"); }
            })
            .addOnFailureListener(e -> endHint(null, "unavailable"));   // no SIM / no Google account / old Play services
    }

    private void onHint(ActivityResult res) {
        String phone = null;
        try {
            if (res.getResultCode() == Activity.RESULT_OK && res.getData() != null)
                phone = Identity.getSignInClient(getActivity()).getPhoneNumberFromIntent(res.getData());
        } catch (Exception e) { Log.w(TAG, "hint result", e); }
        endHint(phone, phone == null ? "cancelled" : null);
    }

    private void endHint(String phone, String why) {
        PluginCall c = hintCall; hintCall = null;
        if (c == null) return;
        JSObject r = new JSObject();
        if (phone != null) r.put("phone", phone); else { r.put("cancelled", true); r.put("why", why); }
        c.resolve(r);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String p = call.getString("phone", "");
        if (p == null || !p.matches("[6-9][0-9]{9}")) { call.reject("bad phone", "invalid-phone"); return; }
        boolean resend = Boolean.TRUE.equals(call.getBoolean("resend", false)) && p.equals(lastPhone) && resendToken != null;
        if (sendCall != null) sendCall.reject("replaced", "replaced");
        sendCall = call; lastPhone = p; lastVid = null;
        PhoneAuthOptions.Builder b = PhoneAuthOptions.newBuilder(FirebaseAuth.getInstance())
            .setPhoneNumber("+91" + p).setTimeout(60L, TimeUnit.SECONDS).setActivity(getActivity())
            .setCallbacks(new PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                @Override public void onCodeSent(String vid, PhoneAuthProvider.ForceResendingToken token) {
                    lastVid = vid; resendToken = token;
                    PluginCall c = sendCall; sendCall = null;
                    if (c != null) { JSObject r = new JSObject(); r.put("vid", vid); c.resolve(r); }
                }
                @Override public void onVerificationCompleted(PhoneAuthCredential cred) {
                    String code = cred.getSmsCode();
                    if (code != null && lastVid != null) {          // the SMS was read by Android: same as typing it
                        JSObject e = new JSObject(); e.put("code", code); e.put("vid", lastVid); notifyListeners("code", e, true); return;
                    }
                    // instant verification (no SMS): sign in here, hand the page an ID token to exchange on the server
                    FirebaseAuth.getInstance().signInWithCredential(cred)
                        .addOnSuccessListener(res -> res.getUser().getIdToken(true).addOnSuccessListener(t -> {
                            PluginCall c = sendCall; sendCall = null;
                            if (c != null) { JSObject r = new JSObject(); r.put("instant", true); c.resolve(r); }
                            JSObject e = new JSObject(); e.put("idToken", t.getToken()); notifyListeners("instant", e, true);
                        }).addOnFailureListener(x -> fail("instant-token")))
                        .addOnFailureListener(x -> fail("instant-signin"));
                }
                @Override public void onVerificationFailed(FirebaseException e) {
                    Log.w(TAG, "verify failed", e);
                    fail(e instanceof FirebaseTooManyRequestsException ? "too-many-requests"
                        : e instanceof FirebaseAuthInvalidCredentialsException ? "invalid-phone"
                        : String.valueOf(e.getMessage()).contains("network") ? "network" : "send-failed");
                }
            });
        if (resend) b.setForceResendingToken(resendToken);
        PhoneAuthProvider.verifyPhoneNumber(b.build());
    }

    private void fail(String code) {
        PluginCall c = sendCall; sendCall = null;
        if (c != null) { c.reject(code, code); return; }
        JSObject e = new JSObject(); e.put("code", code); notifyListeners("failed", e, true);
    }

    @PluginMethod
    public void appCheck(PluginCall call) {
        FirebaseAppCheck.getInstance().getAppCheckToken(false)
            .addOnSuccessListener(t -> { JSObject r = new JSObject(); r.put("token", t.getToken()); r.put("exp", t.getExpireTimeMillis()); call.resolve(r); })
            .addOnFailureListener(e -> call.reject("appcheck", "appcheck"));
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        try { FirebaseAuth.getInstance().signOut(); } catch (Exception ignored) { }
        call.resolve();
    }
}
