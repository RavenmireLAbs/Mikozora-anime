package app.moku.anime;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;

/** Pure-Java structural tests: signed header fix, unchanged media, and both moov layouts. */
public final class Mp4CttsFixerSmoke {
    private static byte[] box(String name, byte[] data) throws Exception {
        ByteArrayOutputStream bytes=new ByteArrayOutputStream(); DataOutputStream out=new DataOutputStream(bytes);
        out.writeInt(data.length+8);out.writeBytes(name);out.write(data);return bytes.toByteArray();
    }
    private static byte[] concat(byte[]... parts) throws Exception {
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();for(byte[] p:parts)bytes.write(p);return bytes.toByteArray();
    }
    private static byte[] table(int header) throws Exception {
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(bytes);
        out.writeInt(header);out.writeInt(2);out.writeInt(1);out.writeInt(-9420);out.writeInt(2);out.writeInt(1832);
        return box("ctts",bytes.toByteArray());
    }
    private static byte[] tree(int header) throws Exception {
        return box("moov",box("trak",box("mdia",box("minf",box("stbl",table(header))))));
    }
    private static void check(boolean value,String message) { if(!value)throw new AssertionError(message); }
    private static void run(byte[] original, int expected) throws Exception {
        File file=File.createTempFile("moku-mp4-test-", ".mp4");try {
            Files.write(file.toPath(),original);int fixed=Mp4CttsFixer.fix(file);byte[] after=Files.readAllBytes(file.toPath());
            check(fixed==expected,"patch count");check(after.length==original.length,"file length changed");
            int differences=0;for(int i=0;i<after.length;i++)if(after[i]!=original[i])differences++;
            check(differences==2*expected,"unexpected changed bytes");
            check(Mp4CttsFixer.fix(file)==0,"patch must be idempotent");
            check(Arrays.equals(after,Files.readAllBytes(file.toPath())),"idempotence changed file");
        }finally{file.delete();}
    }
    public static void main(String[] args) throws Exception {
        byte[] ftyp=box("ftyp",new byte[]{1,2,3,4});byte[] mdat=box("mdat",new byte[]{8,7,6,5,4,3,2,1});
        byte[] free=box("free",new byte[20]);
        run(concat(ftyp,tree(1),free,mdat),1); // moov first, reserved free and later mdat
        run(concat(ftyp,mdat,tree(1)),1); // mdat first, moov at EOF
        run(concat(ftyp,tree(0x01000000),mdat),0); // already correct
        run(concat(ftyp,tree(0),mdat),0); // valid unsigned offsets
        File malformed=File.createTempFile("moku-bad-", ".mp4");try{
            byte[] bad=concat(ftyp,tree(1),mdat);bad[bad.length-16]=0x7f;Files.write(malformed.toPath(),bad);
            try{Mp4CttsFixer.fix(malformed);throw new AssertionError("malformed file accepted");}
            catch(java.io.IOException expected){check(Arrays.equals(bad,Files.readAllBytes(malformed.toPath())),"malformed file changed");}
        }finally{malformed.delete();}
        System.out.println("MP4 timing-header tests passed (front/EOF moov, unchanged offsets, malformed, idempotence)");
    }
}
