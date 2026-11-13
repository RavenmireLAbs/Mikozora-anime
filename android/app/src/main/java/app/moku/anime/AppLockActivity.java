package app.moku.anime;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Opaque gate shown whenever a protected Mikozora session returns to foreground. */
public final class AppLockActivity extends Activity {
    private static final int CONFIRM_DEVICE = 7804;
    private boolean promptOpen;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (!AppLock.enabled(this)) { finish(); return; }
        showGate();
        if (state == null) requestUnlock();
    }

    private void showGate() {
        int background = 0xff101312;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(32), dp(36), dp(32), dp(36));
        root.setBackgroundColor(background);

        TextView brand = new TextView(this);
        brand.setText("MIKOZORA");
        brand.setTextColor(0xffc8ee99);
        brand.setTextSize(13);
        brand.setLetterSpacing(.18f);
        brand.setGravity(Gravity.CENTER);
        root.addView(brand, matchWrap());

        TextView title = new TextView(this);
        title.setText("Your private space");
        title.setTextColor(Color.WHITE);
        title.setTextSize(25);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = matchWrap();
        titleParams.topMargin = dp(18);
        root.addView(title, titleParams);

        TextView message = new TextView(this);
        message.setText("Unlock with your device screen lock to continue.");
        message.setTextColor(0xffaeb9af);
        message.setTextSize(15);
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = matchWrap();
        messageParams.topMargin = dp(10);
        root.addView(message, messageParams);

        Button unlock = new Button(this);
        unlock.setText("Unlock Mikozora");
        unlock.setOnClickListener(view -> requestUnlock());
        LinearLayout.LayoutParams buttonParams = wrapWrap();
        buttonParams.topMargin = dp(26);
        root.addView(unlock, buttonParams);

        TextView exit = new TextView(this);
        exit.setText("Exit app");
        exit.setTextColor(0xffaeb9af);
        exit.setTextSize(14);
        exit.setGravity(Gravity.CENTER);
        exit.setPadding(dp(20), dp(18), dp(20), dp(18));
        exit.setOnClickListener(view -> finishAffinity());
        root.addView(exit, matchWrap());
        setContentView(root);
    }

    private void requestUnlock() {
        if (promptOpen || isFinishing()) return;
        if (!AppLock.enabled(this)) { finish(); return; }
        KeyguardManager manager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (manager == null || !manager.isDeviceSecure()) {
            AppLock.setEnabled(this, false);
            Toast.makeText(this, "Set a device screen lock to use App Lock.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        Intent confirm = manager.createConfirmDeviceCredentialIntent("Unlock Mikozora", "Confirm your device screen lock");
        if (confirm == null) {
            Toast.makeText(this, "Android could not open the device unlock prompt.", Toast.LENGTH_LONG).show();
            return;
        }
        promptOpen = true;
        try { startActivityForResult(confirm, CONFIRM_DEVICE); }
        catch (Exception error) { promptOpen = false; }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != CONFIRM_DEVICE) return;
        promptOpen = false;
        if (resultCode == RESULT_OK) {
            AppLock.authenticated();
            finish();
        } else {
            Toast.makeText(this, "Mikozora is still locked.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override public void onBackPressed() { finishAffinity(); }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }
    private LinearLayout.LayoutParams wrapWrap() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }
}
