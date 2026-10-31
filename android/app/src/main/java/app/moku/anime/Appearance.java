package app.moku.anime;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.View;
import android.view.Window;

/** Separate, validated native copy of the WebView's appearance preference. */
final class Appearance {
    private static final String PREFS="moku_appearance_v1";
    private static final String MODE="mode", ACCENT="accent";
    private Appearance() {}

    static final class Palette {
        final boolean light;
        final String mode,accent;
        final int background,navigation,panel,border,text,muted,highlight;
        Palette(String mode,String accent,int background,int navigation,int panel,int border,int text,int muted,int highlight){
            this.mode=mode;this.accent=accent;this.light="light".equals(mode);this.background=background;
            this.navigation=navigation;this.panel=panel;this.border=border;this.text=text;this.muted=muted;this.highlight=highlight;
        }
    }
    static boolean validMode(String value){return "dark".equals(value)||"light".equals(value);}
    static boolean validAccent(String value){return "green".equals(value)||"blue".equals(value)||"purple".equals(value)||"pink".equals(value)||"amber".equals(value);}
    static Palette palette(String mode,String accent){
        if(!validMode(mode))mode="dark";
        if(!validAccent(accent))accent="green";
        final boolean light="light".equals(mode);
        int background=0xff101312,nav=0xff161c17,highlight=0xffc8ee99;
        int panel=0xff1d261e,border=0xff3a4a3c,text=0xffe9f1e5,muted=0xff97a895;
        switch(accent){
            case "blue": background=0xff101418;nav=0xff151c22;highlight=0xffa9dcff;panel=0xff1d232a;border=0xff3a4852;text=0xffe6eff5;muted=0xff9baab4;break;
            case "purple": background=0xff15131a;nav=0xff1d1923;highlight=0xffd8c2ff;panel=0xff241e2a;border=0xff473a52;text=0xffefe8f5;muted=0xffaa9fb5;break;
            case "pink": background=0xff191317;nav=0xff22191d;highlight=0xffffc1d4;panel=0xff2a1e24;border=0xff523a47;text=0xfff5e8ee;muted=0xffb5a0aa;break;
            case "amber": background=0xff191613;nav=0xff211d17;highlight=0xfff7d79b;panel=0xff2a261e;border=0xff514b3a;text=0xfff5efe5;muted=0xffb5ad9d;break;
        }
        if(light){
            switch(accent){
                case "blue":background=0xfff5f8fb;highlight=0xff216387;break;
                case "purple":background=0xfff8f6fb;highlight=0xff694a98;break;
                case "pink":background=0xfffcf6f8;highlight=0xff9d3d5d;break;
                case "amber":background=0xfffbf8f1;highlight=0xff805800;break;
                default:background=0xfff7f9f5;highlight=0xff476d2a;break;
            }
            return new Palette(mode,accent,background,nav,0xfff0f3ee,0xffc8d2c7,0xff1b281d,0xff4e6150,highlight);
        }
        // Default player colors match the original dark-green release.
        return new Palette(mode,accent,background,nav,panel,border,text,muted,highlight);
    }
    static Palette read(Context context){
        SharedPreferences p=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
        String mode="dark",accent="green";
        try{mode=p.getString(MODE,"dark");}catch(ClassCastException ignored){}
        try{accent=p.getString(ACCENT,"green");}catch(ClassCastException ignored){}
        return palette(mode,accent);
    }
    static boolean save(Context context,String mode,String accent){
        if(!validMode(mode)||!validAccent(accent))return false;
        context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(MODE,mode).putString(ACCENT,accent).apply();
        return true;
    }
    static boolean lightNavigation(Palette palette,int sdk){return palette.light&&sdk>=26;}
    static int navigationColor(Palette palette,int sdk){return lightNavigation(palette,sdk)?palette.background:palette.navigation;}
    static void applyWindow(Activity activity,Palette palette){
        Window window=activity.getWindow();
        window.setStatusBarColor(palette.background);
        // Dark navigation icons do not exist on API 23–25; keep their bar dark.
        boolean lightNavigation=lightNavigation(palette,Build.VERSION.SDK_INT);
        window.setNavigationBarColor(navigationColor(palette,Build.VERSION.SDK_INT));
        int flags=window.getDecorView().getSystemUiVisibility();
        flags&=~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if(palette.light)flags|=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if(lightNavigation)flags|=View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(flags);
    }
}
