package app.moku.anime;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.work.ListenableWorker;
import androidx.work.WorkerParameters;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Background checks do not occupy either of the two existing download resolver threads. */
public final class EpisodeWorker extends ListenableWorker {
    private static final ExecutorService CHECKS=Executors.newSingleThreadExecutor();
    public EpisodeWorker(@NonNull Context context,@NonNull WorkerParameters params){super(context,params);}
    @NonNull @Override public ListenableFuture<Result> startWork() {
        return CallbackToFutureAdapter.getFuture(completer->{
            CHECKS.execute(()->{
                Result result;
                try{result=check();}catch(Exception e){result=Result.retry();}
                completer.set(result);
            });
            return "Mikozora episode check";
        });
    }
    private Result check() throws Exception {
        Context c=getApplicationContext();boolean manual=getInputData().getBoolean("manual",false);
        long cutoff=getInputData().getLong("cutoff",0);
        if(cutoff<=0)cutoff=System.currentTimeMillis()-EpisodeStore.INTERVAL_MS;
        if(isStopped()||(!manual&&!EpisodeStore.automatic(c)))return Result.success();
        String run=EpisodeStore.begin(c);boolean announced=false;
        try {
            int processed=0;long deadline=System.currentTimeMillis()+3*60_000L;
            while(!isStopped()&&processed<4&&System.currentTimeMillis()<deadline) {
                if(!manual&&!EpisodeStore.automatic(c))break;
                List<EpisodeStore.Title> due=EpisodeStore.due(c,cutoff);if(due.isEmpty())break;
                EpisodeStore.Title title=due.get(0);List<EpisodeFetcher.Episode> episodes;
                try{episodes=EpisodeFetcher.fetch(title.source,title.url,EpisodeFetcher.NETWORK);}
                catch(Exception problem) {
                    if(!isStopped())EpisodeStore.failure(c,title,problem.getMessage(),Math.max(System.currentTimeMillis(),cutoff));
                    processed++;continue;
                }
                if(isStopped()||(!manual&&!EpisodeStore.automatic(c)))break;
                int found=EpisodeStore.success(c,title,episodes,Math.max(System.currentTimeMillis(),cutoff));
                if(found>0){EpisodeNotifier.refresh(c,!announced);announced=true;}
                processed++;
            }
            if(!isStopped()&&(manual||EpisodeStore.automatic(c))&&!EpisodeStore.due(c,cutoff).isEmpty())EpisodeScheduler.continueBatch(c,manual,cutoff);
            return Result.success();
        } finally {EpisodeStore.finish(c,run);}
    }
}
