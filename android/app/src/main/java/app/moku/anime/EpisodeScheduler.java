package app.moku.anime;

import android.content.Context;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

/** Persistent, network-constrained jobs. Android can defer them or stop them after force-stop. */
final class EpisodeScheduler {
    static final String PERIODIC="moku-episodes-periodic", OPEN="moku-episodes-on-open", MANUAL="moku-episodes-manual", AUTO_TAG="moku-episodes-automatic";
    private static final Constraints CONNECTED=new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    private EpisodeScheduler() {}
    static void ensure(Context c) throws Exception {
        WorkManager wm=WorkManager.getInstance(c);
        if(EpisodeStore.automatic(c)&&EpisodeStore.count(c)>0) {
            PeriodicWorkRequest work=new PeriodicWorkRequest.Builder(EpisodeWorker.class,6,TimeUnit.HOURS)
                .setConstraints(CONNECTED).setInitialDelay(6,TimeUnit.HOURS).addTag(AUTO_TAG).build();
            wm.enqueueUniquePeriodicWork(PERIODIC,ExistingPeriodicWorkPolicy.KEEP,work);
        } else {wm.cancelUniqueWork(PERIODIC);wm.cancelAllWorkByTag(AUTO_TAG);}
    }
    static void onOpen(Context c) throws Exception {queueAutomatic(c,System.currentTimeMillis()+1);}
    static void onNewTitles(Context c) throws Exception {queueAutomatic(c,0);}
    private static void queueAutomatic(Context c,long cutoff) throws Exception {
        ensure(c);
        if(!EpisodeStore.automatic(c)||EpisodeStore.count(c)==0)return;
        EpisodeStore.queued(c,false);
        // A collection can change while the previous open-check is running.
        // Queue a follow-up rather than dropping the new snapshot with KEEP.
        WorkManager.getInstance(c).enqueueUniqueWork(OPEN,ExistingWorkPolicy.APPEND_OR_REPLACE,request(false,cutoff,0));
    }
    static void manual(Context c) throws Exception {
        if(EpisodeStore.count(c)==0)throw new Exception("Add a title to Favourites or a collection first.");
        EpisodeStore.queued(c,true);
        WorkManager.getInstance(c).enqueueUniqueWork(MANUAL,ExistingWorkPolicy.KEEP,request(true,System.currentTimeMillis()+1,0));
    }
    static void continueBatch(Context c,boolean manual,long cutoff) throws Exception {
        if(!manual&&!EpisodeStore.automatic(c))return;
        EpisodeStore.queued(c,manual);
        WorkManager.getInstance(c).enqueue(request(manual,cutoff,5));
    }
    private static OneTimeWorkRequest request(boolean manual,long cutoff,long delaySeconds) {
        Data input=new Data.Builder().putBoolean("manual",manual).putLong("cutoff",cutoff).build();
        OneTimeWorkRequest.Builder b=new OneTimeWorkRequest.Builder(EpisodeWorker.class).setConstraints(CONNECTED).setInputData(input);
        if(delaySeconds>0)b.setInitialDelay(delaySeconds,TimeUnit.SECONDS);
        if(!manual)b.addTag(AUTO_TAG);
        return b.build();
    }
}
