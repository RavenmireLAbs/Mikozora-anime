package app.moku.anime;

/**
 * Pure, Android-free decision logic for resuming interrupted offline work after
 * the process is restarted. Keeping the decisions here lets the host-JVM smoke
 * tests verify recovery without Android, Media3, or WorkManager on the classpath.
 *
 * A download is "terminal" when it is finished (completed), failed, being removed,
 * or was paused by the user / smart network gate (stopped). Everything else —
 * queued, resolving, downloading — must be re-driven by a worker so the download
 * (and its later folder copy) continues after the app was closed or killed.
 */
final class RecoveryPlan {
    private RecoveryPlan() {}

    /**
     * Effective status of a download, mirroring what OfflineStore.list() reports.
     * A verified folder copy is always complete; otherwise the Media3 transfer
     * state wins over the stored status.
     */
    static String effectiveStatus(String storedStatus, String mediaState, String storageMode, boolean exportVerified) {
        if ("folder".equals(storageMode) && exportVerified) return "completed";
        if (mediaState != null && !mediaState.isEmpty()) return mediaState;
        return storedStatus == null ? "" : storedStatus;
    }

    /** True when a download should never be re-enqueued. */
    static boolean isTerminal(String storedStatus, String mediaState, String storageMode, boolean exportVerified) {
        if ("folder".equals(storageMode) && exportVerified) return true;
        if ("completed".equals(mediaState) || "failed".equals(mediaState) || "removing".equals(mediaState)) return true;
        if ("completed".equals(storedStatus) || "failed".equals(storedStatus)) return true;
        // Paused (user) or stopped (smart Wi-Fi gate) downloads wait for the user or a
        // metered connection; they are not resumed automatically.
        if ("paused".equals(storedStatus) || "stopped".equals(mediaState)) return true;
        return false;
    }

    /** True when the stored status represents an in-flight worker phase that must be reset to queued. */
    static boolean shouldResetDownload(String storedStatus) {
        return "resolving".equals(storedStatus) || "downloading".equals(storedStatus);
    }

    /** True when a download's worker must be (re)enqueued to continue the work. */
    static boolean shouldRequeueDownload(String storedStatus, String mediaState, String storageMode, boolean exportVerified) {
        return !isTerminal(storedStatus, mediaState, storageMode, exportVerified);
    }

    /** True when an export is finished, failed, or was never requested. */
    static boolean isExportTerminal(String exportStatus) {
        return exportStatus == null || exportStatus.isEmpty()
            || "completed".equals(exportStatus) || "failed".equals(exportStatus);
    }

    /** True when the stored export status represents an in-flight worker phase that must be reset to queued. */
    static boolean shouldResetExport(String exportStatus) {
        return "exporting".equals(exportStatus);
    }

    /** True when an export worker must be (re)enqueued. */
    static boolean shouldRequeueExport(String exportStatus) {
        return !isExportTerminal(exportStatus);
    }

    /** True when folder verification / cleanup must be (re)scheduled. */
    static boolean shouldRescheduleCleanup(String exportStatus, String cleanupStatus) {
        return "verifying".equals(exportStatus)
            || "pending".equals(cleanupStatus)
            || "waiting".equals(cleanupStatus);
    }
}
