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
    static boolean validAccent(String value){return "green".equals(value)||"blue".equals(value)||"purple".equals(value)||"pink".equals(value)||"amber".equals(value)||"midnight-sakura".equals(value)||"ocean-deep".equals(value)||"lavender-mist".equals(value)||"crimson".equals(value)||"sunset".equals(value)||"mint".equals(value)||"teal".equals(value)||"copper".equals(value)||"ruby".equals(value)||"sapphire".equals(value)||"orchid".equals(value)||"arctic".equals(value)||"rose-gold".equals(value)||"monochrome".equals(value)||"citron".equals(value);}
    private static Palette extraLightPalette(String mode,String accent,int background,int navigation,int highlight){
        return new Palette(mode,accent,background,navigation,0xfffdfdfd,0xffe1e2e7,0xff292b34,0xff626570,highlight);
    }
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
            case "midnight-sakura": background=0xff11131b;nav=0xff151722;highlight=0xffe98bb5;panel=0xff1b1d29;border=0xff343748;text=0xfff3f0f7;muted=0xffa7a4b5;break;
            case "ocean-deep": background=0xff10171b;nav=0xff152127;highlight=0xff7ddce8;panel=0xff1b2228;border=0xff34434a;text=0xffeaf3f5;muted=0xffa1b2b8;break;
            case "lavender-mist": background=0xff17131d;nav=0xff211b28;highlight=0xffd7b8ff;panel=0xff211b2a;border=0xff40344f;text=0xfff0eaf7;muted=0xffb1a5be;break;
            case "crimson": background=0xff191214;nav=0xff231719;highlight=0xffff9ca8;panel=0xff26181b;border=0xff4d3339;text=0xfff7ebed;muted=0xffbba5aa;break;
            case "sunset": background=0xff1a1412;nav=0xff241b17;highlight=0xffffb28a;panel=0xff281d18;border=0xff4c382d;text=0xfff8eee8;muted=0xffb9a89b;break;
            case "mint": background=0xff101713;nav=0xff16221a;highlight=0xff9be9c5;panel=0xff18231d;border=0xff34483b;text=0xffeaf5ee;muted=0xffa6b9ac;break;
            case "teal": background=0xff101716;nav=0xff152320;highlight=0xff80e1d2;panel=0xff172421;border=0xff304743;text=0xffe6f3f0;muted=0xffa1b8b3;break;
            case "copper": background=0xff191510;nav=0xff211b15;highlight=0xffefb16f;panel=0xff251e15;border=0xff493a29;text=0xfff4eee2;muted=0xffb9aa91;break;
            case "ruby": background=0xff191219;nav=0xff231720;highlight=0xffff86ab;panel=0xff251720;border=0xff493143;text=0xfff6eaf0;muted=0xffbaa5b0;break;
            case "sapphire": background=0xff11141b;nav=0xff171b25;highlight=0xff9db9ff;panel=0xff1a2030;border=0xff34405b;text=0xffeaf0ff;muted=0xffa5b3d1;break;
            case "orchid": background=0xff191319;nav=0xff231821;highlight=0xfff0a8e8;panel=0xff251a27;border=0xff4a3450;text=0xfff7eaf6;muted=0xffbaa3b8;break;
            case "arctic": background=0xff11171b;nav=0xff182127;highlight=0xffb5e6ff;panel=0xff19232b;border=0xff344852;text=0xffeef5f8;muted=0xffa7b9c1;break;
            case "rose-gold": background=0xff191513;nav=0xff231a16;highlight=0xfff0c0a4;panel=0xff261e1a;border=0xff49382f;text=0xfff7eee9;muted=0xffbda99e;break;
            case "monochrome": background=0xff121318;nav=0xff191a20;highlight=0xffeceef3;panel=0xff1a1b20;border=0xff383a43;text=0xfff0f0f3;muted=0xffaaacb5;break;
            case "citron": background=0xff15170f;nav=0xff1d2015;highlight=0xffddf38a;panel=0xff202318;border=0xff414632;text=0xfff0f2e6;muted=0xffb3b79e;break;
        }
        if(light){
            switch(accent){
                case "blue":background=0xfff5f8fb;highlight=0xff216387;break;
                case "purple":background=0xfff8f6fb;highlight=0xff694a98;break;
                case "pink":background=0xfffcf6f8;highlight=0xff9d3d5d;break;
                case "amber":background=0xfffbf8f1;highlight=0xff805800;break;
                case "midnight-sakura":background=0xfff7f4f1;highlight=0xffb44b78;return new Palette(mode,accent,background,nav,0xffffffff,0xffe2dce2,0xff302934,0xff625d6a,highlight);
                case "ocean-deep":background=0xfff1f8f8;highlight=0xff166b78;return extraLightPalette(mode,accent,background,nav,highlight);
                case "lavender-mist":background=0xfff8f5fc;highlight=0xff6940a2;return extraLightPalette(mode,accent,background,nav,highlight);
                case "crimson":background=0xfffcf5f5;highlight=0xffa4263b;return extraLightPalette(mode,accent,background,nav,highlight);
                case "sunset":background=0xfffbf5f0;highlight=0xff9e461d;return extraLightPalette(mode,accent,background,nav,highlight);
                case "mint":background=0xfff2f8f4;highlight=0xff1e7352;return extraLightPalette(mode,accent,background,nav,highlight);
                case "teal":background=0xfff1f8f6;highlight=0xff176f64;return extraLightPalette(mode,accent,background,nav,highlight);
                case "copper":background=0xfffaf6ef;highlight=0xff80501b;return extraLightPalette(mode,accent,background,nav,highlight);
                case "ruby":background=0xfffcf4f8;highlight=0xff9a2055;return extraLightPalette(mode,accent,background,nav,highlight);
                case "sapphire":background=0xfff4f6fc;highlight=0xff3657a2;return extraLightPalette(mode,accent,background,nav,highlight);
                case "orchid":background=0xfffcf5fb;highlight=0xff8e3287;return extraLightPalette(mode,accent,background,nav,highlight);
                case "arctic":background=0xfff2f8fa;highlight=0xff3e6b87;return extraLightPalette(mode,accent,background,nav,highlight);
                case "rose-gold":background=0xfffbf6f3;highlight=0xff87503b;return extraLightPalette(mode,accent,background,nav,highlight);
                case "monochrome":background=0xfff5f5f6;highlight=0xff4c505c;return extraLightPalette(mode,accent,background,nav,highlight);
                case "citron":background=0xfff7f8ef;highlight=0xff596a18;return extraLightPalette(mode,accent,background,nav,highlight);
                default:background=0xfff7f9f5;highlight=0xff476d2a;break;
            }
            return new Palette(mode,accent,background,nav,0xfff0f3ee,0xffc8d2c7,0xff1b281d,0xff4e6150,highlight);
        }
        // Default player colors match the original dark-green release.
        return new Palette(mode,accent,background,nav,panel,border,text,muted,highlight);
    }
    static Palette read(Context context){
        SharedPreferences p=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
        String mode="light",accent="green";
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
