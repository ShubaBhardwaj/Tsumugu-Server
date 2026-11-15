import "dotenv/config";
import prisma from "../lib/db.js";
import { reconcileLegacyJobs } from "../services/job-recovery.services.js";
try {
  console.log({ recoveryAttempts: await reconcileLegacyJobs() });
} finally {
  await prisma.$disconnect();
}
