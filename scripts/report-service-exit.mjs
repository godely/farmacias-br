// systemd supplies SERVICE_RESULT to ExecStopPost even when the process was killed.
import { createMonitoring } from '../src/monitoring.js';
if (process.env.SERVICE_RESULT && process.env.SERVICE_RESULT !== 'success') {
  const monitor = createMonitoring(process.env.FARMACIAS_SENTRY_DSN);
  monitor?.serviceExit();
  await monitor?.close();
}
