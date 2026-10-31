package app.moku.anime;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.work.NetworkType;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** Test-only activity: copied into a throwaway APK, never the production manifest. */
public final class EpisodeWorkerDeviceTestActivity extends Activity {
    private static final String TAG="MokuEpisodeTest";
    private static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
    private static List<WorkInfo> infos(Context c,String name)throws Exception{return WorkManager.getInstance(c).getWorkInfosForUniqueWork(name).get(10,TimeUnit.SECONDS);}
    private static WorkInfo waitWork(Context c,String name,UUID exclude,long timeout)throws Exception {
        long end=System.currentTimeMillis()+timeout;
        while(System.currentTimeMillis()<end) {
            for(WorkInfo info:infos(c,name))if((exclude==null||!exclude.equals(info.getId()))&&info.getState().isFinished()){
                require(info.getState()==WorkInfo.State.SUCCEEDED,name+" finished "+info.getState());return info;
            }
            Thread.sleep(500);
        }
        throw new AssertionError("Timed out waiting for "+name+": "+infos(c,name));
    }
    private static void waitOpenChecks(Context c)throws Exception {
        long end=System.currentTimeMillis()+120000;
        while(System.currentTimeMillis()<end){List<WorkInfo> work=infos(c,EpisodeScheduler.OPEN);
            if(work.size()>=2){boolean done=true;for(WorkInfo info:work){if(info.getState()==WorkInfo.State.FAILED||info.getState()==WorkInfo.State.CANCELLED)throw new AssertionError("open check "+info.getState());if(!info.getState().isFinished())done=false;}if(done)return;}
            Thread.sleep(500);
        }
        throw new AssertionError("Timed out waiting for appended open checks: "+infos(c,EpisodeScheduler.OPEN));
    }
    private static WorkInfo waitPeriodic(Context c)throws Exception {
        long end=System.currentTimeMillis()+15000;
        while(System.currentTimeMillis()<end){List<WorkInfo> work=infos(c,EpisodeScheduler.PERIODIC);if(!work.isEmpty())return work.get(0);Thread.sleep(300);}
        throw new AssertionError("Periodic work not created");
    }
    private static Notification notification(Context c){
        NotificationManager n=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        for(StatusBarNotification e:n.getActiveNotifications())if(e.getId()==EpisodeNotifier.NOTIFICATION_ID)return e.getNotification();
        return null;
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);final Context c=getApplicationContext();finish();
        new Thread(()->{
            try {
                EpisodeStore.preferences(c).edit().clear().commit();
                String url="https://anikototv.to/watch/naruto-eybxz";
                JSONObject item=new JSONObject().put("source","anikoto").put("url",url).put("title","Naruto");
                JSONObject sync=EpisodeStore.sync(c,new JSONArray().put(item).put(item).toString());
                require(sync.getInt("watchedCount")==1,"duplicate collection snapshot");
                EpisodeStore.Title track=EpisodeStore.due(c,1).get(0);
                EpisodeFetcher.Episode baseline=new EpisodeFetcher.Episode("number:219","219","Episode 219",url+"/ep-219",219);
                require(EpisodeStore.success(c,track,Arrays.asList(baseline),System.currentTimeMillis()-60_000L)==0,"initial baseline must be silent");
                EpisodeNotifier.ensureChannel(c);require("allowed".equals(EpisodeNotifier.status(c)),"Android 8 notifications available");
                EpisodeScheduler.ensure(c);
                WorkInfo periodic=waitPeriodic(c);
                require(periodic.getState()==WorkInfo.State.ENQUEUED,"periodic work is enqueued");
                require(periodic.getPeriodicityInfo()!=null&&periodic.getPeriodicityInfo().getRepeatIntervalMillis()==6L*60*60*1000,"six-hour periodic interval");
                require(periodic.getConstraints().getRequiredNetworkType()==NetworkType.CONNECTED,"periodic check needs a network");
                Log.i(TAG,"PASS periodic job: six hours, connected network, activity finished");
                EpisodeScheduler.onOpen(c);EpisodeScheduler.onOpen(c);
                waitOpenChecks(c);
                JSONObject checked=EpisodeStore.state(c);
                require(checked.getJSONArray("errors").length()==0,"live Anikoto fetch failed: "+checked.getJSONArray("errors"));
                require(checked.getInt("unreadCount")==1,"one newly discovered episode: "+checked);
                JSONObject event=checked.getJSONArray("updates").getJSONObject(0);
                require("220".equals(event.getJSONObject("episode").getString("number")),"Naruto episode 220 detected");
                Notification n=notification(c);require(n!=null&&n.contentIntent!=null,"Android notification posted with an open-app intent");
                require(EpisodeNotifier.CHANNEL.equals(n.getChannelId()),"notification uses separate new-episodes channel");
                Log.i(TAG,"PASS background live source: 220 detected once; system notification and content intent posted");
                EpisodeStore.setAutomatic(c,false);EpisodeScheduler.ensure(c);
                EpisodeScheduler.manual(c);
                waitWork(c,EpisodeScheduler.MANUAL,null,120000);
                JSONObject repeated=EpisodeStore.state(c);
                require(repeated.getInt("unreadCount")==1&&repeated.getJSONArray("updates").length()==1,"manual while automatic off must not repeat update");
                EpisodeStore.setAlerts(c,false);EpisodeNotifier.refresh(c,false);require(notification(c)==null,"turning alerts off cancels notification");
                EpisodeStore.setAlerts(c,true);EpisodeNotifier.refresh(c,false);require(notification(c)!=null,"turning alerts on retains unread updates");
                EpisodeStore.markRead(c,"all",true);EpisodeNotifier.refresh(c,false);
                require(notification(c)==null&&EpisodeStore.state(c).getInt("unreadCount")==0,"read clears notification but retains update");
                Log.i(TAG,"PASS repeated check, manual with automatic off, independent alert setting and mark read");
                Log.i(TAG,"RESULT PASS all native background episode checks");
            }catch(Throwable e){Log.e(TAG,"RESULT FAIL "+e.getClass().getSimpleName()+": "+e.getMessage(),e);}
        },"episode-device-test").start();
    }
}
