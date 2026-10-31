package app.moku.anime;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.List;

/**
 * Corrects the ctts full-box header produced by Media3 1.4.1's Mp4Muxer.
 * That version writes integer 1 (version 0, flags 1), but its offsets are signed;
 * the MP4 definition requires version 1, flags 0. Android's extractor rejects
 * the incorrect flags. This changes only four bytes per affected box: no media
 * data, chunk offsets, timing entries, or box sizes are moved.
 */
final class Mp4CttsFixer {
    private static final long CTTS_WRONG_HEADER = 1L;
    private static final int CTTS_SIGNED_HEADER = 0x01000000;
    private Mp4CttsFixer() {}

    static int fix(File file) throws IOException {
        try (RandomAccessFile f = new RandomAccessFile(file, "rw")) {
            List<Long> patches = new ArrayList<>();
            boolean[] found = new boolean[2]; // moov, mdat
            scan(f, 0, f.length(), 0, patches, found);
            if (!found[0] || !found[1]) throw new IOException("The exported MP4 is incomplete");
            // Scan and validate the entire structure before changing any bytes.
            for (long position : patches) { f.seek(position); f.writeInt(CTTS_SIGNED_HEADER); }
            if (!patches.isEmpty()) f.getFD().sync();
            return patches.size();
        }
    }

    private static void scan(RandomAccessFile f, long start, long end, int depth,
                             List<Long> patches, boolean[] found) throws IOException {
        if (depth > 8) throw new IOException("Invalid MP4 nesting");
        long at = start;
        while (at < end) {
            if (end - at < 8) throw new IOException("Truncated MP4 box");
            f.seek(at);
            long size = unsignedInt(f.readInt());
            int type = f.readInt();
            int header = 8;
            if (size == 1) {
                if (end - at < 16) throw new IOException("Truncated extended MP4 box");
                size = f.readLong(); header = 16;
                if (size < 0) throw new IOException("MP4 box is too large");
            } else if (size == 0) {
                size = end - at;
            }
            if (size < header || size > end - at) throw new IOException("Invalid MP4 box size");
            long payload = at + header, boxEnd = at + size;
            if (depth == 0 && type == fourcc("moov")) {
                if (found[0]) throw new IOException("Multiple MP4 movie boxes");
                found[0] = true;
            }
            if (depth == 0 && type == fourcc("mdat")) found[1] = true;
            if (type == fourcc("ctts")) {
                if (size - header < 8) throw new IOException("Truncated MP4 timing table");
                f.seek(payload);
                long fullBox = unsignedInt(f.readInt());
                long entries = unsignedInt(f.readInt());
                if (entries > (size - header - 8) / 8 || 8 + entries * 8 != size - header)
                    throw new IOException("Invalid MP4 timing table");
                if (fullBox == CTTS_WRONG_HEADER) patches.add(payload);
                else if (fullBox != 0 && fullBox != unsignedInt(CTTS_SIGNED_HEADER))
                    throw new IOException("Unsupported MP4 timing table");
            } else if (isContainer(type)) {
                scan(f, payload, boxEnd, depth + 1, patches, found);
            }
            at = boxEnd;
        }
    }
    private static boolean isContainer(int type) {
        return type == fourcc("moov") || type == fourcc("trak") || type == fourcc("mdia")
            || type == fourcc("minf") || type == fourcc("stbl");
    }
    private static long unsignedInt(int value) { return ((long) value) & 0xffffffffL; }
    private static int fourcc(String s) {
        return (s.charAt(0) << 24) | (s.charAt(1) << 16) | (s.charAt(2) << 8) | s.charAt(3);
    }
}
