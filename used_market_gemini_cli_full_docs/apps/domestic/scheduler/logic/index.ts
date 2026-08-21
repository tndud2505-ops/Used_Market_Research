import { createSchedulerDaemon } from './daemon.js';

const daemon = createSchedulerDaemon({
  onJobStart: (job, runId) => {
    console.log(`[scheduler] started ${job.name} (${runId})`);
  },
  onJobComplete: (job, runId, event) => {
    console.log(`[scheduler] finished ${job.name} (${runId}) status=${event.status}`);
  },
  onJobError: (job, error) => {
    console.error(`[scheduler] failed ${job.name}:`, error);
  }
});

const schedules = daemon.start();
console.log(`[scheduler] running in ${process.env.SCHEDULER_TIMEZONE ?? 'Asia/Seoul'}`);
console.log(`[scheduler] ${schedules.length} jobs registered; first run started`);

function shutdown(signal: string) {
  console.log(`[scheduler] ${signal} received; stopping`);
  daemon.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
