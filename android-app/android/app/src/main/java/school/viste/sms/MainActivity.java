package school.viste.sms;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Matches the web app's --card colour (header background) in light and dark themes. */
    private static final int BAR_COLOR_LIGHT = Color.parseColor("#FFFFFF");
    private static final int BAR_COLOR_DARK = Color.parseColor("#111C28");

    private boolean darkTheme = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        fitContentBetweenSystemBars();
        applySystemBarTheme();

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        // Render at the same scale as the web app so layouts never overflow when the
        // phone's font size setting is enlarged.
        settings.setTextZoom(100);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.addJavascriptInterface(new VisteAndroidBridge(this, getBridge()), "VisteAndroid");
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBarTheme();
    }

    /**
     * Keeps the whole web app inside the visible area: below the status bar and camera cutout,
     * above the navigation bar, and above the on-screen keyboard while typing.
     */
    private void fitContentBetweenSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }

        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets bars = insets.getInsets(types);
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            // Zero the insets instead of consuming them so the WebView still recalculates
            // CSS safe-area values (which are now 0 because the padding already applies).
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(types, Insets.NONE)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                .build();
        });
        ViewCompat.requestApplyInsets(content);
    }

    void setDarkTheme(boolean dark) {
        darkTheme = dark;
        applySystemBarTheme();
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarTheme() {
        int color = darkTheme ? BAR_COLOR_DARK : BAR_COLOR_LIGHT;
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(color);
        getWindow().getDecorView().setBackgroundColor(color);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!darkTheme);
        controller.setAppearanceLightNavigationBars(!darkTheme);
    }
}
