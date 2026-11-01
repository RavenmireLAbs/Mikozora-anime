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
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Isolated player: unlike the main WebView, this WebView has no JavaScript bridge. */
public final class PlayerActivity extends Activity implements PlayerNavigation.ErrorListener {
    private static final class EpisodeEntry {
        final String number;
        final String url;
        final String title;

        EpisodeEntry(String number, String url, String title) {
            this.number = number;
            this.url = url;
            this.title = title;
        }
    }

    private static final class Payload {
        String title = "Episode";
        String source = "";
        String episodeNumber = "";
        String episodeUrl = "";
        int episodeIndex = -1;
        final List<EpisodeEntry> episodes = new ArrayList<>();
        final List<String> serverNames = new ArrayList<>();
        final List<String> serverUrls = new ArrayList<>();
    }

    private int BG, PANEL, ACCENT, ACCENT_TEXT, LIGHT, MUTED, BORDER;
    private FrameLayout root, playerFrame;
    private WebView web;
    private ProgressBar progress;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private TextView titleView, subtitleView, episodeCountView, navigationStatus;
    private Spinner serverSpinner;
    private ArrayAdapter<String> serverAdapter;
    private LinearLayout episodePanel, episodeRail;
    private HorizontalScrollView episodeScroll;
    private Button previousButton, nextButton;
    private String episodeUrl = "";
    private String loadedServerUrl = "";
    private String loadedEpisodeUrl = "";
    private int episodeIndex = -1;
    private int pendingEpisodeIndex = -1;
    private boolean switchingEpisode = false;
    private boolean applyingPayload = false;
    private final List<String> serverNames = new ArrayList<>();
    private final List<String> serverUrls = new ArrayList<>();
    private final List<EpisodeEntry> episodes = new ArrayList<>();
    private final List<Button> episodeChips = new ArrayList<>();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        Appearance.Palette appearance = Appearance.read(this);
        BG = appearance.background;
        PANEL = appearance.panel;
        ACCENT = appearance.highlight;
        ACCENT_TEXT = readableOn(ACCENT);
        LIGHT = appearance.text;
        MUTED = appearance.muted;
        BORDER = appearance.border;
        Appearance.applyWindow(this, appearance);

