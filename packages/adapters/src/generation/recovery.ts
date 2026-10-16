import type {
  GenerationCheckpointPort,
  StoragePort,
  IdPort,
} from '../../../application/src/ports.ts';
import { docker, snapshotSandbox } from './docker-sandbox.ts';
/** Called under the generation lease, before replacing a surviving interrupted container. */
export async function recoverSandbox(
  jobId: string,
  gameId: string,
  checkpoints: GenerationCheckpointPort,
  storage: StoragePort,
  ids: IdPort,
) {
  const tag = `aig-${jobId.replaceAll('_', '-')}`;
  const exists = await docker(['inspect', tag]).then(
    () => true,
    () => false,
  );
  if (!exists) return;
  const files = await snapshotSandbox(tag);
  const checkpoint = (await checkpoints.load(jobId)) ?? { attempts: 0 };
  const prefix = `${gameId}/checkpoints/${jobId}/${ids.next('cp')}`;
  await storage.put(`${prefix}-source.zip`, files.source);
  await storage.put(`${prefix}-context.zip`, files.context);
  const saved = {
    ...checkpoint,
    sourceKey: `${prefix}-source.zip`,
    contextKey: `${prefix}-context.zip`,
  };
  await checkpoints.save(jobId, saved);
  // Failure to save leaves the container available for operational recovery.
  await docker(['rm', '-f', tag, `${tag}-gateway`]);
  await docker(['network', 'rm', `${tag}-net`]);
  return saved;
}
