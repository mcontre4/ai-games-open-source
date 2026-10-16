# Game views and engines

Create offers illustrated 2D, 3D and Isometric choices. `view` is independent of screen orientation and visual art style. Suggestions follow the selected view. The example art illustrates a camera style; it is not promised output or a substitute for generation.

| View        | Pinned engine    | Camera / gameplay                                     |
| ----------- | ---------------- | ----------------------------------------------------- |
| `2d`        | Phaser 3.90.0    | Flat sprites and canvas scenes                        |
| `3d`        | Three.js 0.180.0 | Real meshes, lighting and a perspective camera        |
| `isometric` | Three.js 0.180.0 | Real meshes with a fixed diagonal orthographic camera |

Three.js fits the existing TypeScript build and signed offline WebView package pipeline. Unity would require a separate editor/build toolchain and export format. Three.js provides rendering; generated gameplay supplies controls, collisions, scoring and progression. This implementation targets compact mobile games with bounded mesh counts and simple materials, not arbitrary Unity projects or imported asset pipelines.

`POST /games` accepts `{prompt, orientation, view}`; omitted view defaults to `2d`. Apply `202610110003_game_views.sql` before starting the updated API/worker. Postgres backfills existing games to 2D. Modify inherits the original game's view and orientation; switching engines requires a new game. The worker passes the saved view to art direction, image generation, coding and the sandbox factory.

The trusted sandbox selects a Phaser or Three.js starter. Its protected 3D runtime owns texture loading, WebGLRenderer, camera creation, viewport resizing, pixel ratio (at most 1.5), frame timing (delta capped at 50ms), visibility events, context-loss messaging and teardown. The coding agent can read `src/runtime.ts` but can only write `src/Game.ts` and `public/game.json`. A 3D GameScene implements `start`, `update(deltaSeconds)` and `dispose`, receiving scene/camera/artwork/renderer and an abort signal for listeners. Isometric gameplay retains the fixed orthographic camera. Mesh/material cleanup and play/pause/resume/restart/scoring/saves are part of the agent contract.

Software renderers such as SwiftShader and llvmpipe use a 0.5 pixel ratio while keeping the full CSS viewport and camera framing. Hardware renderers retain the 1.5 cap. The renderer does not preserve the drawing buffer between frames. This keeps CPU-only publication validation practical without weakening the 45 FPS average / 50ms p95 performance floor; failures report measured cadence. It does not establish physical-device performance.

Three.js and its dependencies are frozen in the sandbox lockfile. The generated source import allowlist permits only `three`, `./sdk` and the type/runtime contract `./runtime` for 3D. Remote loaders, add-on imports, dynamic imports, credentials, payments and native APIs remain unavailable. Assets are local raster files; generated meshes use built-in geometry. Packages retain the same ZIP/signature/size/CSP constraints and GameSDK bridge.

New manifests sign `view` and the matching `engineVersion`. Existing signed manifests without `view` remain byte-for-byte verifiable and mean 2D; no default is inserted before signature verification. Three.js bundles do not load from a CDN and do not require network access after installation. The signer embeds background artwork as a data image in the signed HTML so WebGL can upload an origin-clean texture on file URLs. This retains the existing CSP and scoped native file permissions; both file-origin camera modes are browser-tested with networking disabled. Embedded bytes still count toward package/file limits.

3D requires WebGL 2. Unsupported devices get a clear startup error; context loss pauses and asks the player to reopen. Native iOS/Android compatibility, actual device frame rate, thermal behavior and paid live 3D generation still need separate verification. Browser fixtures do not establish those results.

The original selector PNGs are in `apps/mobile/assets/game-views`, with built-in `image_gen` prompts recorded in `generation.json`. Deterministic playable 3D test sources are under `tests/fixtures`; production starters deliberately cannot pass unchanged generation validation. Browser tests verify signed offline WebGL gameplay, collision-derived scores, saves/reload, touch/keyboard input, pause/restart and both orientations. Docker tests exercise the production frozen runtime, source restore, rendering validation and protection against runtime edits.
