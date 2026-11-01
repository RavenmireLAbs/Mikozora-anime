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
        void onPlayerClosed();
    }

    interface ErrorListener {
        void onNavigationError(String message);
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
}
