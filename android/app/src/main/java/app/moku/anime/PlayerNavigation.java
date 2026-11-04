package app.moku.anime;

import java.lang.ref.WeakReference;

/**
 * In-process handoff between the isolated online player and the main WebView.
 *
 * The player WebView loads third-party embeds, so it deliberately has no
 * JavaScript bridge. Episode changes are requested through this tiny native
 * callback instead; MainActivity asks the trusted app UI to resolve the
 * selected episode with the same source adapter used for initial playback.
 */
final class PlayerNavigation {
    interface RequestListener {
        void onEpisodeRequested(int index, String url);
        void onWatchedChanged(String url, boolean watched);
        void onPlayerClosed();
        void onOnlinePosition(String url, long positionMs, long durationMs, int playbackRateMilli, boolean ended);
        void onEmbeddedFallbackRequested(String url, String reason);
    }

    interface ErrorListener {
        void onNavigationError(String message);
        void onWatchedChangeRejected(String url, boolean watched);
    }

    private static WeakReference<RequestListener> requestListener = new WeakReference<>(null);
    private static WeakReference<ErrorListener> errorListener = new WeakReference<>(null);

    private PlayerNavigation() {}

    static synchronized void setRequestListener(RequestListener listener) {
        requestListener = new WeakReference<>(listener);
    }

    static synchronized void clearRequestListener(RequestListener expected) {
        if (requestListener.get() == expected) requestListener.clear();
    }

    static synchronized void setErrorListener(ErrorListener listener) {
        errorListener = new WeakReference<>(listener);
    }

    static synchronized void clearErrorListener(ErrorListener expected) {
        if (errorListener.get() == expected) errorListener.clear();
    }

    static boolean requestEpisode(int index, String url) {
        RequestListener listener;
        synchronized (PlayerNavigation.class) {
            listener = requestListener.get();
        }
        if (listener == null) return false;
        listener.onEpisodeRequested(index, url == null ? "" : url);
        return true;
    }

    static boolean requestWatchedChange(String url, boolean watched) {
        RequestListener listener;
        synchronized (PlayerNavigation.class) {
            listener = requestListener.get();
        }
        if (listener == null) return false;
        listener.onWatchedChanged(url == null ? "" : url, watched);
        return true;
    }

    static boolean reportOnlinePosition(String url, long positionMs, long durationMs, int playbackRateMilli, boolean ended) {
        RequestListener listener;
        synchronized (PlayerNavigation.class) {
            listener = requestListener.get();
        }
        if (listener == null) return false;
        listener.onOnlinePosition(
            url == null ? "" : url,
            Math.max(0, positionMs),
            Math.max(0, durationMs),
            Math.max(250, Math.min(4000, playbackRateMilli)),
            ended
        );
        return true;
    }

    static boolean requestEmbeddedFallback(String url, String reason) {
        RequestListener listener;
        synchronized (PlayerNavigation.class) {
            listener = requestListener.get();
        }
        if (listener == null) return false;
        listener.onEmbeddedFallbackRequested(url == null ? "" : url, reason == null ? "" : reason);
        return true;
    }

    static void playerClosed() {
        RequestListener listener;
        synchronized (PlayerNavigation.class) {
            listener = requestListener.get();
        }
        if (listener != null) listener.onPlayerClosed();
    }

    static boolean reportError(String message) {
        ErrorListener listener;
        synchronized (PlayerNavigation.class) {
            listener = errorListener.get();
        }
        if (listener == null) return false;
        listener.onNavigationError(message == null ? "" : message);
        return true;
    }

    static boolean reportWatchedRejected(String url, boolean watched) {
        ErrorListener listener;
        synchronized (PlayerNavigation.class) {
            listener = errorListener.get();
        }
        if (listener == null) return false;
        listener.onWatchedChangeRejected(url == null ? "" : url, watched);
        return true;
    }
}
