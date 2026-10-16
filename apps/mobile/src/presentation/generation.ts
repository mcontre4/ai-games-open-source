import { activeStages, type Stage } from '../../../../packages/domain/src/index.ts';

export const generationStages = [
  ['designing', 'Designing gameplay'],
  ['artwork', 'Creating artwork'],
  ['coding', 'Creating mechanics'],
  ['building', 'Building your game'],
  ['testing', 'Testing gameplay'],
  ['packaging', 'Preparing your download'],
] as const;

export function isCreating(stage: Stage) {
  return activeStages.includes(stage);
}

export function generationStatus(stage: Stage) {
  if (stage === 'queued') return 'Queued · Waiting to start';
  if (stage === 'ready') return 'Ready to play';
  if (stage === 'failed') return 'Creation failed';
  if (stage === 'cancelled') return 'Creation cancelled';
  return generationStages.find(([value]) => value === stage)![1];
}
