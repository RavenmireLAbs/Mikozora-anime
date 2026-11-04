package app.moku.anime;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.CaptionStyleCompat;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.SubtitleView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.net.InetAddress;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.Dns;
import okhttp3.OkHttpClient;

/**
 * Mikozora's own Media3 player for servers that expose a direct stream.
 * Resolution stays in native code so expiring media and subtitle URLs never
 * enter the WebView. Episode changes, watched marks, exact positions and
 * embedded fallback requests go back through PlayerNavigation.
 */
@OptIn(markerClass = UnstableApi.class)
public final class DirectPlayerActivity extends Activity implements PlayerNavigation.ErrorListener {
    private static final float[] SPEEDS = {0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f};
    private static final long MAX_POSITION_MS = 7L * 24 * 60 * 60 * 1000;

    private static final class EpisodeEntry {
        final String number;
        final String url;
        final String title;
        boolean watched;

        EpisodeEntry(String number, String url, String title, boolean watched) {
            this.number = number;
            this.url = url;
            this.title = title;
            this.watched = watched;
        }
    }

    private static final class Payload {
        String title = "Episode";
        String source = "";
        String itemUrl = "";
        String seriesKey = "";
        String episodeNumber = "";
        String episodeTitle = "";
        String episodeUrl = "";
        String episodeIds = "";
        String language = "english";
        String server = "auto";
        String quality = "best";
        String subtitleLanguage = "english";
        JSONObject resolverItem;
        JSONObject resolverEpisode;
        final List<EpisodeEntry> episodes = new ArrayList<>();
        int episodeIndex = -1;
        long startPositionMs = 0;
        int qualityCap = 0;
        int speedIndex = 2;
        int seekSeconds = 10;
        int subtitleSize = 18;
        int sleepTimerMinutes = 0;
        String subtitleColor = "white";
        String subtitleBackground = "shadow";
        boolean resume = true;
        boolean autoPlayNext = true;
    }

    private final ExecutorService resolverExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable positionTicker = new Runnable() {
        @Override public void run() {
            if (destroyed || player == null) return;
            reportPosition(false);
            mainHandler.postDelayed(this, 5000);
        }
    };

    private ExoPlayer player;
    private PlayerView playerView;
    private LinearLayout header;
    private LinearLayout statusPanel;
    private ProgressBar progress;
    private TextView titleView;
    private TextView statusTitle;
    private TextView statusText;
    private Button speedButton;
    private Button backSeekButton;
    private Button forwardSeekButton;
    private Button previousButton;
    private Button nextButton;
    private Button watchedButton;
    private Button retryButton;
    private Button fallbackButton;
    private Button closeStatusButton;

    private Payload currentPayload;
    private VideoResolver.Result currentStream;
    private String loadedEpisodeUrl = "";
    private int loadGeneration = 0;
    private int speedIndex = 2;
    private int seekSeconds = 10;
    private int subtitleSize = 18;
    private int sleepTimerMinutes = 0;
    private String subtitleColor = "white";
    private String subtitleBackground = "shadow";
    private long sleepDeadlineElapsedMs = 0;
    private Runnable sleepRunnable;
    private Runnable fallbackFinishRunnable;
    private boolean resolving = false;
    private boolean switchingEpisode = false;
    private boolean playbackStarted = false;
    private boolean endedHandled = false;
    private boolean fallbackRequested = false;
    private boolean destroyed = false;

    private int dp(float value) {
        return (int) (getResources().getDisplayMetrics().density * value + 0.5f);
    }

    private int allowedInt(int value, int fallback, int... allowed) {
        for (int candidate : allowed) if (candidate == value) return candidate;
        return fallback;
    }

    private int nearestSpeedIndex(double requested) {
        int best = 2;
        double bestDistance = Double.MAX_VALUE;
        for (int i = 0; i < SPEEDS.length; i++) {
            double distance = Math.abs(SPEEDS[i] - requested);
            if (distance < bestDistance) {
                best = i;
                bestDistance = distance;
            }
        }
        return best;
    }

