package app.novelier.reader

import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

private const val READER_HARDWARE_BRIDGE = "NOVELIER_READER_HARDWARE"
private const val BRIDGE_READY_SCRIPT =
  "window.dispatchEvent(new CustomEvent('novelier:android-bridge-ready',{detail:{version:1}}));"
private const val PREVIOUS_READING_UNIT_SCRIPT =
  "window.dispatchEvent(new CustomEvent('novelier:hardware-reader-navigation',{detail:{version:1,source:'volume-up',direction:'backward',repeat:false}}));"
private const val NEXT_READING_UNIT_SCRIPT =
  "window.dispatchEvent(new CustomEvent('novelier:hardware-reader-navigation',{detail:{version:1,source:'volume-down',direction:'forward',repeat:false}}));"

@Keep
internal class ReaderHardwareBridge(private val activity: MainActivity) {
  @Volatile
  private var volumeCaptureEnabled = false

  @JavascriptInterface
  fun setVolumeCaptureEnabled(enabled: Boolean) {
    volumeCaptureEnabled = enabled
  }

  @JavascriptInterface
  fun getDisplayName(selection: String): String? {
    return try {
      val uri = Uri.parse(selection)
      if (uri.scheme != "content") return null
      activity.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME),
        null,
        null,
        null,
      )?.use { cursor ->
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
      }
    } catch (_: Exception) {
      null
    }
  }

  @JavascriptInterface
  fun getSystemInsets(): String = activity.safeAreaJson()

  @JavascriptInterface
  fun setDarkSystemBars(enabled: Boolean) {
    activity.runOnUiThread {
      activity.applyDarkSystemBars(enabled)
    }
  }

  fun shouldCaptureVolumeButtons(): Boolean = volumeCaptureEnabled
}

class MainActivity : TauriActivity() {
  private val readerHardwareBridge = ReaderHardwareBridge(this)
  private var readerWebView: WebView? = null
  private var activityResumed = false
  private val capturedVolumeKeys = mutableSetOf<Int>()
  @Volatile
  private var safeArea = JSONObject()
    .put("top", 0)
    .put("right", 0)
    .put("bottom", 0)
    .put("left", 0)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    readerWebView = webView
    webView.addJavascriptInterface(
      readerHardwareBridge,
      READER_HARDWARE_BRIDGE,
    )
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, windowInsets ->
      val systemInsets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout(),
      )
      val navigationInsets = windowInsets.getInsets(
        WindowInsetsCompat.Type.navigationBars(),
      )
      val stableNavigationInsets = windowInsets.getInsetsIgnoringVisibility(
        WindowInsetsCompat.Type.navigationBars(),
      )
      val tappableInsets = windowInsets.getInsets(
        WindowInsetsCompat.Type.tappableElement(),
      )
      val mandatoryGestureInsets = windowInsets.getInsets(
        WindowInsetsCompat.Type.mandatorySystemGestures(),
      )
      val density = resources.displayMetrics.density.coerceAtLeast(1f)
      safeArea = JSONObject()
        .put(
          "top",
          maxOf(
            systemInsets.top,
            navigationInsets.top,
            stableNavigationInsets.top,
          ) / density,
        )
        .put(
          "right",
          maxOf(
            systemInsets.right,
            navigationInsets.right,
            stableNavigationInsets.right,
            tappableInsets.right,
            mandatoryGestureInsets.right,
          ) / density,
        )
        .put(
          "bottom",
          maxOf(
            systemInsets.bottom,
            navigationInsets.bottom,
            stableNavigationInsets.bottom,
            tappableInsets.bottom,
            mandatoryGestureInsets.bottom,
          ) / density,
        )
        .put(
          "left",
          maxOf(
            systemInsets.left,
            navigationInsets.left,
            stableNavigationInsets.left,
            tappableInsets.left,
            mandatoryGestureInsets.left,
          ) / density,
        )
      dispatchSafeArea()
      windowInsets
    }
    webView.post {
      webView.evaluateJavascript(BRIDGE_READY_SCRIPT, null)
      ViewCompat.requestApplyInsets(webView)
    }
  }

  override fun onResume() {
    super.onResume()
    activityResumed = true
    readerWebView?.post {
      readerWebView?.evaluateJavascript(BRIDGE_READY_SCRIPT, null)
      readerWebView?.let(ViewCompat::requestApplyInsets)
      dispatchSafeArea()
    }
  }

  override fun onPause() {
    activityResumed = false
    capturedVolumeKeys.clear()
    super.onPause()
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val isVolumeButton =
      event.keyCode == KeyEvent.KEYCODE_VOLUME_UP ||
        event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN
    val wasCaptured = event.keyCode in capturedVolumeKeys
    val captureActive =
      activityResumed &&
        readerWebView != null &&
        readerHardwareBridge.shouldCaptureVolumeButtons()
    if (!isVolumeButton || (!captureActive && !wasCaptured)) {
      return super.dispatchKeyEvent(event)
    }

    // Consume the full key gesture while enabled, but emit only its first
    // ACTION_DOWN so a long press cannot skip many reading units.
    if (
      captureActive &&
      event.action == KeyEvent.ACTION_DOWN &&
      event.repeatCount == 0
    ) {
      capturedVolumeKeys.add(event.keyCode)
      val script =
        if (event.keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
          PREVIOUS_READING_UNIT_SCRIPT
        } else {
          NEXT_READING_UNIT_SCRIPT
        }
      readerWebView?.post {
        readerWebView?.evaluateJavascript(script, null)
      }
    }
    if (event.action == KeyEvent.ACTION_UP) {
      capturedVolumeKeys.remove(event.keyCode)
    }
    return true
  }

  internal fun safeAreaJson(): String = safeArea.toString()

  internal fun dispatchSafeArea() {
    val detail = safeAreaJson()
    readerWebView?.post {
      readerWebView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('novelier:android-safe-area',{detail:$detail}));",
        null,
      )
    }
  }

  @Suppress("DEPRECATION")
  internal fun applyDarkSystemBars(dark: Boolean) {
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = false
    }
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !dark
      isAppearanceLightNavigationBars = !dark
    }
  }

  override fun onDestroy() {
    readerHardwareBridge.setVolumeCaptureEnabled(false)
    capturedVolumeKeys.clear()
    readerWebView?.removeJavascriptInterface(READER_HARDWARE_BRIDGE)
    readerWebView = null
    super.onDestroy()
  }
}
