import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { assertNextAuthSecret } from "@/lib/env";
import { bootstrapOwnerIfEligible } from "@/lib/owner-bootstrap";

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
      
      // Check if email is verified
      if (!user.emailVerified) {
        throw new Error("Please verify your email before signing in.");
      }
      
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
    async signIn({ user }) {
      const userId = (user as { id?: string }).id;
      if (!userId) return;
      try {
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
        // Swallow ƒ?" device logging must not break sign-in.
      }

      try {
        const email = (user as { email?: string | null }).email ?? null;
        await bootstrapOwnerIfEligible(userId, email);
      } catch {
        // Never block sign-in on bootstrap failure.
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
  secret: assertNextAuthSecret(),
};
