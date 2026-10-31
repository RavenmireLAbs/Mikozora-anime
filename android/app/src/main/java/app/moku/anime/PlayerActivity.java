package app.moku.anime;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** Isolated player: unlike the main WebView, this WebView has no JavaScript bridge. */
public final class PlayerActivity extends Activity {
    private int BG, PANEL, ACCENT, LIGHT, MUTED, BORDER;
    private FrameLayout root, playerFrame;
    private WebView web;
    private ProgressBar progress;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private String episodeUrl = "";
    private final List<String> serverNames = new ArrayList<>();
    private final List<String> serverUrls = new ArrayList<>();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        Appearance.Palette appearance=Appearance.read(this);
        BG=appearance.background;PANEL=appearance.panel;ACCENT=appearance.highlight;
        LIGHT=appearance.text;MUTED=appearance.muted;BORDER=appearance.border;
        Appearance.applyWindow(this,appearance);
        try {
            JSONObject data = new JSONObject(getIntent().getStringExtra("payload"));
            JSONObject item = data.getJSONObject("item");
            JSONObject episode = data.getJSONObject("episode");
            episodeUrl = episode.getString("url");
            if (!Network.matchesSource(item.optString("source"), episodeUrl)) { finish(); return; }
            JSONArray servers = data.getJSONArray("servers");
            for (int i=0; i<Math.min(servers.length(), 100); i++) {
                JSONObject s = servers.getJSONObject(i);
                String url = s.optString("url");
                if (Network.isHttps(url)) { serverUrls.add(url); serverNames.add(s.optString("name", "Server " + (i+1))); }
            }
            if (serverUrls.isEmpty()) { finish(); return; }
            buildLayout(item.optString("title", "Episode"), episode.optString("number", ""), item.optString("source", ""));
        } catch (Exception e) { finish(); }
    }
    private int dp(float value) { return (int)(getResources().getDisplayMetrics().density * value + 0.5f); }
    private GradientDrawable shape(int color, float radius, int border) {
        GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius));
        if (border != 0) d.setStroke(dp(1), border);
        return d;
    }
    private TextView label(String text, int size, int color, boolean bold) {
        TextView v = new TextView(this); v.setText(text); v.setTextSize(size); v.setTextColor(color);
        if (bold) v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return v;
    }
    private void buildLayout(String title, String number, String source) {
        root = new FrameLayout(this); root.setBackgroundColor(BG);
        LinearLayout column = new LinearLayout(this); column.setOrientation(LinearLayout.VERTICAL); column.setBackgroundColor(BG);
        root.addView(column, new FrameLayout.LayoutParams(-1,-1));
        LinearLayout header = new LinearLayout(this); header.setGravity(Gravity.CENTER_VERTICAL); header.setPadding(dp(12),dp(10),dp(16),dp(10));
        TextView back = label("‹", 33, LIGHT, false); back.setGravity(Gravity.CENTER); back.setContentDescription("Go back");
        header.addView(back, new LinearLayout.LayoutParams(dp(45),dp(48))); back.setOnClickListener(v -> finish());
        LinearLayout titles = new LinearLayout(this); titles.setOrientation(LinearLayout.VERTICAL); titles.setPadding(dp(6),0,0,0);
        TextView name = label(title, 16, LIGHT, true); name.setSingleLine(true); name.setEllipsize(TextUtils.TruncateAt.END);
        TextView sub = label("EPISODE " + number + "  ·  " + Network.sourceName(source).toUpperCase(java.util.Locale.ROOT), 10, ACCENT, true); sub.setPadding(0,dp(5),0,0);
        titles.addView(name); titles.addView(sub); header.addView(titles, new LinearLayout.LayoutParams(0,-2,1));
        column.addView(header);

        playerFrame = new FrameLayout(this); playerFrame.setBackgroundColor(Color.BLACK);
        column.addView(playerFrame, new LinearLayout.LayoutParams(-1, playerHeight()));
        web = new WebView(this); web.setBackgroundColor(Color.BLACK);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false); settings.setUserAgentString(Network.UA);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (!Network.isHttps(url)) return true;
                // Never let a video embed navigate the top-level player to advertisements.
                return request.isForMainFrame();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !Network.isHttps(url); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setVisibility(value >= 90 ? View.GONE : View.VISIBLE); }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullScreenView != null) { callback.onCustomViewHidden(); return; }
                fullScreenView = view; fullScreenCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(-1,-1,Gravity.CENTER));
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }
            @Override public void onHideCustomView() { exitFullScreen(); }
        });
        playerFrame.addView(web, new FrameLayout.LayoutParams(-1,-1));
        progress = new ProgressBar(this); progress.setIndeterminate(true);progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(dp(32),dp(32),Gravity.CENTER);
        playerFrame.addView(progress,pp);

        LinearLayout controls = new LinearLayout(this); controls.setOrientation(LinearLayout.VERTICAL); controls.setPadding(dp(20),dp(22),dp(20),dp(12));
        TextView serverLabel = label("VIDEO SERVER", 10, MUTED, true); serverLabel.setLetterSpacing(.12f); controls.addView(serverLabel);
        Spinner spinner = new Spinner(this); spinner.setContentDescription("Video server");
        spinner.setBackground(shape(PANEL,8,BORDER));
        spinner.setPopupBackgroundDrawable(shape(PANEL,8,0));
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, serverNames) {
            @Override public View getView(int position, View convert, ViewGroup parent) { return styled(super.getView(position,convert,parent)); }
            @Override public View getDropDownView(int position, View convert, ViewGroup parent) { return styled(super.getDropDownView(position,convert,parent)); }
            private View styled(View view) { if (view instanceof TextView) { TextView t=(TextView)view;t.setTextColor(LIGHT);t.setTextSize(13);t.setPadding(dp(13),dp(12),dp(13),dp(12)); } view.setBackgroundColor(PANEL);return view; }
        };
        spinner.setAdapter(adapter);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1,dp(50)); sp.topMargin=dp(9); controls.addView(spinner,sp);
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { loadServer(serverUrls.get(position)); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        TextView help = label("If a server doesn't load, try another one or open the episode on its original site.", 12, MUTED, false);
        help.setLineSpacing(dp(3),1f); LinearLayout.LayoutParams hp=new LinearLayout.LayoutParams(-1,-2);hp.topMargin=dp(16);controls.addView(help,hp);
        Button original = new Button(this); original.setText("OPEN ORIGINAL SITE  ↗"); original.setTextColor(ACCENT); original.setTextSize(11); original.setAllCaps(false); original.setTypeface(Typeface.DEFAULT,Typeface.BOLD); original.setBackground(shape(PANEL,8,BORDER));
        LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(-1,dp(46));bp.topMargin=dp(18);controls.addView(original,bp);
        original.setOnClickListener(v->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(episodeUrl)));}catch(Exception ignored){}});
        column.addView(controls);
        setContentView(root);
    }
    private int playerHeight() {
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;
        return Math.min((int)(width * 9f / 16f), (int)(height * .60f));
    }
    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (playerFrame != null && fullScreenView == null) { ViewGroup.LayoutParams lp=playerFrame.getLayoutParams();lp.height=playerHeight();playerFrame.setLayoutParams(lp); }
    }
    private void loadServer(String url) {
        if (!Network.isHttps(url)) return;
        progress.setVisibility(View.VISIBLE);
        String escaped = TextUtils.htmlEncode(url);
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1'><meta name='referrer' content='origin'><style>html,body{padding:0;margin:0;background:#000;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe src=\"" + escaped + "\" allow='autoplay; fullscreen; picture-in-picture; encrypted-media' allowfullscreen></iframe></body></html>";
        web.loadDataWithBaseURL(episodeUrl, html, "text/html", "UTF-8", null);
    }
    private void exitFullScreen() {
        if (fullScreenView == null) return;
        root.removeView(fullScreenView); fullScreenView = null;
        if (fullScreenCallback != null) { fullScreenCallback.onCustomViewHidden(); fullScreenCallback = null; }
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(0);
        Appearance.applyWindow(this,Appearance.read(this));
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }
    @Override public void onBackPressed() { if (fullScreenView != null) exitFullScreen(); else super.onBackPressed(); }
    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() { if (web != null) { web.stopLoading(); web.destroy(); web=null; } super.onDestroy(); }
}
