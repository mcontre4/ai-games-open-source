// iOS can move the app's data container when updating or reinstalling a build.
// Resolve downloads against today's document directory, never a persisted root.
export function installationDirectory(
  documentDirectory: string,
  account: string,
  gameId: string,
  versionId: string,
): string {
  if (![account, gameId, versionId].every((part) => /^[a-zA-Z0-9_-]+$/.test(part)))
    throw new Error('Invalid installation scope.');
  return `${documentDirectory.replace(/\/$/, '')}/games/${account}/${gameId}-${versionId}/`;
}
