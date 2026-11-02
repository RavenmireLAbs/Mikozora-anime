package app.moku.anime;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Turns pending newly discovered episodes into ordinary native downloads. */
final class SmartDownloads {
    private static final Object LOCK = new Object();
    private static final Set<String> OCCUPYING = new HashSet<>(Arrays.asList(
        "queued", "resolving", "downloading", "paused", "completed"));

    private SmartDownloads() {}

    static String decision(JSONObject event, JSONObject track, JSONArray records, int maxUnwatchedPerSeries) {
        Set<String> watched = new HashSet<>();
        JSONArray watchedRaw = track == null ? null : track.optJSONArray("watchedEpisodes");
        if (watchedRaw != null) {
            for (int i = 0; i < watchedRaw.length(); i++) {
                String url = watchedRaw.optString(i);
                if (!url.isEmpty()) watched.add(url);
            }
        }
        JSONObject episode = event == null ? null : event.optJSONObject("episode");
        String episodeUrl = episode == null ? "" : episode.optString("url");
        if (watched.contains(episodeUrl)) return "watched";
        JSONObject item = track == null ? null : track.optJSONObject("item");
        String source = item == null ? "" : item.optString("source");
        String seriesUrl = item == null ? "" : item.optString("url");
        int occupying = 0;
        if (records != null) {
            for (int i = 0; i < records.length(); i++) {
                JSONObject record = records.optJSONObject(i);
                if (record == null) continue;
                JSONObject recordItem = record.optJSONObject("item");
                JSONObject recordEpisode = record.optJSONObject("episode");
                if (recordItem == null || recordEpisode == null) continue;
                if (!source.equals(recordItem.optString("source"))
                    || !seriesUrl.equals(recordItem.optString("url"))) continue;
                String recordUrl = recordEpisode.optString("url");
                if (episodeUrl.equals(recordUrl)) return "existing";
                if (record.optBoolean("autoDownload", false)
                    && OCCUPYING.contains(record.optString("status"))
                    && !watched.contains(recordUrl)) occupying++;
            }
        }
        int cap = Math.max(1, Math.min(10, maxUnwatchedPerSeries));
        return occupying >= cap ? "pendingCap" : "queue";
    }

    static int queuePending(Context context) {
        Context c = context.getApplicationContext();
        int queued = 0;
        synchronized (LOCK) {
            try {
                List<JSONObject> pending = EpisodeStore.pendingSmartDownloads(c);
                for (JSONObject event : pending) {
                    JSONObject settings = EpisodeStore.smartSettings(c);
                    JSONObject track = EpisodeStore.track(c, event.optString("titleId"));
                    if (!settings.optBoolean("enabled", false) || track == null || !track.optBoolean("smartDownload", false)) {
                        mark(c, event, "skipped", "");
                        if (!settings.optBoolean("enabled", false)) break;
                        continue;
                    }
                    JSONArray records;
                    try { records = OfflineStore.list(c); } catch (Exception listError) { break; }
                    String next = decision(event, track, records, settings.optInt("maxUnwatchedPerSeries", 3));
                    if (!"queue".equals(next)) {
                        mark(c, event, next, "");
                        continue;
                    }
                    JSONObject preset = EpisodeStore.sanitizeDownloadPreset(track.optJSONObject("downloadPreset"));
                    boolean fallbackAlready = "auto".equals(preset.optString("server"))
                        && "best".equals(preset.optString("quality"))
                        && "auto".equals(preset.optString("subtitleMode"));
                    try {
                        JSONObject result;
                        try {
                            result = enqueue(c, event, track, preset, settings);
                        } catch (Exception firstError) {
                            if (fallbackAlready) throw firstError;
                            JSONObject fallback = new JSONObject()
                                .put("language", preset.optString("language", "english"))
                                .put("server", "auto").put("quality", "best")
                                .put("subtitleMode", "auto").put("subtitleTracks", new JSONArray());
                            result = enqueue(c, event, track, fallback, settings);
                        }
                        if (result.optInt("added", 0) > 0) {
                            queued++;
                            mark(c, event, "queued", "");
                        } else {
                            mark(c, event, "existing", "");
                        }
                    } catch (Exception error) {
                        mark(c, event, "failed", error == null ? "" : String.valueOf(error.getMessage()));
                    }
                }
            } catch (Exception ignored) {
                // Episode checks and sync must succeed even if automatic
                // queueing cannot run yet; pending events remain stored.
            }
        }
        return queued;
    }

    private static JSONObject enqueue(Context c, JSONObject event, JSONObject track, JSONObject preset, JSONObject settings) throws Exception {
        JSONObject item = event.optJSONObject("item");
        if (item == null) item = track.optJSONObject("item");
        JSONObject pair = new JSONObject().put("item", item).put("episode", event.getJSONObject("episode"));
        JSONArray tracks = preset.optJSONArray("subtitleTracks");
        JSONObject input = new JSONObject()
            .put("episodes", new JSONArray().put(pair))
            .put("language", preset.optString("language", "english"))
            .put("server", preset.optString("server", "auto"))
            .put("quality", preset.optString("quality", "best"))
            .put("subtitleMode", preset.optString("subtitleMode", "auto"))
            .put("subtitleTracks", tracks == null ? new JSONArray() : new JSONArray(tracks.toString()));
        return OfflineStore.enqueue(c, input.toString(), true,
            settings.optBoolean("wifiOnly", true), settings.optBoolean("notifyWhenReady", true));
    }

    private static void mark(Context c, JSONObject event, String status, String error) {
        try { EpisodeStore.markSmartDownload(c, event.optString("id"), status, error, System.currentTimeMillis()); }
        catch (Exception ignored) {}
    }
}
