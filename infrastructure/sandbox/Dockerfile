FROM node:22.21.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.162.1
WORKDIR /opt/deps
COPY infrastructure/sandbox/package.json infrastructure/sandbox/package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY packages/game-template /opt/starter
COPY infrastructure/sandbox/starter-scene.ts /opt/starter/src/Game.ts
COPY infrastructure/sandbox/starter-index.html /opt/starter/index.html
COPY infrastructure/sandbox/starter-style.css /opt/starter/src/style.css
COPY infrastructure/sandbox/starter-main.ts /opt/starter/src/main.ts
COPY infrastructure/sandbox/starter-game.json /opt/starter/public/game.json
RUN rm -rf /opt/starter/public/assets
RUN mkdir -p /opt/starter/public/assets
RUN rm -rf /opt/starter/node_modules /opt/starter/dist && cp /opt/deps/package.json /opt/starter/package.json && cp /opt/deps/package-lock.json /opt/starter/package-lock.json
RUN cp -r /opt/starter /opt/starter-3d
COPY infrastructure/sandbox/starter-three-main.ts /opt/starter-3d/src/main.ts
COPY infrastructure/sandbox/three-runtime.ts /opt/starter-3d/src/runtime.ts
COPY infrastructure/sandbox/starter-three-scene.ts /opt/starter-3d/src/Game.ts
COPY infrastructure/sandbox/relay.mjs /opt/relay.mjs
COPY infrastructure/sandbox/check-frozen.mjs /opt/check-frozen.mjs
COPY infrastructure/sandbox/export-files.mjs /opt/export-files.mjs
COPY infrastructure/sandbox/run-codex.mjs /opt/run-codex.mjs
COPY infrastructure/sandbox/codex-model.json /opt/codex-model.json
COPY infrastructure/sandbox/game-files.mjs /opt/game-files.mjs
COPY infrastructure/sandbox/checkpoint.mjs /opt/checkpoint.mjs
# Git checkouts created under a restrictive deployment umask may contain 0600
# files. COPY preserves those modes; the sandbox must read its root-owned tools
# and starters while retaining no write access to trusted /opt files.
RUN chmod -R a+rX /opt/starter /opt/starter-3d && chmod 0644 /opt/*.mjs /opt/codex-model.json
USER 1000:1000
WORKDIR /workspace
EXPOSE 4101
