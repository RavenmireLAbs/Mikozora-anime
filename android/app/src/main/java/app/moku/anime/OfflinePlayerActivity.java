package app.moku.anime;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.FileDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Plays a verified saved-folder file or a completed private cache, without streaming. */
@OptIn(markerClass = UnstableApi.class)
public final class OfflinePlayerActivity extends Activity {
    private ExoPlayer player;private String id="";private boolean usingPrivate;
    private int dp(float v){return (int)(getResources().getDisplayMetrics().density*v+.5f);}
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.BLACK);getWindow().setNavigationBarColor(Color.BLACK);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        id=getIntent().getStringExtra("downloadId");
        if(id==null||!id.matches("[a-f0-9]{32}")){finish();return;}
        PrivateAccess.Session session=PrivateAccess.begin(this,id);usingPrivate=session.privateCopy;
        JSONObject meta=session.meta;Download download=OfflineStore.getDownload(this,id);
        boolean folder=meta!=null&&"folder".equals(meta.optString("storageMode"))&&meta.optBoolean("exportVerified",false);
        if(meta==null||(!folder&&(download==null||download.state!=Download.STATE_COMPLETED))) {
            Toast.makeText(this,"This episode has not finished downloading",Toast.LENGTH_LONG).show();finish();return;
        }
        try {
            List<MediaItem.SubtitleConfiguration> subtitles=new ArrayList<>();JSONArray tracks=meta.optJSONArray(folder?"exportTracks":"tracks");
            if(tracks!=null)for(int i=0;i<tracks.length();i++) {
                JSONObject t=tracks.optJSONObject(i);if(t==null)continue;Uri uri;
                if(folder) {
                    uri=Uri.parse(t.optString("uri"));if(!"content".equalsIgnoreCase(uri.getScheme()))continue;
                } else {
                    String name=t.optString("file");if(!name.matches("track-[0-9]+\\.(vtt|srt)"))continue;
                    File f=new File(OfflineStore.subtitleDir(this,id),name);if(!f.isFile())continue;uri=Uri.fromFile(f);
                }
                subtitles.add(new MediaItem.SubtitleConfiguration.Builder(uri)
                    .setMimeType(t.optString("mime","text/vtt")).setLanguage(t.optString("language","und"))
                    .setLabel(t.optString("label","Subtitles"))
                    .setSelectionFlags(t.optBoolean("preferred",false)?C.SELECTION_FLAG_DEFAULT:0).build());
            }
            MediaItem item;DataSource.Factory data;
            if(folder) {
                Uri uri=Uri.parse(meta.getString("exportUri"));if(!"content".equalsIgnoreCase(uri.getScheme()))throw new Exception("Invalid folder file");
                item=new MediaItem.Builder().setUri(uri).setMediaId(id).setSubtitleConfigurations(subtitles).build();
                // content:// and local files only; no HTTP fallback.
                data=new DefaultDataSource.Factory(this,new FileDataSource.Factory());
            } else {
                item=download.request.toMediaItem().buildUpon().setSubtitleConfigurations(subtitles).build();
                CacheDataSource.Factory cacheOnly=OfflineStore.cacheOnly(this,download.request);
                data=new DefaultDataSource.Factory(this,cacheOnly);
            }
            player=new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(data)).build();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setPreferredTextLanguage("indonesian".equals(meta.optString("language"))?"id":"en").build());
            player.addListener(new Player.Listener(){@Override public void onPlayerError(PlaybackException e){
                Toast.makeText(OfflinePlayerActivity.this,folder?"Could not play the saved folder file. Check that it still exists and Mikozora can access the folder.":"Offline playback failed. Check device format support, or remove and download this episode again.",Toast.LENGTH_LONG).show();
            }});
            FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);
            PlayerView view=new PlayerView(this);view.setPlayer(player);view.setShowSubtitleButton(true);
            view.setShowPreviousButton(false);view.setShowNextButton(false);view.setControllerShowTimeoutMs(5000);
            root.addView(view,new FrameLayout.LayoutParams(-1,-1));
            LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);header.setPadding(dp(9),dp(4),dp(12),dp(4));header.setBackgroundColor(0x99000000);
            TextView back=new TextView(this);back.setText("‹");back.setTextSize(35);back.setTextColor(Color.WHITE);back.setGravity(Gravity.CENTER);back.setContentDescription("Go back");
            header.addView(back,new LinearLayout.LayoutParams(dp(48),dp(46)));back.setOnClickListener(v->finish());
            TextView title=new TextView(this);JSONObject series=meta.optJSONObject("item"),ep=meta.optJSONObject("episode");
            title.setText((series==null?"Episode":series.optString("title"))+"  ·  EP "+(ep==null?"":ep.optString("number")));
            title.setTextColor(Color.WHITE);title.setTextSize(13);title.setMaxLines(1);header.addView(title,new LinearLayout.LayoutParams(0,-2,1));
            root.addView(header,new FrameLayout.LayoutParams(-1,dp(54),Gravity.TOP));setContentView(root);
            player.setMediaItem(item);
            long position=getPreferences(MODE_PRIVATE).getLong(id,0);if(position>0)player.seekTo(position);
            player.prepare();player.setPlayWhenReady(true);
        }catch(Exception e){Toast.makeText(this,"Could not open the offline player",Toast.LENGTH_LONG).show();finish();}
    }
    @Override protected void onPause(){
        if(player!=null){getPreferences(MODE_PRIVATE).edit().putLong(id,player.getCurrentPosition()).apply();player.pause();}
        super.onPause();
    }
    @Override protected void onDestroy(){
        if(player!=null){player.release();player=null;}
        if(usingPrivate){PrivateAccess.end(id);usingPrivate=false;try{FolderCleanupWorker.schedule(this,id);}catch(Exception ignored){}}
        super.onDestroy();
    }
}