    private String firstString(String key, JSONObject... objects) {
        for (JSONObject object : objects) {
            if (object == null || !object.has(key)) continue;
            String value = object.optString(key, "").trim();
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    private boolean firstBoolean(String key, boolean fallback, JSONObject... objects) {
        for (JSONObject object : objects) {
            if (object != null && object.has(key)) return object.optBoolean(key, fallback);
        }
        return fallback;
    }

    private int firstInt(String key, int fallback, JSONObject... objects) {
        for (JSONObject object : objects) {
            if (object != null && object.has(key)) return object.optInt(key, fallback);
        }
        return fallback;
    }

    private double firstDouble(String key, double fallback, JSONObject... objects) {
        for (JSONObject object : objects) {
            if (object != null && object.has(key)) return object.optDouble(key, fallback);
        }
        return fallback;
    }

    private String boundedDisplay(String value, int max) {
        String clean = value == null ? "" : value.replaceAll("[\\u0000-\\u001f\\u007f]", " ").trim();
        return clean.length() > max ? clean.substring(0, max) : clean;
    }

    private Payload parsePayload(Intent intent) {
        try {
            String raw = intent == null ? null : intent.getStringExtra("payload");
            if (raw == null || raw.length() > 300000) return null;
            JSONObject data = new JSONObject(raw);
            JSONObject item = data.getJSONObject("item");
            JSONObject episode = data.getJSONObject("episode");
            JSONObject online = data.optJSONObject("online");
            if (online == null) online = new JSONObject();
            JSONObject playback = data.optJSONObject("playback");
            if (playback == null) playback = data.optJSONObject("preferences");
            if (playback == null) playback = new JSONObject();

            Payload payload = new Payload();
            payload.title = boundedDisplay(item.optString("title", "Episode"), 500);
            payload.source = item.optString("source", "").trim();
            payload.itemUrl = item.optString("url", "");
            payload.episodeNumber = episode.optString("number", "").trim();
            payload.episodeTitle = boundedDisplay(episode.optString("title", ""), 240);
            payload.episodeUrl = episode.optString("url", "");
            payload.episodeIds = episode.optString("ids", "");
            if (payload.title.isEmpty()
                || payload.episodeNumber.isEmpty() || payload.episodeNumber.length() > 40
                || payload.episodeUrl.length() > 4096 || payload.episodeIds.length() > 1000
                || !Network.matchesSource(payload.source, payload.itemUrl)
                || !Network.matchesSource(payload.source, payload.episodeUrl)) return null;
            payload.seriesKey = payload.source + "|" + payload.itemUrl;
            payload.resolverItem = new JSONObject()
                .put("source", payload.source)
                .put("url", payload.itemUrl)
                .put("title", payload.title);
            payload.resolverEpisode = new JSONObject()
                .put("number", payload.episodeNumber)
                .put("url", payload.episodeUrl)
                .put("title", payload.episodeTitle)
                .put("ids", payload.episodeIds);

            JSONArray episodeArray = data.optJSONArray("episodes");
            if (episodeArray != null) {
                if (episodeArray.length() == 0 || episodeArray.length() > 10000) return null;
                for (int i = 0; i < episodeArray.length(); i++) {
                    JSONObject entry = episodeArray.getJSONObject(i);
                    String number = entry.optString("number", "").trim();
                    String url = entry.optString("url", "");
                    String title = boundedDisplay(entry.optString("title", ""), 240);
                    if (number.isEmpty() || number.length() > 40 || url.length() > 4096
                        || entry.optString("ids", "").length() > 1000
                        || !Network.matchesSource(payload.source, url)) return null;
                    payload.episodes.add(new EpisodeEntry(number, url, title, entry.optBoolean("watched", false)));
                }
                int requestedIndex = data.optInt("episodeIndex", -1);
                if (requestedIndex >= 0 && requestedIndex < payload.episodes.size()
                    && payload.episodeUrl.equals(payload.episodes.get(requestedIndex).url)) {
                    payload.episodeIndex = requestedIndex;
                } else {
                    for (int i = 0; i < payload.episodes.size(); i++) {
                        if (payload.episodeUrl.equals(payload.episodes.get(i).url)) {
                            payload.episodeIndex = i;
                            break;
                        }
                    }
                }
                if (payload.episodeIndex < 0) return null;
            } else {
                payload.episodes.add(new EpisodeEntry(payload.episodeNumber, payload.episodeUrl, payload.episodeTitle, false));
                payload.episodeIndex = 0;
            }

            payload.language = "indonesian".equals(firstString("language", data, online, playback)) ? "indonesian" : "english";
            payload.subtitleLanguage = firstString("subtitleLanguage", online, playback, data);
            if (!"english".equals(payload.subtitleLanguage) && !"indonesian".equals(payload.subtitleLanguage)) {
                payload.subtitleLanguage = payload.language;
            }
            payload.server = firstString("server", data, online);
            if (!payload.server.matches("(?:auto|(?:sogo|suge|anikoto|rulz|waves|bash|xin|narul|stream|world)-[a-z0-9-]{1,90})")) {
                payload.server = "auto";
            }
            payload.quality = firstString("quality", data, online);
            if (!payload.quality.matches("(?:best|v:[0-9]{2,5}x[0-9]{2,5}|f:[0-9]{3,4})")) payload.quality = "best";
            if ("auto".equals(payload.server) && !"best".equals(payload.quality)) payload.quality = "best";
            payload.qualityCap = allowedInt(firstInt("qualityCap", 0, online, data, playback), 0,
                0, 360, 480, 720, 1080, 1440, 2160);
            payload.resume = firstBoolean("resume", true, online, data, playback);
            payload.autoPlayNext = firstBoolean("autoPlayNext", true, online, playback, data);
            double startSeconds = firstDouble("startPositionSeconds", 0, data, online, playback);
            if (!data.has("startPositionSeconds") && !online.has("startPositionSeconds") && !playback.has("startPositionSeconds")) {
                startSeconds = firstDouble("startSeconds", 0, data, online, playback);
            }
            if (payload.resume && Double.isFinite(startSeconds) && startSeconds > 0) {
                payload.startPositionMs = Math.min(MAX_POSITION_MS, Math.round(startSeconds * 1000.0));
            }
            payload.speedIndex = nearestSpeedIndex(firstDouble("playbackRate", 1, playback, data, online));
            payload.seekSeconds = allowedInt(firstInt("seekSeconds", 10, playback, data), 10, 5, 10, 15, 30);
            payload.subtitleSize = allowedInt(firstInt("subtitleSize", 18, playback, data), 18,
                12, 14, 16, 18, 22, 26, 32);
            String color = firstString("subtitleColor", playback, data);
            if (Arrays.asList("white", "yellow", "cyan", "green").contains(color)) payload.subtitleColor = color;
            String background = firstString("subtitleBackground", playback, data);
            if (Arrays.asList("shadow", "solid", "none").contains(background)) payload.subtitleBackground = background;
            payload.sleepTimerMinutes = allowedInt(firstInt("sleepTimerMinutes", 0, playback, data), 0,
                0, 5, 10, 15, 30, 45, 60);
            return payload;
        } catch (Exception ignored) {
            return null;
        }
    }

    private Button toolButton(String text, String description) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(11);
        button.setContentDescription(description);
        button.setBackgroundColor(0x33ffffff);
        button.setPadding(dp(6), 0, dp(6), 0);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        return button;
    }

    private void styleButton(Button button, boolean enabled) {
        if (button == null) return;
        button.setEnabled(enabled);
        button.setAlpha(enabled ? 1f : 0.45f);
    }

    private void buildLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        playerView = new PlayerView(this);
        playerView.setShowSubtitleButton(true);
        playerView.setShowPreviousButton(false);
        playerView.setShowNextButton(false);
        playerView.setShowRewindButton(true);
        playerView.setShowFastForwardButton(true);
        playerView.setControllerShowTimeoutMs(5000);
        playerView.setFullscreenButtonClickListener(isFullscreen -> {
            if (isFullscreen) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            } else {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                getWindow().getDecorView().setSystemUiVisibility(0);
            }
        });
        root.addView(playerView, new FrameLayout.LayoutParams(-1, -1));

