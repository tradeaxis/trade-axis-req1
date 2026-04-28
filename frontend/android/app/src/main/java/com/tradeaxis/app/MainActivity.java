package com.tradeaxis.app;

import android.os.Bundle;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final long BACK_PRESS_INTERVAL_MS = 2000; // 2 seconds window
    private long lastBackPressTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Register back press callback (works on Android 13+ and older via compat)
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                long currentTime = System.currentTimeMillis();

                if (currentTime - lastBackPressTime < BACK_PRESS_INTERVAL_MS) {
                    // Second back press within 2 seconds — exit app
                    finishAffinity();
                } else {
                    // First back press — show toast and record time
                    lastBackPressTime = currentTime;
                    Toast.makeText(
                        MainActivity.this,
                        "Press back again to exit",
                        Toast.LENGTH_SHORT
                    ).show();
                }
            }
        });
    }
}