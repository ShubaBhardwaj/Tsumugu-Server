import "dotenv/config";
import { frontendOrigin } from "./config.js";
import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./db.js"; // your prisma client instance

const clientUrl = frontendOrigin();

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [clientUrl, "tsumugu://", "tsumugu://*"],
  plugins: [expo()],
  advanced: { disableOriginCheck: false },
  database: prismaAdapter(prisma, {
    provider: "postgresql", // or "mysql", "postgresql", ...etc
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
});
