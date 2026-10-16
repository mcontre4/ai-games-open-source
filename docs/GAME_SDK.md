# GameSDK protocol 1

Use the maintained `GameSDK` imported from `./sdk` inside a Phaser scene:

```ts
const previous = await GameSDK.loadState();
await GameSDK.saveState({ level: 2, coins: 34, best: 120 });
await GameSDK.submitScore(120);
const player = await GameSDK.getPlayer();
const game = await GameSDK.getGameInfo();
```

These functions return promises with a 5-second timeout. The client sends `{protocol:1,id,type,...payload}` through the host's postMessage bridge. The host validates it and responds through `window.__gameSDKReceive({protocol:1,id,ok,value})` or `{protocol:1,id,ok:false,error}`. The host installs the Android bridge at document start. The game never receives credentials or a direct API URL. `getPlayer` exposes name only; `getGameInfo` exposes id/versionId/title only.

`saveState` accepts JSON only; 64 KiB, finite numbers, depth≤32 and no reserved prototype keys. `submitScore` accepts a nonnegative safe integer ≤1,000,000,000. Capability permission comes from the signed manifest; undeclared requests are denied. Malformed/oversized messages fail without executing a native operation. Correlation IDs are unique; a replay is rejected. Call rates are bounded. The host account/game scope cannot be overridden by fields in the request.

Save locally during play, on pause and game over, and load before applying progression. Native SQLite writes happen before cloud sync. Network failure does not block gameplay. Schema 1 is maintained across initial modification; incompatible future state must be migrated explicitly. Errors should show a recoverable host message and must not fabricate successful cloud sync.

`hostPause` and `hostMute` events let the trusted app pause on background/exit. A package handles these events without invoking privileged native APIs. Web tests install an explicitly labelled test host with the same application message handler; this is test infrastructure and is never the production AI generator.
