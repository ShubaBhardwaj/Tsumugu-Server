import { z } from "zod";
import { inngest } from "./client.js";
import { recoverJobs, runJob } from "../services/job.services.js";
export const processBackgroundJob = inngest.createFunction(
  { id: "background-job", retries: 0, triggers: [{ event: "background/run" }] },
  async ({ event }) => {
    const data = z
      .object({ jobId: z.string().min(1), generation: z.number().int().min(0) })
      .parse(event.data);
    await runJob(data.jobId, data.generation);
  },
);
export const recoverBackgroundJobs = inngest.createFunction(
  {
    id: "recover-background-jobs",
    retries: 2,
    triggers: [{ cron: "* * * * *" }],
  },
  async () => ({ delivered: await recoverJobs() }),
);
export const functions = [processBackgroundJob, recoverBackgroundJobs];
