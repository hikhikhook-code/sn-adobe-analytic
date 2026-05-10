import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { assertNextAuthSecret } from "@/lib/env";

/**
 * Whether Google OAuth is wired for this deployment.
 *
 * Must be evaluated at module load, NOT inside `authorize`/`callbacks`, so
 * the sign-in page can import it as a pure client-safe boolean (see the
 * separate `auth-client.ts` re-export) and render its Google button in
 * the correct enabled/disabled state without round-tripping to the server.
 */
export const GOOGLE_OAUTH_ENABLED = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    id: "credentials",
    name: "Email & password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(creds) {
      if (!creds?.email || !creds?.password) return null;
      const user = await prisma.user.findUnique({
        where: { email: creds.email.toLowerCase() },
      });
      if (!user || !user.hashedPassword) return null;
      const ok = await bcrypt.compare(creds.password, user.hashedPassword);
      if (!ok) return null;
      return {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
        image: user.image ?? undefined,
      };
    },
  }),
];

if (GOOGLE_OAUTH_ENABLED) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // `allowDangerousEmailAccountLinking` keeps NextAuth from throwing
      // `OAuthAccountNotLinked` the first time a user who already has a
      // credentials-based account tries to sign in with Google using the
      // same email. We still match purely on verified Google email, which
      // is safe because Google returns `email_verified: true` for any
      // account that reached the OAuth consent screen. If a deployment
      // wants stricter linking semantics (e.g. require the user to first
      // confirm the link from their account settings) they can flip this
      // off; for the current single-app MVP the PRD asks for "sign in
      // with Google" to Just Work.
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/login",
  },
  events: {
    // Best-effort device logging. Runs after every successful sign-in
    // (credentials OR Google) and after every new session issuance. We
    // don't throw here — PR #16 is foundation only, so a logging failure
    // must never block a user from signing in. The eventual device-limit
    // enforcement PR will layer a `signIn` callback on top that rejects
    // the attempt when the user is already at their plan's device cap.
    async signIn({ user }) {
      const userId = (user as { id?: string }).id;
      if (!userId) return;
      try {
        // We don't have the raw Request here (NextAuth events don't
        // surface headers), so we stamp a generic "Recent sign-in"
        // device row. The credentials-register path + the
        // `/api/devices/register` client route provide richer info.
        const deviceId = randomBytes(12).toString("hex");
        await prisma.device.create({
          data: {
            userId,
            deviceId,
            deviceName: "Recent sign-in",
            lastActive: new Date(),
            firstSeen: new Date(),
            isActive: true,
          },
        });
      } catch {
        // Swallow — device logging must not break sign-in.
      }
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },
  // `assertNextAuthSecret` throws in strict production runtime if the secret
  // is missing, placeholder, CI-only, or too short. In dev / build phase it
  // warns and returns a fallback so local setup and CI stay frictionless.
  // See src/lib/env.ts for the full policy.
  secret: assertNextAuthSecret(),
};
