package com.aigames.offline
import android.content.Context
import android.net.Uri
import android.webkit.*
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.ScriptHandler
import java.security.MessageDigest
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import java.io.File
import java.io.ByteArrayInputStream
import org.json.JSONObject
class OfflineGameView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
 val onMessage by EventDispatcher()
 val onError by EventDispatcher()
 private val web = WebView(context)
 private var loader: WebViewAssetLoader? = null
 private var domain = "unloaded.aigames.invalid"
 private var directory = ""
 private var bridgeScript: ScriptHandler? = null
 private val allowed = setOf("html","js","css","json","png","jpg","jpeg","webp","woff2","mp3","ogg","wav")
 init {
  web.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  addView(web)
  web.setBackgroundColor(0xff070b19.toInt())
  web.settings.apply {
   javaScriptEnabled = true
   allowFileAccess = false
   allowContentAccess = false
   @Suppress("DEPRECATION")
   allowFileAccessFromFileURLs = false
   @Suppress("DEPRECATION")
   allowUniversalAccessFromFileURLs = false
   domStorageEnabled = false
   databaseEnabled = false
   mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
   mediaPlaybackRequiresUserGesture = true
   setSupportMultipleWindows(false)
  }
  CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
  web.addJavascriptInterface(object {
   @JavascriptInterface fun postMessage(raw: String) { if(raw.toByteArray().size <= 71680) post { onMessage(mapOf("data" to raw)) } }
  }, "GameHost")
  web.webChromeClient = object : WebChromeClient() {
   override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
   override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) { callback.invoke(origin, false, false) }
   override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean = false
  }
  web.webViewClient = object : WebViewClient() {
   override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.url.toString() != "https://$domain/game/index.html"
   override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
    val uri = request.url
    if(uri.scheme != "https" || uri.host != domain || request.method != "GET") return blocked()
    return loader?.shouldInterceptRequest(uri) ?: blocked()
   }

   override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) { if(request.isForMainFrame) onError(mapOf("message" to "Local game failed to load.")) }
  }
 }
 private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))
 fun loadDirectory(uri: String) {
  if(uri == directory) return
  val root = File(Uri.parse(uri).path ?: "").canonicalFile
  if(!root.path.startsWith(context.filesDir.canonicalPath + "/") || !root.path.contains("/games/") || !root.isDirectory) { onError(mapOf("message" to "Invalid game directory.")); return }
  directory = uri
  domain = "g-" + MessageDigest.getInstance("SHA-256").digest(root.path.toByteArray()).take(16).joinToString("") { "%02x".format(it) } + ".aigames.invalid"
  bridgeScript?.remove()
  if(!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) { onError(mapOf("message" to "Update Android System WebView to play downloaded games.")); return }
  bridgeScript = WebViewCompat.addDocumentStartJavaScript(web, "window.ReactNativeWebView={postMessage:function(s){GameHost.postMessage(s)}};window.addEventListener('error',function(){GameHost.postMessage('{\"type\":\"host_runtime_error\"}')});window.addEventListener('unhandledrejection',function(){GameHost.postMessage('{\"type\":\"host_runtime_error\"}')})", setOf("https://$domain"))
  loader = WebViewAssetLoader.Builder().setDomain(domain).addPathHandler("/game/", WebViewAssetLoader.PathHandler { path ->
   try {
    val file = File(root,path).canonicalFile
    if(!file.path.startsWith(root.path + "/") || !allowed.contains(file.extension) || !file.isFile) blocked()
    else WebResourceResponse(when(file.extension){"js"->"application/javascript";"css"->"text/css";"html"->"text/html";"json"->"application/json";"png"->"image/png";"webp"->"image/webp";"woff2"->"font/woff2";else->"application/octet-stream"}, "UTF-8", file.inputStream())
   } catch (_: Exception) { blocked() }
  }).build()
  web.clearCache(true)
  web.loadUrl("https://$domain/game/index.html")
 }
 fun reply(raw: String) { if(raw.isNotEmpty()) web.evaluateJavascript("window.__gameSDKReceive && window.__gameSDKReceive(JSON.parse(" + JSONObject.quote(raw) + "))", null) }
 fun command(value: String) { val event = when(value.substringBefore(":")){"pause"->"hostPause";"mute"->"hostMute";else->return}; web.evaluateJavascript("window.dispatchEvent(new Event('$event'))",null) }
 override fun onDetachedFromWindow() { web.stopLoading(); web.destroy(); super.onDetachedFromWindow() }
}
