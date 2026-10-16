import { z } from 'zod';
import type { Json } from '../../domain/src/index.ts';
import { gameViews, generationSpeeds } from '../../domain/src/index.ts';
import { avatarIds } from '../../domain/src/profile.ts';
export const profileUpdateSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{4,25}$/),
    displayName: z.string().trim().min(1).max(40),
    bio: z.string().trim().max(280),
    avatarId: z.enum(avatarIds),
    profileVisible: z.boolean(),
    autoSync: z.boolean(),
    leaderboardVisible: z.boolean(),
  })
  .strict();
const artColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const gameDesignSchema = z
  .object({
    premise: z.string().min(12).max(500),
    coreLoop: z.string().min(12).max(700),
    goal: z.string().min(12).max(500),
    decisions: z.string().min(12).max(700),
    progression: z.string().min(12).max(700),
    feedback: z.string().min(12).max(500),
    replay: z.string().min(12).max(500),
  })
  .strict();
export const gameSpritePlanSchema = z
  .object({
    player: z.string().min(12).max(450),
    threat: z.string().min(12).max(450).nullable(),
    reward: z.string().min(12).max(450).nullable(),
    prop: z.string().min(12).max(450).nullable(),
  })
  .strict();
export const gamePresentationSchema = z
  .object({
    composition: z.string().min(20).max(900),
    camera: z.string().min(12).max(500),
    hierarchy: z.string().min(20).max(700),
    motion: z
      .object({
        idle: z.string().min(12).max(400),
        movement: z.string().min(12).max(400),
        action: z.string().min(12).max(400),
        success: z.string().min(12).max(400),
        failure: z.string().min(12).max(400),
      })
      .strict(),
    acceptance: z.array(z.string().min(12).max(300)).min(3).max(6),
  })
  .strict();
export const artDirectionSchema = z
  .object({
    theme: z.string().min(3).max(200),
    visualStyle: z.string().min(12).max(1000),
    animationStyle: z.string().min(12).max(1000),
    imagePrompt: z.string().min(20).max(2500),
    gameplay: gameDesignSchema.optional(),
    sprites: gameSpritePlanSchema.optional(),
    presentation: gamePresentationSchema.optional(),
    quality: z.enum(['premium', 'intentional-low-fi']),
    pixelArt: z.boolean(),
    typography: z.enum(['rounded', 'serif', 'sans', 'mono']),
    cornerRadius: z.number().int().min(0).max(32),
    palette: z
      .object({
        background: artColor,
        surface: artColor,
        text: artColor,
        muted: artColor,
        accent: artColor,
        onAccent: artColor,
      })
      .strict(),
  })
  .strict();
export const idSchema = z.string().regex(/^[a-z]+_[a-zA-Z0-9_-]{4,80}$/);
export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);
export const gameViewSchema = z.enum(gameViews);
export const createGameSchema = z
  .object({
    prompt: z.string().min(12).max(4000),
    orientation: z.enum(['portrait', 'landscape']).default('portrait'),
    view: gameViewSchema.default('2d'),
    speed: z.enum(generationSpeeds).default('regular'),
  })
  .strict();
export const modifyGameSchema = z
  .object({
    prompt: z.string().min(12).max(4000),
    speed: z.enum(generationSpeeds).default('regular'),
  })
  .strict();
export const saveSchema = z
  .object({
    versionId: idSchema,
    schemaVersion: z.number().int().min(1).max(100),
    baseRevision: z.number().int().min(0),
    state: jsonSchema,
  })
  .strict();
export const scoreSchema = z
  .object({ versionId: idSchema, score: z.number().int().min(0).max(1_000_000_000) })
  .strict();
export const reportSchema = z
  .object({
    reason: z.enum(['unsafe', 'copyright', 'broken', 'other']),
    detail: z.string().min(3).max(2000),
  })
  .strict();
export const capabilitySchema = z.enum(['state', 'score', 'player', 'gameInfo']);
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    gameId: idSchema,
    versionId: idSchema,
    title: z.string().min(1).max(100),
    description: z.string().max(1000),
    entryPoint: z.literal('index.html'),
    orientation: z.enum(['portrait', 'landscape']),
    supportedPlatforms: z.tuple([z.literal('ios'), z.literal('android')]),
    view: gameViewSchema.optional(),
    engineVersion: z.enum(['3.90.0', '0.180.0']),
    packageSize: z
      .number()
      .int()
      .positive()
      .max(30 * 1024 * 1024),
    assets: z
      .array(
        z
          .object({
            path: z.string().min(1).max(180),
            bytes: z
              .number()
              .int()
              .min(0)
              .max(10 * 1024 * 1024),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      )
      .min(2)
      .max(256),
    capabilities: z.array(capabilitySchema).max(4),
    minimumPlayerVersion: z.literal(1),
    stateSchemaVersion: z.number().int().min(1).max(100),
    signature: z.string().regex(/^[0-9a-f]{128}$/),
  })
  .strict()
  .refine((m) => m.engineVersion === ((m.view ?? '2d') === '2d' ? '3.90.0' : '0.180.0'), {
    message: 'Engine does not match game view.',
  });
export type Manifest = z.infer<typeof manifestSchema>;
const base = { protocol: z.literal(1), id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) };
export const bridgeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('loadState') }).strict(),
  z.object({ ...base, type: z.literal('saveState'), state: jsonSchema }).strict(),
  z
    .object({
      ...base,
      type: z.literal('submitScore'),
      score: z.number().int().min(0).max(1_000_000_000),
    })
    .strict(),
  z.object({ ...base, type: z.literal('getPlayer') }).strict(),
  z.object({ ...base, type: z.literal('getGameInfo') }).strict(),
]);
export type BridgeRequest = z.infer<typeof bridgeSchema>;
export const requiredCapability = {
  loadState: 'state',
  saveState: 'state',
  submitScore: 'score',
  getPlayer: 'player',
  getGameInfo: 'gameInfo',
} as const;

export const gameMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
  })
  .strict();
