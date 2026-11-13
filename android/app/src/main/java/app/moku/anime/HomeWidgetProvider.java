package app.moku.anime;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/** Glanceable, private-by-default Continue Watching home-screen widget. */
public final class HomeWidgetProvider extends AppWidgetProvider {
    private static final String PREFS = "moku_home_widget_v1";
    private static final String TITLE = "title";
    private static final String EPISODE = "episode";
    private static final String SOURCE = "source";
    private static final String URL = "url";
    static final String EXTRA_OPEN_ITEM = "moku_widget_open_item";
    static final String EXTRA_SOURCE = "moku_widget_source";
    static final String EXTRA_URL = "moku_widget_url";

    static void saveData(Context context, String title, String episode, String source, String url) {
        try {
            String safeSource = source == null ? "" : source.trim();
            String safeUrl = url == null ? "" : url.trim();
            if (!Network.matchesSource(safeSource, safeUrl)) { safeSource = ""; safeUrl = ""; }
            prefs(context).edit().putString(TITLE, clean(title, 100)).putString(EPISODE, clean(episode, 40))
                .putString(SOURCE, safeSource).putString(URL, safeUrl).apply();
            refreshAll(context);
        } catch (Exception ignored) { }
    }

    static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, HomeWidgetProvider.class));
            if (ids != null && ids.length > 0) new HomeWidgetProvider().onUpdate(context, manager, ids);
        } catch (Exception ignored) { }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String clean(String value, int limit) {
        if (value == null) return "";
        String result = value.replaceAll("[\\p{Cc}\\p{Cf}]", " ").replaceAll("\\s+", " ").trim();
        return result.length() > limit ? result.substring(0, limit).trim() : result;
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        SharedPreferences data = prefs(context);
        boolean locked = AppLock.enabled(context);
        String title = clean(data.getString(TITLE, ""), 100);
        String episode = clean(data.getString(EPISODE, ""), 40);
        String titleText = locked ? "Unlock Mikozora to view your list"
            : title.isEmpty() ? "Your next episode, at a glance" : title;
        String detailText = locked ? "Your private titles are hidden on this widget"
            : title.isEmpty() ? "Open Mikozora to get started" : episode.isEmpty() ? "Continue watching" : episode;

        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.home_widget);
            views.setTextViewText(R.id.widget_title, titleText);
            views.setTextViewText(R.id.widget_episode, detailText);
            views.setContentDescription(R.id.widget_root, locked
                ? "Mikozora is locked. Open the app to unlock your private list."
                : title.isEmpty() ? "Open Mikozora" : "Continue watching " + title + (episode.isEmpty() ? "" : ", " + episode));

            Intent launch = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            String source = data.getString(SOURCE, "");
            String url = data.getString(URL, "");
            if (Network.matchesSource(source, url)) {
                launch.putExtra(EXTRA_OPEN_ITEM, true).putExtra(EXTRA_SOURCE, source).putExtra(EXTRA_URL, url);
            }
            PendingIntent pending = PendingIntent.getActivity(context, id, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_root, pending);
            manager.updateAppWidget(id, views);
        }
    }
}
