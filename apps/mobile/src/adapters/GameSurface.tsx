import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import WebView from 'react-native-webview';
import { requireNativeViewManager } from 'expo-modules-core';
interface Props {
  directory: string;
  response: string;
  command: string;
  onMessage: (raw: string) => void;
  onError: (error: string) => void;
  style?: StyleProp<ViewStyle>;
}
const AndroidView =
  Platform.OS === 'android'
    ? requireNativeViewManager<{
        directory: string;
        response: string;
        command: string;
        onMessage: (event: { nativeEvent: { data: string } }) => void;
        onError: (event: { nativeEvent: { message: string } }) => void;
        style?: StyleProp<ViewStyle>;
      }>('OfflineGame')
    : null;
export function GameSurface(p: Props) {
  const ref = React.useRef<WebView>(null);
  React.useEffect(() => {
    if (p.response)
      ref.current?.injectJavaScript(
        `window.__gameSDKReceive && window.__gameSDKReceive(${p.response});true;`,
      );
  }, [p.response]);
  React.useEffect(() => {
    if (p.command)
      ref.current?.injectJavaScript(
        `window.dispatchEvent(new Event(${JSON.stringify(p.command.startsWith('mute') ? 'hostMute' : 'hostPause')}));true;`,
      );
  }, [p.command]);
  if (AndroidView)
    return (
      <AndroidView
        directory={p.directory}
        response={p.response}
        command={p.command}
        onMessage={(e) => p.onMessage(e.nativeEvent.data)}
        onError={(e) => p.onError(e.nativeEvent.message)}
        style={p.style}
      />
    );
  const directory = p.directory.replace(/\/$/, '');
  const entry = `${directory}/index.html`;
  return (
    <WebView
      ref={ref}
      key={directory}
      source={{ uri: entry }}
      allowingReadAccessToURL={directory}
      originWhitelist={['file://*']}
      injectedJavaScriptBeforeContentLoaded={
        'window.addEventListener(\'error\',function(){window.ReactNativeWebView.postMessage(\'{"type":"host_runtime_error"}\')});window.addEventListener(\'unhandledrejection\',function(){window.ReactNativeWebView.postMessage(\'{"type":"host_runtime_error"}\')});true;'
      }
      javaScriptEnabled
      domStorageEnabled={false}
      incognito
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      mediaPlaybackRequiresUserAction
      onShouldStartLoadWithRequest={(request) =>
        request.url === entry || request.url === 'about:blank'
      }
      onMessage={(event) => p.onMessage(event.nativeEvent.data)}
      onError={() => p.onError('The local game could not be loaded.')}
      onContentProcessDidTerminate={() =>
        p.onError('The game stopped unexpectedly. Return to the library and reopen it.')
      }
      style={p.style}
    />
  );
}
