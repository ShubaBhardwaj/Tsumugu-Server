import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth.middleware.js";
import { asyncHandler } from "../utils/async-handler.js";
import { getJobForUser, retryJobForUser } from "../services/job.services.js";

export const jobRoutes = Router();

jobRoutes.use(requireAuth);

const params = z.object({ jobId: z.string().min(1) });

jobRoutes.get(
  "/:jobId",
  asyncHandler(async (req, res) => {
    res.json(
      await getJobForUser(params.parse(req.params).jobId, req.session.user.id),
    );
  }),
);

jobRoutes.post(
  "/:jobId/retry",
  asyncHandler(async (req, res) => {
    res
      .status(202)
      .json(
        await retryJobForUser(
          params.parse(req.params).jobId,
          req.session.user.id,
        ),
      );
  }),
);