        Payload payload = parsePayload(getIntent());
        if (payload == null) { finish(); return; }
        PlayerNavigation.setErrorListener(this);
        buildLayout();
        applyPayload(payload);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Payload payload = parsePayload(intent);
        if (payload == null) {
            showNavigationError("That episode could not be opened. The current episode is still playing.");
            return;
        }
        setIntent(intent);
        applyPayload(payload);
    }

    private Payload parsePayload(Intent intent) {
        try {
            String raw = intent == null ? null : intent.getStringExtra("payload");
            if (raw == null || raw.length() > 300000) return null;
            JSONObject data = new JSONObject(raw);
            JSONObject item = data.getJSONObject("item");
            JSONObject episode = data.getJSONObject("episode");

            Payload payload = new Payload();
            payload.title = item.optString("title", "Episode");
            payload.source = item.optString("source", "");
            payload.episodeNumber = episode.optString("number", "");
            payload.episodeUrl = episode.getString("url");
            if (!Network.matchesSource(payload.source, payload.episodeUrl)) return null;

            JSONArray episodeArray = data.optJSONArray("episodes");
            if (episodeArray != null) {
                if (episodeArray.length() == 0 || episodeArray.length() > 10000) return null;
                for (int i = 0; i < episodeArray.length(); i++) {
                    JSONObject entry = episodeArray.getJSONObject(i);
                    String number = entry.optString("number", "").trim();
                    String url = entry.optString("url", "");
                    String title = entry.optString("title", "").trim();
                    if (title.length() > 120) title = title.substring(0, 120);
                    if (number.isEmpty() || number.length() > 40 || url.length() > 4096
                            || !Network.matchesSource(payload.source, url)) return null;
                    payload.episodes.add(new EpisodeEntry(number, url, title));
                }
                payload.episodeIndex = data.optInt("episodeIndex", -1);
                if (payload.episodeIndex < 0 || payload.episodeIndex >= payload.episodes.size()
                        || !payload.episodeUrl.equals(payload.episodes.get(payload.episodeIndex).url)) {
                    payload.episodeIndex = -1;
                    for (int i = 0; i < payload.episodes.size(); i++) {
                        if (payload.episodeUrl.equals(payload.episodes.get(i).url)) {
                            payload.episodeIndex = i;
                            break;
                        }
                    }
                    if (payload.episodeIndex < 0) return null;
                }
            } else {
                payload.episodes.add(new EpisodeEntry(payload.episodeNumber, payload.episodeUrl, ""));
                payload.episodeIndex = 0;
            }

            JSONArray servers = data.getJSONArray("servers");
            for (int i = 0; i < Math.min(servers.length(), 100); i++) {
                JSONObject server = servers.getJSONObject(i);
                String url = server.optString("url");
                if (Network.isHttps(url)) {
                    payload.serverUrls.add(url);
                    payload.serverNames.add(server.optString("name", "Server " + (i + 1)));
                }
            }
            return payload.serverUrls.isEmpty() ? null : payload;
        } catch (Exception e) {
            return null;
        }
    }

    private int readableOn(int color) {
        double luminance = (0.2126 * Color.red(color) + 0.7152 * Color.green(color) + 0.0722 * Color.blue(color)) / 255.0;
        return luminance > 0.58 ? 0xff172116 : Color.WHITE;
    }

    private int dp(float value) { return (int)(getResources().getDisplayMetrics().density * value + 0.5f); }

    private GradientDrawable shape(int color, float radius, int border) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        if (border != 0) drawable.setStroke(dp(1), border);
        return drawable;
    }

    private TextView label(String text, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button playerButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(LIGHT);
        button.setTextSize(11);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setBackground(shape(PANEL, 8, BORDER));
        button.setPadding(dp(10), 0, dp(10), 0);
        return button;
    }

    private void buildLayout() {
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(BG);
        root.addView(column, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(12), dp(10), dp(16), dp(10));
        TextView back = label("‹", 33, LIGHT, false);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription("Go back");
        header.addView(back, new LinearLayout.LayoutParams(dp(45), dp(48)));
        back.setOnClickListener(v -> finish());

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(6), 0, 0, 0);
        titleView = label("", 16, LIGHT, true);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        subtitleView = label("", 10, ACCENT, true);
        subtitleView.setPadding(0, dp(5), 0, 0);
        titles.addView(titleView);
        titles.addView(subtitleView);
        header.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));
        column.addView(header);

        playerFrame = new FrameLayout(this);
        playerFrame.setBackgroundColor(Color.BLACK);
        column.addView(playerFrame, new LinearLayout.LayoutParams(-1, playerHeight()));
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(Network.UA);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
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
            @Override public void onProgressChanged(WebView view, int value) {
                if (progress != null) progress.setVisibility(value >= 90 ? View.GONE : View.VISIBLE);
            }

            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullScreenView != null) { callback.onCustomViewHidden(); return; }
                fullScreenView = view;
                fullScreenCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }

            @Override public void onHideCustomView() { exitFullScreen(); }
        });
        playerFrame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this);
        progress.setIndeterminate(true);
        progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        playerFrame.addView(progress, new FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER));

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        controls.setPadding(dp(20), dp(22), dp(20), dp(24));

        episodePanel = new LinearLayout(this);
        episodePanel.setOrientation(LinearLayout.VERTICAL);
        LinearLayout episodeHeading = new LinearLayout(this);
        episodeHeading.setGravity(Gravity.CENTER_VERTICAL);
        TextView episodesLabel = label("EPISODES", 10, MUTED, true);
        episodesLabel.setLetterSpacing(.12f);
        episodeHeading.addView(episodesLabel, new LinearLayout.LayoutParams(0, -2, 1));
        episodeCountView = label("", 11, MUTED, true);
        episodeHeading.addView(episodeCountView);
        episodePanel.addView(episodeHeading);

        LinearLayout episodeNav = new LinearLayout(this);
        episodeNav.setOrientation(LinearLayout.HORIZONTAL);
        episodeNav.setGravity(Gravity.CENTER_VERTICAL);
        previousButton = playerButton("‹  Previous");
        previousButton.setOnClickListener(v -> requestEpisode(episodeIndex - 1));
        episodeNav.addView(previousButton, new LinearLayout.LayoutParams(0, dp(44), 1));
        nextButton = playerButton("Next  ›");
        nextButton.setOnClickListener(v -> requestEpisode(episodeIndex + 1));
        LinearLayout.LayoutParams nextParams = new LinearLayout.LayoutParams(0, dp(44), 1);
        nextParams.leftMargin = dp(8);
        episodeNav.addView(nextButton, nextParams);
        LinearLayout.LayoutParams navParams = new LinearLayout.LayoutParams(-1, -2);
        navParams.topMargin = dp(9);
        episodePanel.addView(episodeNav, navParams);

        episodeScroll = new HorizontalScrollView(this);
        episodeScroll.setHorizontalScrollBarEnabled(true);
        episodeScroll.setContentDescription("Scrollable episode list");
        episodeRail = new LinearLayout(this);
        episodeRail.setOrientation(LinearLayout.HORIZONTAL);
        episodeRail.setGravity(Gravity.CENTER_VERTICAL);
        episodeRail.setPadding(dp(1), dp(1), dp(1), dp(5));
        episodeScroll.addView(episodeRail, new FrameLayout.LayoutParams(-2, -2));
        LinearLayout.LayoutParams railParams = new LinearLayout.LayoutParams(-1, -2);
        railParams.topMargin = dp(9);
        episodePanel.addView(episodeScroll, railParams);
        controls.addView(episodePanel);

        navigationStatus = label("", 12, MUTED, false);
        navigationStatus.setLineSpacing(dp(3), 1f);
        navigationStatus.setVisibility(View.GONE);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(9);
        controls.addView(navigationStatus, statusParams);

        TextView serverLabel = label("VIDEO SERVER", 10, MUTED, true);
        serverLabel.setLetterSpacing(.12f);
        LinearLayout.LayoutParams serverLabelParams = new LinearLayout.LayoutParams(-1, -2);
        serverLabelParams.topMargin = dp(20);
        controls.addView(serverLabel, serverLabelParams);

        serverSpinner = new Spinner(this);
        serverSpinner.setContentDescription("Video server");
        serverSpinner.setBackground(shape(PANEL, 8, BORDER));
        serverSpinner.setPopupBackgroundDrawable(shape(PANEL, 8, 0));
        serverAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, serverNames) {
            @Override public View getView(int position, View convert, ViewGroup parent) { return styled(super.getView(position, convert, parent)); }
            @Override public View getDropDownView(int position, View convert, ViewGroup parent) { return styled(super.getDropDownView(position, convert, parent)); }

            private View styled(View view) {
                if (view instanceof TextView) {
                    TextView text = (TextView) view;
                    text.setTextColor(LIGHT);
                    text.setTextSize(13);
                    text.setPadding(dp(13), dp(12), dp(13), dp(12));
                }
                view.setBackgroundColor(PANEL);
                return view;
            }
        };
        serverSpinner.setAdapter(serverAdapter);
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(-1, dp(50));
        spinnerParams.topMargin = dp(9);
        controls.addView(serverSpinner, spinnerParams);
        serverSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (!applyingPayload && position >= 0 && position < serverUrls.size()) loadServer(serverUrls.get(position));
            }

            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });

        TextView help = label("If a server doesn't load, try another one or open the episode on its original site.", 12, MUTED, false);
        help.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams helpParams = new LinearLayout.LayoutParams(-1, -2);
        helpParams.topMargin = dp(16);
        controls.addView(help, helpParams);

        Button original = playerButton("OPEN ORIGINAL SITE  ↗");
        original.setTextColor(ACCENT);
        LinearLayout.LayoutParams originalParams = new LinearLayout.LayoutParams(-1, dp(46));
        originalParams.topMargin = dp(18);
        controls.addView(original, originalParams);
        original.setOnClickListener(v -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(episodeUrl))); }
            catch (Exception ignored) { }
        });

        ScrollView controlScroll = new ScrollView(this);
        controlScroll.setFillViewport(true);
        controlScroll.addView(controls, new ScrollView.LayoutParams(-1, -2));
        column.addView(controlScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private boolean sameEpisodes(List<EpisodeEntry> next) {
        if (next.size() != episodes.size()) return false;
        for (int i = 0; i < episodes.size(); i++) {
            EpisodeEntry current = episodes.get(i);
            EpisodeEntry candidate = next.get(i);
            if (!current.number.equals(candidate.number)
                    || !current.url.equals(candidate.url)
                    || !current.title.equals(candidate.title)) return false;
        }
        return true;
    }

    private void applyPayload(Payload payload) {
        if (fullScreenView != null) exitFullScreen();
        boolean playlistChanged = !sameEpisodes(payload.episodes);
        applyingPayload = true;
        switchingEpisode = false;
        pendingEpisodeIndex = -1;
        episodeUrl = payload.episodeUrl;
        episodeIndex = payload.episodeIndex;
        episodes.clear();
        episodes.addAll(payload.episodes);
        serverNames.clear();
        serverNames.addAll(payload.serverNames);
        serverUrls.clear();
        serverUrls.addAll(payload.serverUrls);

        titleView.setText(payload.title);
        subtitleView.setText("EPISODE " + payload.episodeNumber + "  ·  "
                + Network.sourceName(payload.source).toUpperCase(Locale.ROOT));
        if (navigationStatus != null) {
            navigationStatus.setText("");
            navigationStatus.setVisibility(View.GONE);
        }
        if (serverAdapter != null) serverAdapter.notifyDataSetChanged();
        if (serverSpinner != null && !serverUrls.isEmpty()) serverSpinner.setSelection(0, false);
        if (playlistChanged) rebuildEpisodeRail();
        applyingPayload = false;
        updateEpisodeControls();
        if (!serverUrls.isEmpty()) loadServer(serverUrls.get(0));
        scrollCurrentEpisodeIntoView(false);
    }

    private void rebuildEpisodeRail() {
        episodeChips.clear();
        episodeRail.removeAllViews();
        for (int i = 0; i < episodes.size(); i++) {
            final int index = i;
            EpisodeEntry episode = episodes.get(i);
            Button chip = new Button(this);
            chip.setText(episode.number);
            chip.setAllCaps(false);
            chip.setSingleLine(true);
            chip.setTextSize(12);
            chip.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            chip.setMinWidth(0);
            chip.setMinimumWidth(0);
            chip.setPadding(dp(11), 0, dp(11), 0);
            chip.setOnClickListener(v -> requestEpisode(index));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(42));
            if (i > 0) params.leftMargin = dp(7);
            episodeRail.addView(chip, params);
            episodeChips.add(chip);
            styleEpisodeChip(chip, index);
        }
    }

    private void styleEpisodeChip(Button chip, int index) {
        if (index < 0 || index >= episodes.size()) return;
        EpisodeEntry episode = episodes.get(index);
        boolean current = index == episodeIndex;
        boolean pending = index == pendingEpisodeIndex;
        chip.setEnabled(!switchingEpisode);
        chip.setAlpha(switchingEpisode && !current && !pending ? .55f : 1f);
        if (current) {
            chip.setBackground(shape(ACCENT, 8, ACCENT));
            chip.setTextColor(ACCENT_TEXT);
        } else if (pending) {
            chip.setBackground(shape(PANEL, 8, ACCENT));
            chip.setTextColor(ACCENT);
        } else {
            chip.setBackground(shape(PANEL, 8, BORDER));
            chip.setTextColor(LIGHT);
        }
        String description = "Play episode " + episode.number;
        if (!episode.title.isEmpty()) description += ": " + episode.title;
        if (current) description += ", current episode";
        if (pending) description += ", loading";
        chip.setContentDescription(description);
    }

    private void styleNavigationButton(Button button, boolean enabled) {
        if (button == null) return;
        button.setEnabled(enabled);
        button.setAlpha(enabled ? 1f : .45f);
        button.setTextColor(enabled ? LIGHT : MUTED);
    }

    private void updateEpisodeControls() {
        if (episodePanel == null) return;
        boolean multiple = episodes.size() > 1;
        episodePanel.setVisibility(multiple ? View.VISIBLE : View.GONE);
        if (episodeCountView != null && episodeIndex >= 0) {
            episodeCountView.setText((episodeIndex + 1) + " of " + episodes.size());
        }

        boolean hasPrevious = episodeIndex > 0;
        boolean hasNext = episodeIndex >= 0 && episodeIndex < episodes.size() - 1;
        styleNavigationButton(previousButton, !switchingEpisode && hasPrevious);
        styleNavigationButton(nextButton, !switchingEpisode && hasNext);
        if (previousButton != null) {
            previousButton.setContentDescription(hasPrevious
                    ? "Previous episode " + episodes.get(episodeIndex - 1).number
                    : "No previous episode");
        }
        if (nextButton != null) {
            nextButton.setContentDescription(hasNext
                    ? "Next episode " + episodes.get(episodeIndex + 1).number
                    : "No next episode");
        }
        for (int i = 0; i < episodeChips.size(); i++) styleEpisodeChip(episodeChips.get(i), i);
    }

    private void scrollCurrentEpisodeIntoView(boolean smooth) {
        if (episodeScroll == null || episodeIndex < 0 || episodeIndex >= episodeChips.size()) return;
        episodeScroll.post(() -> {
            if (episodeIndex < 0 || episodeIndex >= episodeChips.size()) return;
            Button chip = episodeChips.get(episodeIndex);
            int target = chip.getLeft() - Math.max(0, (episodeScroll.getWidth() - chip.getWidth()) / 2);
            if (smooth) episodeScroll.smoothScrollTo(Math.max(0, target), 0);
            else episodeScroll.scrollTo(Math.max(0, target), 0);
        });
    }

    private void requestEpisode(int index) {
        if (switchingEpisode || index < 0 || index >= episodes.size() || index == episodeIndex) return;
        EpisodeEntry target = episodes.get(index);
        switchingEpisode = true;
        pendingEpisodeIndex = index;
        if (navigationStatus != null) {
            navigationStatus.setTextColor(MUTED);
            navigationStatus.setText("Finding servers for episode " + target.number + "…");
            navigationStatus.setVisibility(View.VISIBLE);
        }
        updateEpisodeControls();
        if (!PlayerNavigation.requestEpisode(index, target.url)) {
            showNavigationError("Mikozora is no longer open behind the player. Return to the series and choose an episode again.");
        }
    }

    private void showNavigationError(String message) {
        switchingEpisode = false;
        pendingEpisodeIndex = -1;
        String safe = message == null ? "" : message.trim();
        if (safe.isEmpty()) safe = "Could not load that episode.";
        if (navigationStatus != null) {
            navigationStatus.setTextColor(ACCENT);
            navigationStatus.setText(safe);
            navigationStatus.setVisibility(View.VISIBLE);
            navigationStatus.announceForAccessibility(safe);
        }
        updateEpisodeControls();
    }

    @Override public void onNavigationError(String message) {
        runOnUiThread(() -> { if (!isFinishing()) showNavigationError(message); });
    }

    private int playerHeight() {
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;
        return Math.min((int)(width * 9f / 16f), (int)(height * .60f));
    }

    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (playerFrame != null && fullScreenView == null) {
            ViewGroup.LayoutParams params = playerFrame.getLayoutParams();
            params.height = playerHeight();
            playerFrame.setLayoutParams(params);
        }
        scrollCurrentEpisodeIntoView(false);
    }

    private void loadServer(String url) {
        if (!Network.isHttps(url) || web == null) return;
        if (url.equals(loadedServerUrl) && episodeUrl.equals(loadedEpisodeUrl)) return;
        loadedServerUrl = url;
        loadedEpisodeUrl = episodeUrl;
        if (progress != null) progress.setVisibility(View.VISIBLE);
        String escaped = TextUtils.htmlEncode(url);
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1'><meta name='referrer' content='origin'><style>html,body{padding:0;margin:0;background:#000;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe src=\"" + escaped + "\" allow='autoplay; fullscreen; picture-in-picture; encrypted-media' allowfullscreen></iframe></body></html>";
        web.loadDataWithBaseURL(episodeUrl, html, "text/html", "UTF-8", null);
    }

    private void exitFullScreen() {
        if (fullScreenView == null) return;
        root.removeView(fullScreenView);
        fullScreenView = null;
        if (fullScreenCallback != null) {
            fullScreenCallback.onCustomViewHidden();
            fullScreenCallback = null;
        }
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(0);
        Appearance.applyWindow(this, Appearance.read(this));
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    @Override public void onBackPressed() {
        if (fullScreenView != null) exitFullScreen();
        else super.onBackPressed();
    }

    @Override protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override protected void onDestroy() {
        if (isFinishing()) PlayerNavigation.playerClosed();
        PlayerNavigation.clearErrorListener(this);
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
