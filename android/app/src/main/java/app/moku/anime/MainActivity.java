package app.moku.anime;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ClipData;
import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.util.LruCache;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity implements PlayerNavigation.RequestListener {
    private WebView web;
    private final ExecutorService requests = Executors.newFixedThreadPool(6);
    // Ten independent catalog requests must not starve folder and download controls.
    private final ExecutorService sourceRequests = Executors.newFixedThreadPool(6);
    // Host probing can be slow; keep it separate so catalog and download controls remain responsive.
    private final ExecutorService optionRequests = Executors.newFixedThreadPool(2);
    // Preserve snapshot ordering without competing with catalog or download work.
    private final ExecutorService episodeCommands = Executors.newSingleThreadExecutor();
    private final AtomicInteger optionGeneration = new AtomicInteger();
    private final AtomicBoolean openUpdates = new AtomicBoolean(false);
    private final SharedPreferences.OnSharedPreferenceChangeListener updatesListener=(prefs,key)->{
        if(EpisodeStore.DATA.equals(key))signalUpdates();
    };
    private final LruCache<String, Network.Result> artwork = new LruCache<String, Network.Result>(18 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Network.Result value) { return value.data.length; }
    };
    private volatile boolean closed = false;
    private static final int PICK_DOWNLOAD_FOLDER = 3181;
    private String pendingFolderRequest;
    private static final String HOME = "https://" + Network.APP_HOST + "/index.html";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if(state!=null){pendingFolderRequest=state.getString("folderRequestId");openUpdates.set(state.getBoolean("openUpdates",false));}
        if(getIntent()!=null&&getIntent().getBooleanExtra(EpisodeNotifier.EXTRA_OPEN,false)){openUpdates.set(true);getIntent().removeExtra(EpisodeNotifier.EXTRA_OPEN);}
        EpisodeNotifier.ensureChannel(this);
        EpisodeStore.preferences(this).registerOnSharedPreferenceChangeListener(updatesListener);
        Appearance.Palette appearance=Appearance.read(this);
        Appearance.applyWindow(this,appearance);
        web = new WebView(this);
        web.setBackgroundColor(appearance.background);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        web.addJavascriptInterface(new Bridge(), "MokuBridge");
        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("Confirm", (dialog, which) -> result.confirm())
                    .setNegativeButton("Cancel", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("OK", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        setContentView(web);
        PlayerNavigation.setRequestListener(this);
        web.loadUrl(HOME);
    }

    @Override public void onEpisodeRequested(int index, String url) {
        if (index < 0 || index > 10000 || url == null || url.length() > 4096 || !Network.allowedSource(url)) {
            PlayerNavigation.reportError("That episode is not available from this source.");
            return;
        }
        String script = "(function(){try{if(window.__mokuPlayerEpisode){window.__mokuPlayerEpisode("
            + index + "," + JSONObject.quote(url) + ");return true;}}catch(e){}return false;})()";
        runOnUiThread(() -> {
            if (closed || web == null) {
                PlayerNavigation.reportError("Mikozora is no longer open behind the player. Return to the series and choose an episode again.");
                return;
            }
            web.evaluateJavascript(script, result -> {
                if (!"true".equals(result)) {
                    PlayerNavigation.reportError("This episode list is no longer available. Return to the series and choose an episode again.");
                }
            });
        });
    }

    @Override public void onPlayerClosed() {
        runOnUiThread(() -> {
            if (!closed && web != null) {
                web.evaluateJavascript("window.__mokuPlayerClosed && window.__mokuPlayerClosed()", null);
            }
        });
    }

    private void rejectPlayerPayload(String message) {
        if (PlayerNavigation.reportError(message)) return;
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
    }

    private final class LocalClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            return !"https".equalsIgnoreCase(uri.getScheme()) || !Network.APP_HOST.equalsIgnoreCase(uri.getHost());
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            return !"https".equalsIgnoreCase(uri.getScheme()) || !Network.APP_HOST.equalsIgnoreCase(uri.getHost());
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return intercept(request.getUrl());
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) { return intercept(Uri.parse(url)); }
        private WebResourceResponse intercept(Uri uri) {
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !Network.APP_HOST.equalsIgnoreCase(uri.getHost())) return null;
            try {
                String path = uri.getPath();
                if ("/api/image".equals(path)) {
                    String url = uri.getQueryParameter("url");
                    Network.Result image = artwork.get(url);
                    if (image == null) { image = Network.get(url, false); artwork.put(url, image); }
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Cache-Control", "public, max-age=600");
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(image.type, null, 200, "OK", headers, new ByteArrayInputStream(image.data));
                }
                if (path == null || "/".equals(path)) path = "/index.html";
                if (path.contains("..") || path.contains("\\")) return fail();
                InputStream input = getAssets().open("web" + path);
                String mime = "application/octet-stream";
                if (path.endsWith(".html")) mime="text/html";
                else if (path.endsWith(".js")) mime="application/javascript";
                else if (path.endsWith(".css")) mime="text/css";
                else if (path.endsWith(".txt")) mime="text/plain";
                else if (path.endsWith(".svg")) mime="image/svg+xml";
                else if (path.endsWith(".ttf")) mime="font/ttf";
                else if (path.endsWith(".woff2")) mime="font/woff2";
                else if (path.endsWith(".png")) mime="image/png";
                Map<String,String> headers = new HashMap<>();
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'");
                return new WebResourceResponse(mime, mime.startsWith("text/") || mime.contains("javascript") ? "UTF-8" : null, 200, "OK", headers, input);
            } catch (Exception e) { return fail(); }
        }
        private WebResourceResponse fail() {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
        }
    }
    private final class Bridge {
        @JavascriptInterface public void setAppearance(String mode,String accent) {
            if(!Appearance.save(MainActivity.this,mode,accent))return;
            runOnUiThread(()->{if(!closed){Appearance.Palette current=Appearance.read(MainActivity.this);Appearance.applyWindow(MainActivity.this,current);if(web!=null)web.setBackgroundColor(current.background);}});
        }
        @JavascriptInterface public void request(String id, String url) {
            if (id == null || !id.matches("[0-9]{1,12}")) return;
            sourceRequests.execute(() -> {
                try { sendChunks(id, Network.get(url, true).text(), null); }
                catch (Exception e) { sendChunks(id, "", e.getMessage() == null ? "Could not reach the source" : e.getMessage()); }
            });
        }
        @JavascriptInterface public void syncEpisodeTitles(String id,String payload,boolean onOpen) {
            if(!validBridgeId(id))return;
            episodeCommands.execute(()->{try{
                JSONObject result=EpisodeStore.sync(MainActivity.this,payload);
                if(onOpen)EpisodeScheduler.onOpen(MainActivity.this);
                else if(result.optBoolean("added"))EpisodeScheduler.onNewTitles(MainActivity.this);
                else EpisodeScheduler.ensure(MainActivity.this);
                if(result.optBoolean("changed"))EpisodeNotifier.refresh(MainActivity.this,false);
                sendChunks(id,episodeState().toString(),null);
            }catch(Exception e){sendChunks(id,"",episodeError(e));}});
        }
        @JavascriptInterface public void episodeUpdates(String id) {
            if(!validBridgeId(id))return;
            episodeCommands.execute(()->{try{sendChunks(id,episodeState().toString(),null);}
                catch(Exception e){sendChunks(id,"",episodeError(e));}});
        }
        @JavascriptInterface public void checkEpisodes(String id) {
            if(!validBridgeId(id))return;
            episodeCommands.execute(()->{try{EpisodeScheduler.manual(MainActivity.this);sendChunks(id,episodeState().toString(),null);}
                catch(Exception e){sendChunks(id,"",episodeError(e));}});
        }
        @JavascriptInterface public void setEpisodeAutomatic(String id,boolean enabled) {
            if(!validBridgeId(id))return;
            episodeCommands.execute(()->{try{
                EpisodeStore.setAutomatic(MainActivity.this,enabled);EpisodeScheduler.ensure(MainActivity.this);
                if(enabled)EpisodeScheduler.onOpen(MainActivity.this);
                sendChunks(id,episodeState().toString(),null);
            }catch(Exception e){sendChunks(id,"",episodeError(e));}});
        }
        @JavascriptInterface public void setEpisodeAlerts(String id,boolean enabled) {
            if(!validBridgeId(id))return;
            episodeCommands.execute(()->{try{EpisodeStore.setAlerts(MainActivity.this,enabled);EpisodeNotifier.refresh(MainActivity.this,false);sendChunks(id,episodeState().toString(),null);}
                catch(Exception e){sendChunks(id,"",episodeError(e));}});
        }
        @JavascriptInterface public void markEpisodeRead(String id,String updateId) {
            if(!validBridgeId(id)||updateId==null||!("all".equals(updateId)||updateId.matches("[a-f0-9]{64}")))return;
            episodeCommands.execute(()->{try{EpisodeStore.markRead(MainActivity.this,updateId,"all".equals(updateId));EpisodeNotifier.refresh(MainActivity.this,false);sendChunks(id,episodeState().toString(),null);}
                catch(Exception e){sendChunks(id,"",episodeError(e));}});
        }
        @JavascriptInterface public boolean takeOpenUpdates(){return openUpdates.getAndSet(false);}
        @JavascriptInterface public void episodeNotificationPermission(boolean automaticPrompt){runOnUiThread(()->notificationPermission(automaticPrompt));}
        @JavascriptInterface public void openPlayer(String payload) {
            if (payload == null || payload.length() > 300000) {
                rejectPlayerPayload("This episode list is too large to open in the player.");
                return;
            }
            runOnUiThread(() -> {
                try {
                    JSONObject data = new JSONObject(payload);
                    String episode = data.getJSONObject("episode").getString("url");
                    if (!Network.allowedSource(episode)) {
                        rejectPlayerPayload("That episode is not available from this source.");
                        return;
                    }
                    JSONArray episodes = data.optJSONArray("episodes");
                    if (episodes != null) {
                        int index = data.optInt("episodeIndex", -1);
                        if (episodes.length() == 0 || episodes.length() > 10000 || index < 0 || index >= episodes.length()) {
                            rejectPlayerPayload("That episode list could not be opened.");
                            return;
                        }
                        for (int i = 0; i < episodes.length(); i++) {
                            JSONObject entry = episodes.getJSONObject(i);
                            String number = entry.optString("number", "");
                            String url = entry.getString("url");
                            if (number.isEmpty() || number.length() > 40 || url.length() > 4096 || !Network.allowedSource(url)) {
                                rejectPlayerPayload("That episode list contains an unavailable episode.");
                                return;
                            }
                        }
                        if (!episode.equals(episodes.getJSONObject(index).getString("url"))) {
                            rejectPlayerPayload("The selected episode does not match this episode list.");
                            return;
                        }
                    }
                    Intent intent = new Intent(MainActivity.this, PlayerActivity.class);
                    intent.putExtra("payload", payload);
                    // Reuse the open player for in-player episode changes instead
                    // of closing it or stacking another player activity.
                    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                    startActivity(intent);
                } catch (Exception ignored) {
                    rejectPlayerPayload("This episode could not be opened.");
                }
            });
        }
        @JavascriptInterface public void playerNavigationError(String message) {
            String safe = message == null ? "" : message.trim();
            if (safe.isEmpty()) safe = "Could not load that episode.";
            if (safe.length() > 500) safe = safe.substring(0, 500);
            PlayerNavigation.reportError(safe);
        }
        @JavascriptInterface public void downloads(String id) {
            if (id == null || !id.matches("[0-9]{1,12}")) return;
            requests.execute(() -> {
                try { sendChunks(id, OfflineStore.list(MainActivity.this).toString(), null); }
                catch (Exception e) { sendChunks(id, "", "Could not read downloads"); }
            });
        }
        @JavascriptInterface public void downloadOptions(String id, String payload) {
            if (id == null || !id.matches("[0-9]{1,12}")) return;
            final int generation = optionGeneration.incrementAndGet();
            optionRequests.execute(() -> {
                if (generation != optionGeneration.get()) { sendChunks(id, "", "Server check superseded."); return; }
                try {
                    if(payload == null || payload.length() > 6000) throw new Exception("Invalid episode information");
                    JSONObject data = new JSONObject(payload);
                    String language = data.optString("language", "english");
                    if (!"english".equals(language) && !"indonesian".equals(language)) throw new Exception("Invalid subtitle language");
                    JSONObject options = VideoResolver.downloadOptions(data.getJSONObject("item"), data.getJSONObject("episode"), language);
                    sendChunks(id, options.toString(), null);
                } catch (Exception e) {
                    String message=e.getMessage();
                    boolean known=message!=null && message.length()<180 && (message.startsWith("No Mikozora-compatible download server") || message.startsWith("No compatible download server") || message.startsWith("No compatible subtitled AnimeBash"));
                    sendChunks(id, "", known ? message : "Could not check server qualities. Try again or use Automatic.");
                }
            });
        }
        @JavascriptInterface public void enqueueDownloads(String id, String payload) {
            if (id == null || !id.matches("[0-9]{1,12}")) return;
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 91));
            requests.execute(() -> {
                try { sendChunks(id, OfflineStore.enqueue(MainActivity.this, payload).toString(), null); }
                catch (Exception e) { sendChunks(id, "", e.getMessage() == null ? "Could not add downloads" : e.getMessage()); }
            });
        }
        @JavascriptInterface public void removeDownload(String id, String downloadId) {
            if (id == null || !id.matches("[0-9]{1,12}")) return;
            requests.execute(() -> {
                try { OfflineStore.remove(MainActivity.this, downloadId); sendChunks(id, "ok", null); }
                catch (Exception e) { sendChunks(id, "", e.getMessage()==null ? "Could not remove the download" : e.getMessage()); }
            });
        }
        @JavascriptInterface public void openDownload(String downloadId) {
            if (downloadId == null || !downloadId.matches("[a-f0-9]{32}")) return;
            runOnUiThread(() -> {
                Intent intent = new Intent(MainActivity.this, OfflinePlayerActivity.class);
                intent.putExtra("downloadId", downloadId); startActivity(intent);
            });
        }
        @JavascriptInterface public void exportSettings(String id) {
            if(id==null||!id.matches("[0-9]{1,12}"))return;
            requests.execute(()->{try{sendChunks(id,ExportStore.settings(MainActivity.this).toString(),null);}
                catch(Exception e){sendChunks(id,"","Could not read the download folder.");}});
        }
        @JavascriptInterface public void chooseDownloadFolder(String id) {
            if(id==null||!id.matches("[0-9]{1,12}"))return;
            runOnUiThread(()->{
                if(pendingFolderRequest!=null){sendChunks(id,"","A folder picker is already open.");return;}
                try {
                    pendingFolderRequest=id;
                    Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        |Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                    startActivityForResult(picker,PICK_DOWNLOAD_FOLDER);
                }catch(Exception e){pendingFolderRequest=null;sendChunks(id,"","No folder picker is available on this device.");}
            });
        }
        @JavascriptInterface public void clearDownloadFolder(String id) {
            if(id==null||!id.matches("[0-9]{1,12}"))return;
            requests.execute(()->{try{sendChunks(id,ExportStore.clearFolder(MainActivity.this).toString(),null);}
                catch(Exception e){sendChunks(id,"","Could not update the download folder.");}});
        }
        @JavascriptInterface public void exportDownload(String id,String downloadId) {
            if(id==null||!id.matches("[0-9]{1,12}"))return;
            requests.execute(()->{try{sendChunks(id,ExportStore.queue(MainActivity.this,downloadId).toString(),null);}
                catch(Exception e){sendChunks(id,"",ExportStore.safeMessage(e));}});
        }
        @JavascriptInterface public void openExport(String downloadId) {
            if(downloadId==null||!downloadId.matches("[a-f0-9]{32}"))return;
            runOnUiThread(()->{
                try {
                    JSONObject meta=OfflineStore.get(MainActivity.this,downloadId);
                    String raw=meta==null?"":meta.optString("exportUri");
                    if(raw.isEmpty())throw new Exception("No exported file");
                    Uri uri=Uri.parse(raw);if(!"content".equalsIgnoreCase(uri.getScheme()))throw new Exception("Invalid file");
                    Intent view=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"video/mp4")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    view.setClipData(ClipData.newRawUri("Mikozora video",uri));
                    startActivity(Intent.createChooser(view,"Open episode with"));
                }catch(Exception e){Toast.makeText(MainActivity.this,"Could not open the exported file. Check the folder and install a video player.",Toast.LENGTH_LONG).show();}
            });
        }
        @JavascriptInterface public void openExternal(String url) {
            if (!Network.allowedSource(url) && !Network.allowedProjectRelease(url)) return;
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (Exception ignored) { }
            });
        }
    }
    private static boolean validBridgeId(String id){return id!=null&&id.matches("[0-9]{1,12}");}
    private JSONObject episodeState() throws Exception {
        return EpisodeStore.state(this).put("notificationStatus",EpisodeNotifier.status(this))
            .put("permissionAsked",EpisodeStore.preferences(this).getBoolean("permissionAsked",false));
    }
    private static String episodeError(Exception e) {
        String message=e.getMessage();
        if(message!=null&&(message.startsWith("Add a title")||message.startsWith("Too many collection")||message.startsWith("A collection title")||message.startsWith("Collection snapshot")))return message;
        return "Could not read or schedule episode updates. Please try again.";
    }
    private void signalUpdates(){
        runOnUiThread(()->{if(!closed&&web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('moku-updates-changed'))",null);});
    }
    private void notificationPermission(boolean automaticPrompt) {
        if(closed)return;
        EpisodeNotifier.ensureChannel(this);
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) {
            boolean asked=EpisodeStore.preferences(this).getBoolean("permissionAsked",false);
            if(automaticPrompt&&asked)return;
            if(!asked||shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
                EpisodeStore.preferences(this).edit().putBoolean("permissionAsked",true).apply();signalUpdates();
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},92);return;
            }
        }
        if(automaticPrompt)return;
        try {
            Intent settings;
            if(Build.VERSION.SDK_INT>=26)settings=new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,EpisodeNotifier.CHANNEL);
            else settings=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()));
            startActivity(settings);
        }catch(Exception ignored){try{startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}catch(Exception alsoIgnored){}}
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode==91||requestCode==92){signalUpdates();episodeCommands.execute(()->EpisodeNotifier.refresh(this,false));}
    }
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);setIntent(intent);
        if(intent!=null&&intent.getBooleanExtra(EpisodeNotifier.EXTRA_OPEN,false)){
            intent.removeExtra(EpisodeNotifier.EXTRA_OPEN);openUpdates.set(true);
            runOnUiThread(()->{if(!closed&&web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('moku-open-updates'))",null);});
        }
    }
    @Override protected void onResume(){super.onResume();signalUpdates();}
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if(pendingFolderRequest!=null)out.putString("folderRequestId",pendingFolderRequest);
        out.putBoolean("openUpdates",openUpdates.get());
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode!=PICK_DOWNLOAD_FOLDER)return;
        String request=pendingFolderRequest;pendingFolderRequest=null;
        if(request==null)return;
        if(resultCode!=RESULT_OK||data==null||data.getData()==null) {
            requests.execute(()->{try{JSONObject state=ExportStore.settings(this);state.put("canceled",true);sendChunks(request,state.toString(),null);}
                catch(Exception e){sendChunks(request,"","Could not read folder settings.");}});
            return;
        }
        Uri tree=data.getData();
        int grants=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            if(grants!=(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
                throw new SecurityException("Folder does not allow reading and writing");
            getContentResolver().takePersistableUriPermission(tree,grants);
            requests.execute(()->{try{sendChunks(request,ExportStore.saveFolder(this,tree).toString(),null);}
                catch(Exception e){sendChunks(request,"",ExportStore.safeMessage(e));}});
        }catch(Exception e){sendChunks(request,"","Could not keep access to this folder. Try another folder.");}
    }
    private void sendChunks(String id, String body, String error) {
        if (closed) return;
        if (error != null) { sendChunk(id, "", true, error); return; }
        int size = 20000;
        if (body.isEmpty()) { sendChunk(id, "", true, null); return; }
        for (int start = 0; start < body.length(); start += size) {
            int end = Math.min(start + size, body.length());
            // Avoid cutting a UTF-16 surrogate pair across JavaScript strings.
            if (end < body.length() && Character.isHighSurrogate(body.charAt(end - 1))) end--;
            String part = body.substring(start, end);
            boolean done = end == body.length();
            sendChunk(id, part, done, null);
            if (end < start + size) start--;
        }
    }
    private void sendChunk(String id, String chunk, boolean done, String error) {
        String script = "window.__mokuNativeChunk && window.__mokuNativeChunk(" + JSONObject.quote(id) + "," + JSONObject.quote(chunk) + "," + done + "," + (error == null ? "null" : JSONObject.quote(error)) + ");";
        runOnUiThread(() -> { if (!closed && web != null) web.evaluateJavascript(script, null); });
    }
    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("(function(){return !!(window.__handleAndroidBack && window.__handleAndroidBack())})()", result -> {
            if (!"true".equals(result)) MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onDestroy() {
        closed = true; PlayerNavigation.clearRequestListener(this);
        EpisodeStore.preferences(this).unregisterOnSharedPreferenceChangeListener(updatesListener);
        requests.shutdownNow(); sourceRequests.shutdownNow(); optionRequests.shutdownNow(); episodeCommands.shutdown();
        if (web != null) { web.removeJavascriptInterface("MokuBridge"); web.destroy(); web = null; }
        super.onDestroy();
    }
}
