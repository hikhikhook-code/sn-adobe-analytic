import { Resend } from 'resend';
import crypto from 'crypto';
import { prisma } from './prisma';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Generate a verification token and send email to user
 */
export async function sendVerificationEmail(email: string, userName?: string) {
  try {
    // Generate random token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token in database
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    });

    // Create verification link
    const verificationLink = `${process.env.NEXTAUTH_URL}/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

    // Send email
    const result = await resend.emails.send({
      from: 'noreply@sn-adobe-analytic.com',
      to: email,
      subject: 'Verify your email address',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to SN Adobe Analytic!</h2>
          <p>Hi ${userName || 'there'},</p>
          <p>Please verify your email address by clicking the link below:</p>
          <p>
            <a href="${verificationLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email
            </a>
          </p>
          <p>Or copy and paste this link in your browser:</p>
          <p>${verificationLink}</p>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn''t create this account, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />
          <p style="color: #666; font-size: 12px;">© 2026 SN Adobe Analytic. All rights reserved.</p>
        </div>
      `,
    });

    if (result.error) {
      console.error('Failed to send verification email:', result.error);
      throw new Error('Failed to send verification email');
    }

    return { success: true, token };
  } catch (error) {
    console.error('Error in sendVerificationEmail:', error);
    throw error;
  }
}

/**
 * Verify email token and mark user as verified
 */
export async function verifyEmailToken(token: string, email: string) {
  try {
    const verificationToken = await prisma.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: email,
          token,
        },
      },
    });

    if (!verificationToken) {
      throw new Error('Invalid or expired token');
    }

    if (verificationToken.expires < new Date()) {
      // Delete expired token
      await prisma.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: email,
            token,
          },
        },
      });
      throw new Error('Token has expired');
    }

    // Update user as verified
    const user = await prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
      select: { id: true, email: true, name: true },
    });

    // Delete used token
    await prisma.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: email,
          token,
        },
      },
    });

    return { success: true, user };
  } catch (error) {
    console.error('Error in verifyEmailToken:', error);
    throw error;
  }
}
