# Project-specific R8 rules. Capacitor's own rules come from the capacitor-android library.

# window.VisteAndroid — methods are called by name from the web app.
-keep class school.viste.sms.VisteAndroidBridge {
    @android.webkit.JavascriptInterface public <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Readable stack traces in crash reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
