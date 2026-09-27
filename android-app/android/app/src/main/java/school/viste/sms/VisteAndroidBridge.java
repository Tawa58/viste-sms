package school.viste.sms;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.Bridge;
import com.getcapacitor.Logger;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Exposed to the web app as window.VisteAndroid. Every call is ignored unless the page
 * currently shown is the Viste SMS site itself (never the offline page or another site).
 */
final class VisteAndroidBridge {

    private static final String TAG = "VisteAndroid";
    private static final String DOWNLOAD_FOLDER = "Viste SMS";

    private final MainActivity activity;
    private final Bridge bridge;
    private final String trustedHost;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WebView printWebView;

    VisteAndroidBridge(MainActivity activity, Bridge bridge) {
        this.activity = activity;
        this.bridge = bridge;
        this.trustedHost = Uri.parse(bridge.getServerUrl()).getHost();
    }

    @JavascriptInterface
    public void printHtml(String html, String jobName) {
        onTrustedPage(() -> print(html, jobName));
    }

    @JavascriptInterface
    public void saveFile(String base64, String fileName, String mimeType) {
        onTrustedPage(() -> io.execute(() -> save(base64, fileName, mimeType)));
    }

    @JavascriptInterface
    public void copyText(String text) {
        onTrustedPage(() -> {
            ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("Viste SMS", text));
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                toast("Copied");
            }
        });
    }

    @JavascriptInterface
    public void setDarkTheme(boolean dark) {
        onTrustedPage(() -> activity.setDarkTheme(dark));
    }

    private void onTrustedPage(Runnable action) {
        mainHandler.post(() -> {
            String url = bridge.getWebView().getUrl();
            Uri uri = url == null ? null : Uri.parse(url);
            if (uri != null && "https".equals(uri.getScheme()) && trustedHost != null && trustedHost.equals(uri.getHost())) {
                action.run();
            } else {
                Logger.warn(TAG, "Ignored bridge call from untrusted page: " + url);
            }
        });
    }

    private void print(String html, String jobName) {
        String name = safeName(jobName, "Viste SMS");
        WebView view = new WebView(activity);
        view.getSettings().setJavaScriptEnabled(false);
        view.setWebViewClient(
            new WebViewClient() {
                private boolean started = false;

                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    return true;
                }

                @Override
                public void onPageFinished(WebView v, String url) {
                    if (started) return;
                    started = true;
                    PrintManager printManager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                    PrintAttributes attributes = new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build();
                    printManager.print(name, v.createPrintDocumentAdapter(name), attributes);
                }
            }
        );
        printWebView = view;
        view.loadDataWithBaseURL(bridge.getServerUrl(), html, "text/html", "UTF-8", null);
    }

    private void save(String base64, String fileName, String mimeType) {
        String name = safeName(fileName, "download");
        String type = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType.split(";")[0].trim();
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            Uri uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? saveToDownloads(data, name, type) : saveToAppFiles(data, name);
            mainHandler.post(() -> {
                toast("Saved to Downloads/" + DOWNLOAD_FOLDER);
                open(uri, type);
            });
        } catch (Exception e) {
            Logger.error(TAG, "Could not save " + name, e);
            mainHandler.post(() -> toast("Could not save " + name));
        }
    }

    @SuppressWarnings("InlinedApi")
    private Uri saveToDownloads(byte[] data, String name, String type) throws Exception {
        ContentResolver resolver = activity.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, type);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + DOWNLOAD_FOLDER);
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("MediaStore insert failed");
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IllegalStateException("No output stream");
            out.write(data);
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        return uri;
    }

    private Uri saveToAppFiles(byte[] data, String name) throws Exception {
        File dir = new File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), DOWNLOAD_FOLDER);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Cannot create " + dir);
        File file = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; file.exists(); i++) {
            file = new File(dir, base + " (" + i + ")" + ext);
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(data);
        }
        return FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", file);
    }

    private void open(Uri uri, String type) {
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activity.startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Logger.info(TAG, "No app to open " + type);
        }
    }

    private void toast(String message) {
        Toast.makeText(activity, message, Toast.LENGTH_SHORT).show();
    }

    private static String safeName(String value, String fallback) {
        String cleaned = value == null ? "" : value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (cleaned.isEmpty()) return fallback;
        return cleaned.length() > 120 ? cleaned.substring(0, 120) : cleaned;
    }
}