        header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(9), dp(4), dp(12), dp(8));
        header.setBackgroundColor(0x99000000);
        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView back = new TextView(this);
        back.setText("‹");
        back.setTextSize(35);
        back.setTextColor(Color.WHITE);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription("Go back");
        back.setOnClickListener(v -> finish());
        titleRow.addView(back, new LinearLayout.LayoutParams(dp(48), dp(52)));
        titleView = new TextView(this);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(13);
        titleView.setMaxLines(2);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleRow.addView(titleView, new LinearLayout.LayoutParams(0, -2, 1));
        header.addView(titleRow, new LinearLayout.LayoutParams(-1, dp(54)));

        LinearLayout tools = new LinearLayout(this);
        tools.setOrientation(LinearLayout.HORIZONTAL);
        tools.setGravity(Gravity.CENTER_VERTICAL);
        tools.setPadding(dp(48), dp(2), 0, 0);
        backSeekButton = toolButton("-10s", "Back 10 seconds");
        backSeekButton.setOnClickListener(v -> { seekBy(-seekSeconds * 1000L); playerView.showController(); });
        tools.addView(backSeekButton, new LinearLayout.LayoutParams(0, dp(38), 1));
        Button restartButton = toolButton("Restart", "Restart from the beginning");
        restartButton.setOnClickListener(v -> { restart(); playerView.showController(); });
        LinearLayout.LayoutParams restartParams = new LinearLayout.LayoutParams(0, dp(38), 1);
        restartParams.leftMargin = dp(6);
        tools.addView(restartButton, restartParams);
        speedButton = toolButton("Speed 1×", "Playback speed 1×. Tap to change speed.");
        speedButton.setOnClickListener(v -> { cycleSpeed(); playerView.showController(); });
        LinearLayout.LayoutParams speedParams = new LinearLayout.LayoutParams(0, dp(38), 1);
        speedParams.leftMargin = dp(6);
        tools.addView(speedButton, speedParams);
        forwardSeekButton = toolButton("+10s", "Forward 10 seconds");
        forwardSeekButton.setOnClickListener(v -> { seekBy(seekSeconds * 1000L); playerView.showController(); });
        LinearLayout.LayoutParams forwardParams = new LinearLayout.LayoutParams(0, dp(38), 1);
        forwardParams.leftMargin = dp(6);
        tools.addView(forwardSeekButton, forwardParams);
        header.addView(tools, new LinearLayout.LayoutParams(-1, dp(42)));

        LinearLayout episodeTools = new LinearLayout(this);
        episodeTools.setOrientation(LinearLayout.HORIZONTAL);
        episodeTools.setGravity(Gravity.CENTER_VERTICAL);
        episodeTools.setPadding(dp(48), dp(5), 0, 0);
        previousButton = toolButton("Previous", "Play previous episode");
        previousButton.setOnClickListener(v -> {
            if (currentPayload != null) requestEpisode(currentPayload.episodeIndex - 1, false);
        });
        episodeTools.addView(previousButton, new LinearLayout.LayoutParams(0, dp(38), 1));
        watchedButton = toolButton("Mark watched", "Mark this episode as watched");
        watchedButton.setOnClickListener(v -> toggleCurrentWatched());
        LinearLayout.LayoutParams watchedParams = new LinearLayout.LayoutParams(0, dp(38), 1);
        watchedParams.leftMargin = dp(6);
        episodeTools.addView(watchedButton, watchedParams);
        nextButton = toolButton("Next", "Play next episode");
        nextButton.setOnClickListener(v -> {
            if (currentPayload != null) requestEpisode(currentPayload.episodeIndex + 1, false);
        });
        LinearLayout.LayoutParams nextParams = new LinearLayout.LayoutParams(0, dp(38), 1);
        nextParams.leftMargin = dp(6);
        episodeTools.addView(nextButton, nextParams);
        header.addView(episodeTools, new LinearLayout.LayoutParams(-1, dp(44)));
        root.addView(header, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        statusPanel = new LinearLayout(this);
        statusPanel.setOrientation(LinearLayout.VERTICAL);
        statusPanel.setGravity(Gravity.CENTER_HORIZONTAL);
        statusPanel.setPadding(dp(20), dp(18), dp(20), dp(18));
        statusPanel.setBackgroundColor(Color.argb(235, 16, 18, 16));
        progress = new ProgressBar(this);
        statusPanel.addView(progress, new LinearLayout.LayoutParams(dp(42), dp(42)));
        statusTitle = new TextView(this);
        statusTitle.setTextColor(Color.WHITE);
        statusTitle.setTextSize(17);
        statusTitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusTitleParams = new LinearLayout.LayoutParams(-1, -2);
        statusTitleParams.topMargin = dp(10);
        statusPanel.addView(statusTitle, statusTitleParams);
        statusText = new TextView(this);
        statusText.setTextColor(0xffc9d2c2);
        statusText.setTextSize(13);
        statusText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusTextParams = new LinearLayout.LayoutParams(-1, -2);
        statusTextParams.topMargin = dp(7);
        statusPanel.addView(statusText, statusTextParams);
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(-1, dp(44));
        actionParams.topMargin = dp(16);
        retryButton = toolButton("Retry direct", "Try the direct stream again");
        retryButton.setTextSize(12);
        retryButton.setOnClickListener(v -> retryCurrent());
        actions.addView(retryButton, new LinearLayout.LayoutParams(0, dp(42), 1));
        fallbackButton = toolButton("Use embedded", "Open this episode in the embedded player");
        fallbackButton.setTextSize(12);
        fallbackButton.setOnClickListener(v -> requestFallback("You chose the embedded player for this episode."));
        LinearLayout.LayoutParams fallbackParams = new LinearLayout.LayoutParams(0, dp(42), 1);
        fallbackParams.leftMargin = dp(7);
        actions.addView(fallbackButton, fallbackParams);
        closeStatusButton = toolButton("Close", "Close the player");
        closeStatusButton.setTextSize(12);
        closeStatusButton.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(0, dp(42), 1);
        closeParams.leftMargin = dp(7);
        actions.addView(closeStatusButton, closeParams);
        statusPanel.addView(actions, actionParams);
        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER);
        panelParams.setMargins(dp(20), dp(20), dp(20), dp(20));
        root.addView(statusPanel, panelParams);

        playerView.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            if (statusPanel == null || statusPanel.getVisibility() != View.VISIBLE) {
                header.setVisibility(visibility);
            }
        });
        setContentView(root);
    }

    private void showStatus(String title, String message, boolean showProgress,
                            boolean showRetry, boolean showFallback, boolean showClose) {
        if (statusPanel == null) return;
        statusTitle.setText(title == null ? "" : title);
        statusText.setText(message == null ? "" : message);
        progress.setVisibility(showProgress ? View.VISIBLE : View.GONE);
        retryButton.setVisibility(showRetry ? View.VISIBLE : View.GONE);
        fallbackButton.setVisibility(showFallback ? View.VISIBLE : View.GONE);
        closeStatusButton.setVisibility(showClose ? View.VISIBLE : View.GONE);
        styleButton(retryButton, !resolving && !fallbackRequested);
        styleButton(fallbackButton, !fallbackRequested);
        styleButton(closeStatusButton, true);
        statusPanel.setVisibility(View.VISIBLE);
        header.setVisibility(View.VISIBLE);
    }

    private void showError(String title, String message, boolean canRetry, boolean canFallback) {
        showStatus(title, message, false, canRetry, canFallback, true);
        if (statusPanel != null) statusPanel.announceForAccessibility(title + ". " + message);
    }

    private void hideStatus() {
        if (statusPanel != null) statusPanel.setVisibility(View.GONE);
        if (playerView != null) playerView.showController();
    }

    private String speedLabel(float speed) {
        String text = Float.toString(speed);
        if (text.endsWith(".0")) text = text.substring(0, text.length() - 2);
        return text + "×";
    }

    private void updateEpisodeControls() {
        if (currentPayload == null) return;
        backSeekButton.setText("-" + seekSeconds + "s");
        backSeekButton.setContentDescription("Back " + seekSeconds + " seconds");
        forwardSeekButton.setText("+" + seekSeconds + "s");
        forwardSeekButton.setContentDescription("Forward " + seekSeconds + " seconds");
        speedButton.setText("Speed " + speedLabel(SPEEDS[speedIndex]));
        speedButton.setContentDescription("Playback speed " + speedLabel(SPEEDS[speedIndex]) + ". Tap to change speed.");
        boolean busy = resolving || switchingEpisode || fallbackRequested;
        styleButton(previousButton, !busy && currentPayload.episodeIndex > 0);
        styleButton(nextButton, !busy && currentPayload.episodeIndex >= 0
            && currentPayload.episodeIndex < currentPayload.episodes.size() - 1);
        EpisodeEntry current = currentPayload.episodeIndex >= 0 && currentPayload.episodeIndex < currentPayload.episodes.size()
            ? currentPayload.episodes.get(currentPayload.episodeIndex) : null;
        boolean watched = current != null && current.watched;
        watchedButton.setText(watched ? "✓ Watched" : "Mark watched");
        watchedButton.setContentDescription(watched ? "Mark this episode as not watched" : "Mark this episode as watched");
        styleButton(watchedButton, !busy && current != null);
    }

    private void updateTitle() {
        if (currentPayload == null || titleView == null) return;
        String stream = "Direct stream";
        if (currentStream != null) {
            String label = boundedDisplay(currentStream.serverLabel, 80);
            if (label.isEmpty()) label = boundedDisplay(currentStream.host, 80);
            if (!label.isEmpty()) stream += " · " + label;
        }
        titleView.setText(currentPayload.title + "  ·  EP " + currentPayload.episodeNumber + "\n" + stream);
    }

    private void applyPayload(Payload payload) {
        if (payload == null) return;
        boolean sameSeries = currentPayload != null && currentPayload.seriesKey.equals(payload.seriesKey);
        releasePlayer(true);
        if (!sameSeries) {
            sleepDeadlineElapsedMs = 0;
            if (sleepRunnable != null) mainHandler.removeCallbacks(sleepRunnable);
            sleepRunnable = null;
        }
        currentPayload = payload;
        currentStream = null;
        loadedEpisodeUrl = "";
        speedIndex = payload.speedIndex;
        seekSeconds = payload.seekSeconds;
        subtitleSize = payload.subtitleSize;
        subtitleColor = payload.subtitleColor;
        subtitleBackground = payload.subtitleBackground;
        sleepTimerMinutes = payload.sleepTimerMinutes;
        resolving = true;
        switchingEpisode = false;
        playbackStarted = false;
        endedHandled = false;
        fallbackRequested = false;
        if (fallbackFinishRunnable != null) mainHandler.removeCallbacks(fallbackFinishRunnable);
        fallbackFinishRunnable = null;
        int generation = ++loadGeneration;
        updateTitle();
        updateEpisodeControls();
        showStatus("Finding a direct stream…",
            "Mikozora is asking this server for a stream it can play itself. If the server does not allow that, the embedded player will be offered instead.",
            true, false, true, true);
        startResolver(generation, payload);
    }

    private String safeResolveError(Exception error) {
        String message = error == null ? "" : String.valueOf(error.getMessage() == null ? "" : error.getMessage()).trim();
        if (message.length() <= 180 && !message.toLowerCase(Locale.ROOT).contains("://")
            && (message.startsWith("No supported") || message.startsWith("No compatible")
            || message.startsWith("No Mikozora-compatible") || message.startsWith("The chosen server")
            || message.startsWith("Choose a server") || message.startsWith("Invalid")
            || message.startsWith("Episode") || message.startsWith("Unsupported")
            || message.startsWith("This server") || message.startsWith("Source"))) {
            return boundedDisplay(message, 180);
        }
        return "This server did not provide a direct stream Mikozora can play.";
    }

    private void startResolver(int generation, Payload payload) {
        resolverExecutor.execute(() -> {
            try {
                VideoResolver.Result result = VideoResolver.resolve(
                    new JSONObject(payload.resolverItem.toString()),
                    new JSONObject(payload.resolverEpisode.toString()),
                    payload.language,
                    payload.server,
                    payload.quality
                );
                if (result == null || !Network.isHttps(result.url)) {
                    throw new IOException("Unsupported direct stream");
                }
                SafeHttp.publicUrl(result.url);
                List<VideoResolver.Track> safeTracks = new ArrayList<>();
                for (VideoResolver.Track track : result.tracks) {
                    if (safeTracks.size() >= 30) break;
                    try {
                        SafeHttp.publicUrl(track.url);
                        safeTracks.add(track);
                    } catch (Exception ignored) {
                        // One unusable caption file should not block the episode.
                    }
                }
                result.tracks.clear();
                result.tracks.addAll(safeTracks);
                runOnUiThread(() -> {
                    if (!destroyed && !isFinishing() && generation == loadGeneration && payload == currentPayload) {
                        startPlayer(payload, result);
                    }
                });
            } catch (Exception error) {
                String message = safeResolveError(error);
                runOnUiThread(() -> {
                    if (destroyed || isFinishing() || generation != loadGeneration || payload != currentPayload) return;
                    resolving = false;
                    switchingEpisode = false;
                    updateEpisodeControls();
                    requestFallback(message);
                });
            }
        });
    }

    private String preferredTextCode(String language) {
        return "indonesian".equals(language) ? "id" : "en";
    }

    private boolean trackMatchesLanguage(VideoResolver.Track track, String wanted) {
        String code = track.language == null ? "" : track.language.trim().toLowerCase(Locale.ROOT);
        String label = track.label == null ? "" : track.label.trim().toLowerCase(Locale.ROOT);
        if ("indonesian".equals(wanted)) {
            return code.equals("id") || code.equals("in") || code.equals("ind")
                || code.startsWith("id-") || code.startsWith("in-")
                || label.contains("indonesia") || label.contains("bahasa");
        }
        return code.equals("en") || code.equals("eng") || code.startsWith("en-") || label.contains("english");
    }

    private String subtitleMime(VideoResolver.Track track) {
        String declared = track.mime == null ? "" : track.mime.trim().toLowerCase(Locale.ROOT);
        if (!declared.isEmpty()) return declared;
        String url = track.url == null ? "" : track.url.toLowerCase(Locale.ROOT);
        int query = url.indexOf('?');
        if (query >= 0) url = url.substring(0, query);
        if (url.endsWith(".srt")) return "application/x-subrip";
        if (url.endsWith(".ass") || url.endsWith(".ssa")) return "text/x-ssa";
        if (url.endsWith(".ttml") || url.endsWith(".xml")) return "application/ttml+xml";
        return "text/vtt";
    }

    private int subtitleForegroundColor() {
        if ("yellow".equals(subtitleColor)) return Color.rgb(255, 228, 92);
        if ("cyan".equals(subtitleColor)) return Color.rgb(124, 231, 255);
        if ("green".equals(subtitleColor)) return Color.rgb(168, 240, 160);
        return Color.WHITE;
    }

    private int subtitleBackgroundColor() {
        if ("solid".equals(subtitleBackground)) return Color.argb(235, 0, 0, 0);
        if ("none".equals(subtitleBackground)) return Color.TRANSPARENT;
        return Color.argb(140, 0, 0, 0);
    }

    private void applySubtitleStyle() {
        if (playerView == null) return;
        SubtitleView subtitles = playerView.getSubtitleView();
        if (subtitles == null) return;
        subtitles.setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, subtitleSize);
        subtitles.setApplyEmbeddedStyles(false);
        subtitles.setStyle(new CaptionStyleCompat(
            subtitleForegroundColor(), subtitleBackgroundColor(), Color.TRANSPARENT,
            CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW, Color.BLACK, null));
    }

    private DataSource.Factory dataSourceFactory(VideoResolver.Result result) {
        String resolverReferer = result.referer != null && Network.isHttps(result.referer) ? result.referer : "";
        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(false)
            .dns(hostname -> {
                List<InetAddress> addresses = Dns.SYSTEM.lookup(hostname);
                try {
                    for (InetAddress address : addresses) SafeHttp.requirePublicAddress(address);
                } catch (IOException error) {
                    UnknownHostException wrapped = new UnknownHostException("Private video host is not allowed");
                    wrapped.initCause(error);
                    throw wrapped;
                }
                return addresses;
            })
            .addNetworkInterceptor(chain -> {
                String raw = chain.request().url().toString();
                if (!Network.isHttps(raw)) throw new IOException("Unsupported video redirect");
                String host = chain.request().url().host().toLowerCase(Locale.ROOT);
                if (host.endsWith(".internal") || host.endsWith(".home.arpa")) {
                    throw new IOException("Private video redirect");
                }
                return chain.proceed(chain.request());
            })
            .build();
        OkHttpDataSource.Factory http = new OkHttpDataSource.Factory(client).setUserAgent(Network.UA);
        ResolvingDataSource.Factory resolvingFactory = new ResolvingDataSource.Factory(http, spec -> {
            String raw = spec.uri.toString();
            if (!Network.isHttps(raw)) throw new IOException("Unsupported video URL");
            URL url = new URL(raw);
            String host = url.getHost().toLowerCase(Locale.ROOT);
            String referer = resolverReferer;
            if (referer.isEmpty()) {
                if (host.equals("dailymotion.com") || host.endsWith(".dailymotion.com") || host.endsWith(".dmcdn.net")) {
                    referer = "https://www.dailymotion.com/";
                } else if (host.equals("mediafire.com") || host.endsWith(".mediafire.com")) {
                    referer = "https://www.mediafire.com/";
                } else {
                    referer = "https://megaplay.buzz/";
                }
            }
            HashMap<String, String> headers = new HashMap<>(spec.httpRequestHeaders);
            headers.put("Referer", referer);
            try {
                URL origin = new URL(referer);
                headers.put("Origin", origin.getProtocol() + "://" + origin.getHost());
            } catch (Exception ignored) {}
            return spec.buildUpon().setHttpRequestHeaders(headers).build();
        });
        return new DefaultDataSource.Factory(this, resolvingFactory);
    }

    private void startPlayer(Payload payload, VideoResolver.Result result) {
        resolving = false;
        switchingEpisode = false;
        currentStream = result;
        loadedEpisodeUrl = payload.episodeUrl;
        updateTitle();
        updateEpisodeControls();
        String note = boundedDisplay(result.subtitleDescription, 220);
        if (note.isEmpty()) note = result.tracks.isEmpty()
            ? "No separate subtitle tracks were reported by this server."
            : "Subtitle tracks supplied by the server are available from the captions button.";
        showStatus("Loading direct stream…", note, true, false, true, true);
        try {
            List<MediaItem.SubtitleConfiguration> subtitles = new ArrayList<>();
            for (VideoResolver.Track track : result.tracks) {
                if (!Network.isHttps(track.url)) continue;
                boolean preferred = track.preferred || trackMatchesLanguage(track, payload.subtitleLanguage);
                subtitles.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(track.url))
                    .setMimeType(subtitleMime(track))
                    .setLanguage(track.language == null || track.language.isEmpty() ? "und" : track.language)
                    .setLabel(boundedDisplay(track.label, 120).isEmpty() ? "Subtitles" : boundedDisplay(track.label, 120))
                    .setSelectionFlags(preferred ? C.SELECTION_FLAG_DEFAULT : 0)
                    .build());
            }
            MediaItem.Builder mediaBuilder = new MediaItem.Builder()
                .setUri(Uri.parse(result.url))
                .setMediaId(payload.episodeUrl)
                .setSubtitleConfigurations(subtitles);
            String mime = result.mime == null ? "" : result.mime.trim();
            if (mime.toLowerCase(Locale.ROOT).contains("mpegurl")) mediaBuilder.setMimeType(MimeTypes.APPLICATION_M3U8);
            else if (mime.toLowerCase(Locale.ROOT).startsWith("video/")) mediaBuilder.setMimeType(mime);
            MediaItem mediaItem = mediaBuilder.build();

            player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory(result)))
                .setSeekBackIncrementMs(seekSeconds * 1000L)
                .setSeekForwardIncrementMs(seekSeconds * 1000L)
                .build();
            player.setPlaybackParameters(new PlaybackParameters(SPEEDS[speedIndex]));
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(), true);
            androidx.media3.common.TrackSelectionParameters.Builder selection =
                player.getTrackSelectionParameters().buildUpon()
                    .setPreferredTextLanguage(preferredTextCode(payload.subtitleLanguage));
            if (payload.qualityCap > 0) selection.setMaxVideoSize(Integer.MAX_VALUE, payload.qualityCap);
            player.setTrackSelectionParameters(selection.build());
            player.addListener(new Player.Listener() {
                @Override public void onPlaybackStateChanged(int playbackState) {
                    if (player == null || destroyed) return;
                    if (playbackState == Player.STATE_READY && !playbackStarted) {
                        playbackStarted = true;
                        hideStatus();
                        reportPosition(false);
                    } else if (playbackState == Player.STATE_ENDED) {
                        handlePlaybackEnded();
                    }
                }

                @Override public void onIsPlayingChanged(boolean isPlaying) {
                    if (!isPlaying) reportPosition(false);
                }

                @Override public void onPlayerError(PlaybackException error) {
                    if (destroyed || isFinishing()) return;
                    reportPosition(false);
                    resolving = false;
                    switchingEpisode = false;
                    updateEpisodeControls();
                    showError("Direct playback stopped",
                        "This direct stream could not be played. Check your connection, retry it, or use the embedded player.",
                        true, true);
                }
            });
            playerView.setPlayer(player);
            applySubtitleStyle();
            player.setMediaItem(mediaItem);
            if (payload.startPositionMs > 0) player.seekTo(payload.startPositionMs);
            player.prepare();
            player.setPlayWhenReady(true);
            mainHandler.removeCallbacks(positionTicker);
            mainHandler.postDelayed(positionTicker, 5000);
            startSleepTimer();
        } catch (Exception error) {
            releasePlayer(false);
            showError("Direct playback could not start",
                "Mikozora could not open this direct stream. Retry it or use the embedded player.",
                true, true);
        }
    }

    private void reportPosition(boolean ended) {
        if (player == null || currentPayload == null || loadedEpisodeUrl.isEmpty()) return;
        long position = Math.max(0, Math.min(MAX_POSITION_MS, player.getCurrentPosition()));
        long duration = player.getDuration();
        if (duration == C.TIME_UNSET || duration < 0) duration = 0;
        duration = Math.min(MAX_POSITION_MS, duration);
        int rateMilli = Math.round(SPEEDS[speedIndex] * 1000f);
        PlayerNavigation.reportOnlinePosition(loadedEpisodeUrl, position, duration, rateMilli, ended);
    }

    private void releasePlayer(boolean report) {
        mainHandler.removeCallbacks(positionTicker);
        if (player != null) {
            if (report) reportPosition(false);
            try { player.stop(); } catch (Exception ignored) {}
            player.release();
            player = null;
        }
        if (playerView != null) playerView.setPlayer(null);
    }

    private void seekBy(long deltaMs) {
        if (player == null) return;
        long duration = player.getDuration();
        long target = Math.max(0, player.getCurrentPosition() + deltaMs);
        if (duration != C.TIME_UNSET && duration > 0) target = Math.min(duration, target);
        player.seekTo(target);
        reportPosition(false);
    }

    private void restart() {
        if (player == null) return;
        endedHandled = false;
        player.seekTo(0);
        player.setPlayWhenReady(true);
        reportPosition(false);
    }

    private void cycleSpeed() {
        if (player == null) return;
        speedIndex = (speedIndex + 1) % SPEEDS.length;
        player.setPlaybackParameters(new PlaybackParameters(SPEEDS[speedIndex]));
        updateEpisodeControls();
        reportPosition(false);
    }

    private void startSleepTimer() {
        if (sleepRunnable != null) mainHandler.removeCallbacks(sleepRunnable);
        sleepRunnable = null;
        if (sleepDeadlineElapsedMs <= 0) {
            if (sleepTimerMinutes <= 0) return;
            sleepDeadlineElapsedMs = SystemClock.elapsedRealtime() + sleepTimerMinutes * 60000L;
        }
        long delay = sleepDeadlineElapsedMs - SystemClock.elapsedRealtime();
        if (delay <= 0) {
            if (player != null) {
                reportPosition(false);
                player.pause();
            }
            return;
        }
        sleepRunnable = () -> {
            if (player != null && !destroyed) {
                reportPosition(false);
                player.pause();
                Toast.makeText(DirectPlayerActivity.this, "Sleep timer paused playback", Toast.LENGTH_SHORT).show();
            }
        };
        mainHandler.postDelayed(sleepRunnable, delay);
    }

    private void requestEpisode(int index, boolean fromEnded) {
        if (currentPayload == null || switchingEpisode || resolving || fallbackRequested
            || index < 0 || index >= currentPayload.episodes.size()
            || index == currentPayload.episodeIndex) return;
        EpisodeEntry target = currentPayload.episodes.get(index);
        if (!fromEnded) reportPosition(false);
        switchingEpisode = true;
        updateEpisodeControls();
        showStatus("Finding episode " + target.number + "…",
            "Mikozora is preparing the selected episode.",
            true, false, false, true);
        if (!PlayerNavigation.requestEpisode(index, target.url)) {
            showNavigationError("Mikozora is no longer open behind the player. Return to the series and choose an episode again.");
        }
    }

    private void handlePlaybackEnded() {
        if (endedHandled || currentPayload == null) return;
        endedHandled = true;
        reportPosition(true);
        EpisodeEntry current = currentPayload.episodeIndex >= 0 && currentPayload.episodeIndex < currentPayload.episodes.size()
            ? currentPayload.episodes.get(currentPayload.episodeIndex) : null;
        if (current != null && !current.watched) {
            if (PlayerNavigation.requestWatchedChange(current.url, true)) {
                current.watched = true;
                updateEpisodeControls();
            }
        }
        int next = currentPayload.episodeIndex + 1;
        if (currentPayload.autoPlayNext && next < currentPayload.episodes.size()) {
            requestEpisode(next, true);
        }
    }

    private void toggleCurrentWatched() {
        if (currentPayload == null || switchingEpisode || resolving || fallbackRequested) return;
        if (currentPayload.episodeIndex < 0 || currentPayload.episodeIndex >= currentPayload.episodes.size()) return;
        EpisodeEntry current = currentPayload.episodes.get(currentPayload.episodeIndex);
        boolean intended = !current.watched;
        if (!PlayerNavigation.requestWatchedChange(current.url, intended)) {
            Toast.makeText(this, "Mikozora is no longer open behind the player, so the watched mark could not be saved.", Toast.LENGTH_LONG).show();
            return;
        }
        current.watched = intended;
        updateEpisodeControls();
    }

    private void retryCurrent() {
        if (currentPayload == null || resolving || fallbackRequested) return;
        if (player != null) {
            currentPayload.startPositionMs = Math.max(0, player.getCurrentPosition());
            reportPosition(false);
        }
        releasePlayer(false);
        currentStream = null;
        loadedEpisodeUrl = "";
        resolving = true;
        switchingEpisode = false;
        playbackStarted = false;
        endedHandled = false;
        int generation = ++loadGeneration;
        updateTitle();
        updateEpisodeControls();
        showStatus("Finding a direct stream…", "Retrying this episode's direct stream.", true, false, true, true);
        startResolver(generation, currentPayload);
    }

    private void requestFallback(String reason) {
        if (currentPayload == null || fallbackRequested || destroyed || isFinishing()) return;
        fallbackRequested = true;
        switchingEpisode = false;
        reportPosition(false);
        String safeReason = boundedDisplay(reason, 300);
        if (safeReason.isEmpty()) safeReason = "The embedded player was requested for this episode.";
        showStatus("Opening the embedded player…", safeReason, true, false, false, true);
        updateEpisodeControls();
        if (!PlayerNavigation.requestEmbeddedFallback(currentPayload.episodeUrl, safeReason)) {
            fallbackRequested = false;
            updateEpisodeControls();
            showError("Embedded player unavailable",
                "Mikozora is no longer open behind the player. Return to the series and choose the episode again.",
                currentPayload != null, false);
            return;
        }
        fallbackFinishRunnable = () -> {
            if (!destroyed && !isFinishing()) finish();
        };
        mainHandler.postDelayed(fallbackFinishRunnable, 900);
    }

    private void showNavigationError(String message) {
        if (fallbackFinishRunnable != null) mainHandler.removeCallbacks(fallbackFinishRunnable);
        fallbackFinishRunnable = null;
        fallbackRequested = false;
        switchingEpisode = false;
        resolving = false;
        updateEpisodeControls();
        String safe = boundedDisplay(message, 500);
        if (safe.isEmpty()) safe = "Could not load that episode.";
        if (player != null && playbackStarted) {
            hideStatus();
            Toast.makeText(this, safe, Toast.LENGTH_LONG).show();
        } else {
            showError("Episode could not be opened", safe, currentPayload != null, true);
        }
    }

    @Override public void onNavigationError(String message) {
        runOnUiThread(() -> {
            if (!destroyed && !isFinishing()) showNavigationError(message);
        });
    }

    @Override public void onWatchedChangeRejected(String url, boolean watched) {
        runOnUiThread(() -> {
            if (destroyed || isFinishing() || currentPayload == null) return;
            for (EpisodeEntry episode : currentPayload.episodes) {
                if (episode.url.equals(url) && episode.watched == watched) episode.watched = !watched;
            }
            updateEpisodeControls();
            Toast.makeText(DirectPlayerActivity.this,
                "That watched change could not be saved. Return to the series and try again.",
                Toast.LENGTH_LONG).show();
        });
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        Payload payload = parsePayload(getIntent());
        if (payload == null) {
            Toast.makeText(this, "This episode could not be opened.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        PlayerNavigation.setErrorListener(this);
        buildLayout();
        applyPayload(payload);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Payload payload = parsePayload(intent);
        if (payload == null) {
            showNavigationError("That episode could not be opened. The current episode is still available.");
            return;
        }
        setIntent(intent);
        applyPayload(payload);
    }

    @Override protected void onPause() {
        if (player != null) {
            reportPosition(false);
            player.pause();
        }
        super.onPause();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        loadGeneration++;
        boolean finishing = isFinishing();
        if (sleepRunnable != null) mainHandler.removeCallbacks(sleepRunnable);
        if (fallbackFinishRunnable != null) mainHandler.removeCallbacks(fallbackFinishRunnable);
        if (finishing) reportPosition(false);
        releasePlayer(false);
        resolverExecutor.shutdownNow();
        PlayerNavigation.clearErrorListener(this);
        if (finishing) PlayerNavigation.playerClosed();
        super.onDestroy();
    }
}
