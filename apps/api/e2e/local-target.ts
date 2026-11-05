export function assertLocalE2eDatabase(source: NodeJS.ProcessEnv = process.env) {
  let url: URL;
  try {
    url = new URL(source.DATABASE_URL ?? 'invalid:');
  } catch {
    throw new Error('Invalid isolated E2E database target');
  }
  if (
    url.protocol !== 'postgresql:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    (url.pathname !== '/eatease_m2_test' && !(source.CI === 'true' && url.pathname === '/eatease'))
  ) {
    throw new Error('E2E requires isolated local eatease_m2_test or ephemeral local CI eatease');
  }
  return url.pathname.slice(1);
}
