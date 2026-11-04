package app.moku.anime;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
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
    private static final float[] SPEEDS={0.5f,0.75f,1f,1.25f,1.5f,2f};
    private ExoPlayer player;private String id="";private boolean usingPrivate;
    private int speedIndex=2;private Button speedButton;
    private int dp(float v){return (int)(getResources().getDisplayMetrics().density*v+.5f);}
    private void savePosition(){
        if(player!=null&&!id.isEmpty())getPreferences(MODE_PRIVATE).edit().putLong(id,player.getCurrentPosition()).apply();
    }
    private void seekBy(long deltaMs){
        if(player==null)return;
        long duration=player.getDuration();
        long target=Math.max(0,player.getCurrentPosition()+deltaMs);
        if(duration!=C.TIME_UNSET&&duration>0)target=Math.min(duration,target);
        player.seekTo(target);savePosition();
    }
    private void restart(){
        if(player==null)return;
        player.seekTo(0);player.setPlayWhenReady(true);savePosition();
    }
    private String speedLabel(float speed){
        String text=Float.toString(speed);
        if(text.endsWith(".0"))text=text.substring(0,text.length()-2);
        return text+"×";
    }
    private void cycleSpeed(){
        if(player==null)return;
        speedIndex=(speedIndex+1)%SPEEDS.length;
        float speed=SPEEDS[speedIndex];
        player.setPlaybackParameters(new PlaybackParameters(speed));
        if(speedButton!=null){
            speedButton.setText("Speed "+speedLabel(speed));
            speedButton.setContentDescription("Playback speed "+speedLabel(speed)+". Tap to change speed.");
        }
    }
    private Button toolButton(String text,String description){
        Button button=new Button(this);
        button.setText(text);button.setAllCaps(false);button.setTextColor(Color.WHITE);button.setTextSize(11);
        button.setContentDescription(description);button.setBackgroundColor(0x33ffffff);
        button.setPadding(dp(6),0,dp(6),0);button.setMinWidth(0);button.setMinimumWidth(0);
        return button;
    }
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
            String preferredText=meta.optString("preferredSubtitleLanguage","");
            if(tracks!=null)for(int i=0;i<tracks.length();i++) {
                JSONObject t=tracks.optJSONObject(i);if(t==null)continue;Uri uri;
                if(folder) {
                    uri=Uri.parse(t.optString("uri"));if(!"content".equalsIgnoreCase(uri.getScheme()))continue;
                } else {
                    String name=t.optString("file");if(!name.matches("track-[0-9]+\\.(vtt|srt)"))continue;
                    File f=new File(OfflineStore.subtitleDir(this,id),name);if(!f.isFile())continue;uri=Uri.fromFile(f);
                }
                if((preferredText.isEmpty()||"und".equals(preferredText))&&t.optBoolean("preferred",false))preferredText=t.optString("language","");
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
            player=new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(data))
                .setSeekBackIncrementMs(10000).setSeekForwardIncrementMs(10000).build();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);
            if(preferredText.isEmpty()||"und".equals(preferredText))preferredText="indonesian".equals(meta.optString("language"))?"id":"en";
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setPreferredTextLanguage(preferredText).build());
            player.addListener(new Player.Listener(){@Override public void onPlayerError(PlaybackException e){
                Toast.makeText(OfflinePlayerActivity.this,folder?"Could not play the saved folder file. Check that it still exists and Mikozora can access the folder.":"Offline playback failed. Check device format support, or remove and download this episode again.",Toast.LENGTH_LONG).show();
            }});
            FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);
            PlayerView view=new PlayerView(this);view.setPlayer(player);view.setShowSubtitleButton(true);
            view.setShowPreviousButton(false);view.setShowNextButton(false);
            view.setShowRewindButton(true);view.setShowFastForwardButton(true);view.setControllerShowTimeoutMs(5000);
            view.setFullscreenButtonClickListener(isFullscreen->{
                if(isFullscreen){
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
                }else{
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                    getWindow().getDecorView().setSystemUiVisibility(0);
                }
            });
            root.addView(view,new FrameLayout.LayoutParams(-1,-1));
            LinearLayout header=new LinearLayout(this);header.setOrientation(LinearLayout.VERTICAL);header.setPadding(dp(9),dp(4),dp(12),dp(8));header.setBackgroundColor(0x99000000);
            LinearLayout titleRow=new LinearLayout(this);titleRow.setGravity(Gravity.CENTER_VERTICAL);
            TextView back=new TextView(this);back.setText("‹");back.setTextSize(35);back.setTextColor(Color.WHITE);back.setGravity(Gravity.CENTER);back.setContentDescription("Go back");
            titleRow.addView(back,new LinearLayout.LayoutParams(dp(48),dp(46)));back.setOnClickListener(v->finish());
            TextView title=new TextView(this);JSONObject series=meta.optJSONObject("item"),ep=meta.optJSONObject("episode");
            title.setText((series==null?"Episode":series.optString("title"))+"  ·  EP "+(ep==null?"":ep.optString("number")));
            title.setTextColor(Color.WHITE);title.setTextSize(13);title.setMaxLines(1);titleRow.addView(title,new LinearLayout.LayoutParams(0,-2,1));
            header.addView(titleRow,new LinearLayout.LayoutParams(-1,dp(48)));
            LinearLayout tools=new LinearLayout(this);tools.setOrientation(LinearLayout.HORIZONTAL);tools.setGravity(Gravity.CENTER_VERTICAL);tools.setPadding(dp(48),dp(2),0,0);
            Button backTen=toolButton("−10s","Back 10 seconds");backTen.setOnClickListener(v->{seekBy(-10000);view.showController();});
            tools.addView(backTen,new LinearLayout.LayoutParams(0,dp(38),1));
            Button restartButton=toolButton("Restart","Restart from the beginning");restartButton.setOnClickListener(v->{restart();view.showController();});
            LinearLayout.LayoutParams restartParams=new LinearLayout.LayoutParams(0,dp(38),1);restartParams.leftMargin=dp(6);tools.addView(restartButton,restartParams);
            speedButton=toolButton("Speed 1×","Playback speed 1×. Tap to change speed.");speedButton.setOnClickListener(v->{cycleSpeed();view.showController();});
            LinearLayout.LayoutParams speedParams=new LinearLayout.LayoutParams(0,dp(38),1);speedParams.leftMargin=dp(6);tools.addView(speedButton,speedParams);
            Button forwardTen=toolButton("+10s","Forward 10 seconds");forwardTen.setOnClickListener(v->{seekBy(10000);view.showController();});
            LinearLayout.LayoutParams forwardParams=new LinearLayout.LayoutParams(0,dp(38),1);forwardParams.leftMargin=dp(6);tools.addView(forwardTen,forwardParams);
            header.addView(tools,new LinearLayout.LayoutParams(-1,dp(42)));
            // Keep Mikozora's title/tools bar in step with Media3's controller:
            // during playback both disappear after the same five-second timeout,
            // and tapping the video brings both back together.
            view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener)(visibility->header.setVisibility(visibility)));
            root.addView(header,new FrameLayout.LayoutParams(-1,dp(102),Gravity.TOP));setContentView(root);
            player.setMediaItem(item);
            long position=getPreferences(MODE_PRIVATE).getLong(id,0);if(position>0)player.seekTo(position);
            player.prepare();player.setPlayWhenReady(true);view.showController();
        }catch(Exception e){Toast.makeText(this,"Could not open the offline player",Toast.LENGTH_LONG).show();finish();}
    }
    @Override protected void onPause(){
        if(player!=null){savePosition();player.pause();}
        super.onPause();
    }
    @Override protected void onDestroy(){
        if(player!=null){player.release();player=null;}
        if(usingPrivate){PrivateAccess.end(id);usingPrivate=false;try{FolderCleanupWorker.schedule(this,id);}catch(Exception ignored){}}
        super.onDestroy();
    }
}
