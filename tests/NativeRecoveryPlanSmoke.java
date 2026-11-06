package app.moku.anime;

/** Host-JVM test of the pure recovery decision logic (no Android/Media3 on the classpath). */
public class NativeRecoveryPlanSmoke {
    static void check(boolean v,String what){if(!v)throw new AssertionError(what);}
    public static void main(String[] args) throws Exception {
        // A verified folder copy is always complete.
        check(RecoveryPlan.effectiveStatus("downloading","downloading","folder",true).equals("completed"),"verified folder copy is complete");
        check(RecoveryPlan.isTerminal("downloading","downloading","folder",true),"verified folder copy is terminal");
        // Completed / failed / removing transfers are terminal.
        check(RecoveryPlan.isTerminal("completed","completed","private",false),"completed is terminal");
        check(RecoveryPlan.isTerminal("downloading","failed","private",false),"failed media state is terminal");
        check(RecoveryPlan.isTerminal("downloading","removing","private",false),"removing is terminal");
        // Paused (user) and stopped (smart Wi-Fi gate) downloads wait; never auto-resumed.
        check(RecoveryPlan.isTerminal("paused","","private",false),"paused is terminal");
        check(RecoveryPlan.isTerminal("downloading","stopped","private",false),"stopped media state is terminal");
        // Non-terminal phases must be re-driven.
        check(!RecoveryPlan.isTerminal("queued","","private",false),"queued is not terminal");
        check(!RecoveryPlan.isTerminal("resolving","","private",false),"resolving is not terminal");
        check(!RecoveryPlan.isTerminal("downloading","downloading","private",false),"active download is not terminal");
        // In-flight phases reset to queued on startup.
        check(RecoveryPlan.shouldResetDownload("resolving"),"resolving resets on startup");
        check(RecoveryPlan.shouldResetDownload("downloading"),"downloading resets on startup");
        check(!RecoveryPlan.shouldResetDownload("queued"),"queued is not reset");
        check(!RecoveryPlan.shouldResetDownload("completed"),"completed is not reset");
        // Requeue decisions.
        check(RecoveryPlan.shouldRequeueDownload("queued","","private",false),"queued download requeues");
        check(RecoveryPlan.shouldRequeueDownload("downloading","downloading","private",false),"active download requeues");
        check(!RecoveryPlan.shouldRequeueDownload("completed","completed","private",false),"completed does not requeue");
        check(!RecoveryPlan.shouldRequeueDownload("paused","","private",false),"paused does not requeue");
        // Export recovery.
        check(RecoveryPlan.isExportTerminal(""),"empty export status is terminal");
        check(RecoveryPlan.isExportTerminal("completed"),"completed export is terminal");
        check(RecoveryPlan.isExportTerminal("failed"),"failed export is terminal");
        check(!RecoveryPlan.isExportTerminal("queued"),"queued export is not terminal");
        check(!RecoveryPlan.isExportTerminal("exporting"),"exporting is not terminal");
        check(RecoveryPlan.shouldResetExport("exporting"),"exporting resets on startup");
        check(!RecoveryPlan.shouldResetExport("queued"),"queued export is not reset");
        check(RecoveryPlan.shouldRequeueExport("queued"),"queued export requeues");
        check(RecoveryPlan.shouldRequeueExport("exporting"),"exporting export requeues");
        check(!RecoveryPlan.shouldRequeueExport("completed"),"completed export does not requeue");
        // Cleanup rescheduling.
        check(RecoveryPlan.shouldRescheduleCleanup("verifying",""),"verifying reschedules cleanup");
        check(RecoveryPlan.shouldRescheduleCleanup("","pending"),"pending cleanup reschedules");
        check(RecoveryPlan.shouldRescheduleCleanup("","waiting"),"waiting cleanup reschedules");
        check(!RecoveryPlan.shouldRescheduleCleanup("completed",""),"completed export does not reschedule cleanup");
        System.out.println("RecoveryPlan smoke: all decisions verified");
    }
}
