import { installFatalAnalytics } from '../../../packages/adapters/src/analytics.ts';
import { runtimeConfig } from '../../../packages/config/src/index.ts';
import { compose } from '../../../packages/adapters/src/composition.ts';
import { createServer } from './server.ts';
const config = runtimeConfig(process.env);
const services = compose(config);
installFatalAnalytics(services.analytics, 'api');
const app = await createServer(services, true);
await app.listen({ port: config.API_PORT, host: config.API_HOST });
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  await services.db.close();
  await services.analytics.shutdown();
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
