# Game package format v1

A ZIP contains `index.html`, a fully bundled `game.js`, local assets and `manifest.json`. No npm install, CDN, runtime dependency download or externally hosted game URL is needed. Allowed file extensions: html, js, css, json, png, jpg, jpeg, webp, woff2, mp3, ogg, wav. SVG and executable/native archives are rejected.

Manifest fields: `schemaVersion:1`, gameId, versionId, title, description, `entryPoint:"index.html"`, orientation portrait/landscape, supportedPlatforms ios/android, optional view (2d/3d/isometric), engineVersion, packageSize (sum of asset bytes), assets [{path,bytes,sha256}], capabilities [state,score,player,gameInfo], minimumPlayerVersion, stateSchemaVersion, signature. Zod rejects unknown fields and invalid IDs/capabilities/platforms.

Signature is Ed25519 over UTF-8 canonical JSON of all manifest fields except signature. Canonicalization recursively sorts object keys with the specified `en` comparator and preserves array order; no whitespace. The 64-byte signature is hexadecimal. Public key is 32-byte raw hexadecimal pinned by the host. SHA-256 is hexadecimal. Server version records also hold the SHA-256 of the complete ZIP, including the manifest.

Limits: compressed ZIP and total expansion ≤30 MiB, each file ≤10 MiB, ≤256 assets plus manifest, paths ≤180 characters, no empty/dot/dot-dot components, ASCII permitted path alphabet. Expansion ratio >200 for entries larger than 1 MiB is rejected. ZIP64, multi-disk, encryption, symlink entries, overlapping records and unsupported compression are rejected. Every ZIP file must be listed/hash-matched except the signed manifest. Assets cannot substitute identities or exceed the supported host version.

The trusted packager injects a fixed CSP: default none; script self; style self/inline; image self/data; media/font self; connect/worker/frame/object none; base/form none. Installation verifies this policy and required entry/bundle. Inline scripts are not allowed. The mobile installer uses staging, space checks, signature and all-file checks before making the new version visible. Old installed versions remain available on disk; current storage accounting tracks the selected installed version, so accumulated older versions need maintenance.

Source ZIPs are server-only modification inputs and are never installed as native packages. The adapter admits only `src/Game.ts`, `public/game.json`, and tightly named raster files under `public/assets`, freezing SDK/boot/dependencies. User-created version history is immutable and previous versions can be selected in game details.

Engine/view pairs are Phaser `3.90.0` for 2D and Three.js `0.180.0` for 3D/isometric. The verifier rejects mismatched pairs. Legacy manifests omit view and remain verifiable as 2D without injecting fields into signed content. See [GAME_VIEWS.md](GAME_VIEWS.md) for runtime and platform requirements.
