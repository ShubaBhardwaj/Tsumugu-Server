import { z } from "zod";
import { ValidationError } from "../types/app-error.js";

export const revisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use lowercase SHA-256 hexadecimal");
const formBoolean = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean(),
);
export const mobileFields = {
  clientItemKey: z
    .string()
    .regex(/^(document|link):[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  contentRevision: revisionSchema.optional(),
  refreshGeneration: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  recreateDeleted: formBoolean.optional(),
};
export type MobileFields = z.infer<z.ZodObject<typeof mobileFields>>;
export function requireMobilePair(value: MobileFields, ctx: z.RefinementCtx) {
  const any = Object.values(value).some((v) => v !== undefined);
  if (any && (!value.clientItemKey || !value.contentRevision))
    ctx.addIssue({
      code: "custom",
      message: "clientItemKey and contentRevision are required together",
    });
}
export const uploadPdfSchema = z
  .object({ title: z.string().trim().max(200).optional(), ...mobileFields })
  .superRefine(({ title: _title, ...fields }, ctx) =>
    requireMobilePair(fields, ctx),
  );
export const replaceContentSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    url: z.string().trim().optional(),
    clientItemKey: mobileFields.clientItemKey.unwrap(),
    contentRevision: revisionSchema,
    expectedRevision: revisionSchema,
    refreshGeneration: mobileFields.refreshGeneration,
  })
  .strict();
export function idempotencyKey(header: string | undefined, mobile: boolean) {
  if (!mobile && !header) return undefined;
  if (!mobile || !header || !/^[A-Za-z0-9_-]{1,128}$/.test(header))
    throw new ValidationError(
      "Mobile submissions require complete metadata and an Idempotency-Key (1–128 letters, numbers, hyphens or underscores)",
    );
  return header;
}
export function parseIfMatch(header: string | undefined) {
  if (!header) return undefined;
  const match = /^"([a-f0-9]{64})"$/.exec(header);
  if (!match)
    throw new ValidationError(
      "If-Match must contain one quoted content revision",
    );
  return match[1];
}
