# AI Games

Use Serena for existing code navigation where suitable. Follow the user-specified Node/TypeScript/Expo stack.

Dependency direction: presentation → application → domain. Ports are owned by application. Adapters implement ports. Domain imports no infrastructure or UI. One public execute method per use case. Inject time, identity, repositories and external services. Never pass credentials to game packages or agent sandboxes.

Run pnpm typecheck, pnpm lint, pnpm test, pnpm test:integration and pnpm test:e2e before reporting. Native verification and live generation must be reported as blocked when unavailable, never passed by substitution. Keep deterministic fixtures visibly separate from live AI generation.
