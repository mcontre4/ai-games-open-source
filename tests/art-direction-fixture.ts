import type { GameArtDirection } from '../packages/domain/src/index.ts';
export const watercolorDirection: GameArtDirection = {
  theme: 'Autumn forest garden',
  visualStyle: 'Hand-painted watercolor with warm ochre washes and textured paper.',
  animationStyle:
    'Smooth delta-based movement, swaying leaves and eased collect feedback at 60 FPS.',
  imagePrompt:
    'A warm autumn watercolor forest garden, hand-painted paper texture, clear central gameplay area, no text.',
  gameplay: {
    premise: 'Help a forest gardener gather acorns to plant a small grove before autumn ends.',
    coreLoop: 'Move the basket under drifting acorns, catch them, then choose the next safe path.',
    goal: 'Gather twelve acorns to plant the grove and complete the harvest.',
    decisions:
      'Choose between safe ordinary acorns and valuable golden acorns near falling branches.',
    progression:
      'Start with one easy catch, then introduce gusts and golden acorns in three harvest stages.',
    feedback:
      'Basket bounce and watercolor flecks confirm each catch; the grove grows at each milestone.',
    replay: 'Complete a perfect harvest or improve the number of golden acorns gathered.',
  },
  sprites: {
    player: 'A hand-woven ochre wicker harvest basket, open top, seen from the side.',
    threat: 'A twisting terracotta fallen branch with two dry leaves, seen from the side.',
    reward: 'A plump golden acorn with a textured brown cap, seen from the side.',
    prop: 'A tiny oak sapling with three warm ochre leaves in a soil mound, seen from the side.',
  },
  presentation: {
    composition:
      'Basket at 16% viewport width, acorns in the middle 60%; distant trees behind a quiet top HUD in both orientations.',
    camera: 'Side view shared by the basket, branches and garden.',
    hierarchy:
      'Golden acorns contrast against quiet pale foliage; reserve the top 150px in portrait and top right in landscape for the compact HUD.',
    motion: {
      idle: 'Leaves sway 3 degrees over 1800ms with sine easing.',
      movement: 'Basket follows touch with 100ms eased response and slight tilt.',
      action: 'Basket compresses to 0.94 scale for 90ms on catch, recovers over 180ms.',
      success: 'Sapling rises over 500ms with a gentle eased settle.',
      failure: 'Basket recoils 8px over 120ms then returns without flashing.',
    },
    acceptance: [
      'Basket and acorns remain clear against foliage.',
      'HUD leaves the central catching area unobstructed.',
      'The sapling shows earned harvest progress.',
    ],
  },
  quality: 'premium',
  pixelArt: false,
  typography: 'serif',
  cornerRadius: 8,
  palette: {
    background: '#f3e5cf',
    surface: '#fff7e8',
    text: '#442918',
    muted: '#795938',
    accent: '#b95a25',
    onAccent: '#fff7e8',
  },
};
