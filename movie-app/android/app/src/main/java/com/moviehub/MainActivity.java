package com.moviehub;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavaScriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * MovieHub — a WebView shell that loads the bundled movie-browser web app
 * and exposes a native bridge so the web layer can fetch pages from the
 * movie sources directly (bypassing browser CORS restrictions).
 *
 * The bridge method `request(url)` fetches HTML on a background thread and
 * returns it via window.__mokuNativeChunk, mirroring the pattern used by
 * the Mikozora app.
 */
public class MainActivity extends Activity {

    private WebView webView;
    private final Map<String, RequestCallback> pendingRequests = new HashMap<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        setupWebView();
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new MovieWebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        // Native download listener — saves files from download links.
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                    String contentDisposition, String mimetype, long contentLength) {
                if (url == null || url.isEmpty()) return;
                try {
                    Uri uri = Uri.parse(url);
                    String fileName = getFileName(uri, contentDisposition);
                    DownloadManager.Request request = new DownloadManager.Request(uri);
                    request.setMimeType(mimetype != null ? mimetype : "application/octet-stream");
                    request.setTitle(fileName);
                    if (contentDisposition != null && !contentDisposition.isEmpty()) {
                        request.addRequestHeader("Content-Disposition", contentDisposition);
                    }
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(request);
                } catch (Exception e) {
                    // Fallback: open in browser
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
                }
            }
        });

        // Add the JavaScript bridge.
        webView.addJavascriptInterface(new Bridge(), "MokuBridge");

        // Load the web app from assets.
        webView.loadUrl("file:///android_asset/web/index.html");
    }

    private String getFileName(Uri uri, String contentDisposition) {
        if (contentDisposition != null) {
            int idx = contentDisposition.indexOf("filename=");
            if (idx >= 0) {
                String name = contentDisposition.substring(idx + 9).replace("\"", "").trim();
                if (!name.isEmpty()) return name;
            }
        }
        String last = uri.getLastPathSegment();
        return (last != null && !last.isEmpty()) ? last : "download";
    }

    // ── Back navigation ──────────────────────────────────────────────────────

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    // ── WebView client: allow external navigation (player pages) ───────────

    private class MovieWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            // Let the web app handle hash navigation internally.
            if (url.startsWith("file:///android_asset/web/") || url.startsWith("file:///android_asset/")) {
                return false;
            }
            // External URLs (movie player pages, downloads) — load in WebView.
            view.loadUrl(url);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
        }
    }

    // ── JavaScript bridge ────────────────────────────────────────────────────

    private interface RequestCallback {
        void onComplete(String body);
        void onError(String message);
    }

    private class Bridge {
        @JavaScriptInterface
        public void request(String id, String url) {
            new Thread(() -> {
                HttpURLConnection conn = null;
                try {
                    URL u = new URL(url);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 13; MovieHub) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
                    conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(30000);

                    int code = conn.getResponseCode();
                    InputStreamReader reader = code >= 200 && code < 400
                        ? new InputStreamReader(conn.getInputStream(), "UTF-8")
                        : new InputStreamReader(conn.getErrorStream(), "UTF-8");
                    BufferedReader br = new BufferedReader(reader);
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) {
                        sb.append(line).append('\n');
                    }
                    br.close();
                    final String body = sb.toString();
                    runOnUiThread(() -> jsCallback(id, body, true));
                } catch (Exception e) {
                    final String msg = e.getMessage() != null ? e.getMessage() : "Request failed";
                    runOnUiThread(() -> jsCallback(id, "", false, msg));
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }, "moku-bridge-request").start();
        }

        @JavaScriptInterface
        public void download(String url, String name) {
            try {
                Uri uri = Uri.parse(url);
                String fileName = (name != null && !name.isEmpty()) ? name : getFileName(uri, null);
                DownloadManager.Request request = new DownloadManager.Request(uri);
                request.setMimeType("application/octet-stream");
                request.setTitle(fileName);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) dm.enqueue(request);
            } catch (Exception e) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
            }
        }
    }

    private void jsCallback(String id, String body, boolean success) {
        jsCallback(id, body, success, null);
    }

    private void jsCallback(String id, String body, boolean success, String error) {
        webView.post(() -> {
            webView.evaluateJavascript(
                "window.__mokuNativeChunk && window.__mokuNativeChunk(" +
                jsonString(id) + ", " +
                jsonString(body) + ", " +
                (success ? "true" : "false") + ", " +
                (error != null ? jsonString(error) : "null") + ");",
                null
            );
        });
    }

    private String jsonString(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append("\"").toString();
    }
}
