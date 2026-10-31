package app.moku.anime;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;

/** A separate channel from downloads, so either type can be controlled in Android settings. */
final class EpisodeNotifier {
    static final String CHANNEL="moku_new_episodes", EXTRA_OPEN="open_episode_updates";
    static final int NOTIFICATION_ID=89119;
    private EpisodeNotifier() {}
    static void ensureChannel(Context c) {
        if(Build.VERSION.SDK_INT>=26){
            NotificationManager n=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            if(n!=null)n.createNotificationChannel(new NotificationChannel(CHANNEL,"New episodes",NotificationManager.IMPORTANCE_DEFAULT));
        }
    }
    static String status(Context c) {
        if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(c,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return "permission";
        if(!NotificationManagerCompat.from(c).areNotificationsEnabled())return "blocked";
        if(Build.VERSION.SDK_INT>=26){
            NotificationManager n=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel=n==null?null:n.getNotificationChannel(CHANNEL);
            if(channel!=null&&channel.getImportance()==NotificationManager.IMPORTANCE_NONE)return "channel-blocked";
        }
        return "allowed";
    }
    static void refresh(Context c,boolean alert) {
        try {
            NotificationManagerCompat manager=NotificationManagerCompat.from(c);
            JSONObject state=EpisodeStore.state(c);int unread=state.optInt("unreadCount");
            if(unread==0||!state.optBoolean("alerts",true)){manager.cancel(NOTIFICATION_ID);return;}
            if(!"allowed".equals(status(c)))return;
            ensureChannel(c);
            JSONArray items=state.getJSONArray("updates");StringBuilder lines=new StringBuilder();int shown=0;
            for(int i=0;i<items.length()&&shown<3;i++) {
                JSONObject event=items.optJSONObject(i);if(event==null||event.optBoolean("read"))continue;
                JSONObject item=event.optJSONObject("item"),ep=event.optJSONObject("episode");
                if(item==null||ep==null)continue;
                if(lines.length()>0)lines.append('\n');
                String number=ep.optString("number");
                lines.append(item.optString("title","Your series")).append(" · ").append(number.isEmpty()?ep.optString("title","New episode"):"Episode "+number);shown++;
            }
            if(unread>shown)lines.append("\n+").append(unread-shown).append(" more");
            Intent intent=new Intent(c,MainActivity.class).putExtra(EXTRA_OPEN,true)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent open=PendingIntent.getActivity(c,89119,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder notification=new NotificationCompat.Builder(c,CHANNEL)
                .setSmallIcon(R.drawable.ic_episode_notification).setContentTitle(unread==1?"A new episode is here":unread+" new episodes")
                .setContentText(lines.toString().replace("\n"," · ")).setStyle(new NotificationCompat.BigTextStyle().bigText(lines.toString()))
                .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(!alert).setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setColor(0xffbfe88d);
            manager.notify(NOTIFICATION_ID,notification.build());
        }catch(Exception ignored){ /* Alerts are optional; the in-app updates remain saved. */ }
    }
}
