package app.moku.anime;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import java.util.Arrays;

/** Test-only activity, built with a separate application ID. Never ship this APK. */
public final class AppearanceDeviceTestActivity extends Activity {
    private static final String TAG="MokuAppearanceTest";
    private static void require(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    private static double channel(int value){double v=value/255.;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}
    private static double luminance(int color){return .2126*channel((color>>16)&255)+.7152*channel((color>>8)&255)+.0722*channel(color&255);}
    private static double contrast(int a,int b){double x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        try {
            Context c=getApplicationContext();
            if("verify".equals(getIntent().getStringExtra("phase"))){
                Appearance.Palette p=Appearance.read(c);
                require("light".equals(p.mode)&&"pink".equals(p.accent),"preference persists after process restart");
                Appearance.applyWindow(this,p);
                require(getWindow().getStatusBarColor()==p.background,"saved status bar on restart");
                require(getWindow().getNavigationBarColor()==Appearance.navigationColor(p,Build.VERSION.SDK_INT),"saved navigation bar on restart");
                Log.i(TAG,"RESULT PASS restart persisted light pink and restored system bars");finish();return;
            }
            c.getSharedPreferences("moku_appearance_v1",MODE_PRIVATE).edit().clear().commit();
            Appearance.Palette original=Appearance.read(c);
            require("dark".equals(original.mode)&&"green".equals(original.accent)&&original.background==0xff101312,"default dark green");
            require(!Appearance.save(c,"system","green")&&!Appearance.save(c,"light","bad")&&!Appearance.save(c,null,"blue"),"invalid bridge inputs rejected");
            require("dark".equals(Appearance.read(c).mode),"invalid save did not mutate stored choice");
            String[] modes={"dark","light"},accents={"green","blue","purple","pink","amber"};
            int[] dark={0xff101312,0xff101418,0xff15131a,0xff191317,0xff191613};
            int[] light={0xfff7f9f5,0xfff5f8fb,0xfff8f6fb,0xfffcf6f8,0xfffbf8f1};
            for(String mode:modes)for(int i=0;i<accents.length;i++){
                String accent=accents[i];require(Appearance.save(c,mode,accent),"valid save "+mode+"/"+accent);
                Appearance.Palette p=Appearance.read(c);
                require(mode.equals(p.mode)&&accent.equals(p.accent),"saved combination "+mode+"/"+accent);
                require(p.background==("light".equals(mode)?light[i]:dark[i]),"native matches web background "+accent);
                require(contrast(p.text,p.background)>=4.5,"native title contrast "+mode+"/"+accent);
                require(contrast(p.text,p.panel)>=4.5,"native control contrast "+mode+"/"+accent);
                require(contrast(p.muted,p.background)>=4.5,"native secondary text contrast "+mode+"/"+accent);
                require(contrast(p.highlight,p.panel)>=4.5,"native accent contrast "+mode+"/"+accent);
                for(int api=23;api<=25;api++){
                    require(!Appearance.lightNavigation(p,api),"old Android must not request unsupported dark nav icons");
                    require(Appearance.navigationColor(p,api)==p.navigation,"old Android keeps dark nav background");
                }
                require(Appearance.lightNavigation(p,26)==p.light,"Android 8 light navigation flag");
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
                Appearance.applyWindow(this,p);
                int flags=getWindow().getDecorView().getSystemUiVisibility();
                require((flags&View.SYSTEM_UI_FLAG_LAYOUT_STABLE)!=0,"unrelated window flags survive");
                require(((flags&View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR)!=0)==p.light,"status icon flag "+mode+"/"+accent);
                require(((flags&View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)!=0)==Appearance.lightNavigation(p,Build.VERSION.SDK_INT),"navigation icon flag "+mode+"/"+accent);
                require(getWindow().getStatusBarColor()==p.background,"status bar color "+mode+"/"+accent);
                require(getWindow().getNavigationBarColor()==Appearance.navigationColor(p,Build.VERSION.SDK_INT),"navigation bar color "+mode+"/"+accent);
            }
            c.getSharedPreferences("moku_appearance_v1",MODE_PRIVATE).edit().putInt("mode",7).putInt("accent",9).commit();
            require("dark".equals(Appearance.read(c).mode)&&"green".equals(Appearance.read(c).accent),"wrong preference types fall back safely");
            require(Appearance.save(c,"light","pink"),"final persistent selection");
            Log.i(TAG,"RESULT PASS 10 palettes, contrast, validation and API 23-25/26 system bars");
        }catch(Throwable error){Log.e(TAG,"RESULT FAIL "+error.getMessage(),error);}
        finish();
    }
}
