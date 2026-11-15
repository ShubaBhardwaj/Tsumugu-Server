import { reprocessSource } from "../services/source.services.js";
import { sourceIdParamSchema } from "../validators/source.validator.js";
import { Router } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import {
  bulkDeleteSources,
  createSource,
  deleteSource,
  getSource,
  importWebsite,
  importYoutube,
  listSources,
  uploadPdf,
} from "../controllers/source.controller.js";
import { uploadSinglePdf } from "../middleware/upload.middleware.js";

export const sourceRoutes = Router({ mergeParams: true });

sourceRoutes.post("/upload", uploadSinglePdf, asyncHandler(uploadPdf));
sourceRoutes.post("/import/website", asyncHandler(importWebsite));
sourceRoutes.post("/import/youtube", asyncHandler(importYoutube));
sourceRoutes.get("/", asyncHandler(listSources));
sourceRoutes.post("/", asyncHandler(createSource));
sourceRoutes.post("/bulk-delete", asyncHandler(bulkDeleteSources));
sourceRoutes.get("/:sourceId", asyncHandler(getSource));
sourceRoutes.delete("/:sourceId", asyncHandler(deleteSource));

sourceRoutes.post(
  "/:sourceId/reprocess",
  asyncHandler(async (req, res) => {
    const { workspaceId, sourceId } = sourceIdParamSchema.parse(req.params);
    res
      .status(202)
      .json(await reprocessSource(workspaceId, sourceId, req.session.user.id));
  }),
);
