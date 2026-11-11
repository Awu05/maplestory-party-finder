import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface PasswordResetMailer {
  send(to: string, resetUrl: string): Promise<void>;
}

export class SmtpPasswordResetMailer implements PasswordResetMailer {
  private readonly transport;

  constructor(private readonly config: NonNullable<Config['smtp']>) {
    this.transport = nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000,
      logger: false, debug: false,
    });
  }

  async send(to: string, resetUrl: string): Promise<void> {
    const result = await this.transport.sendMail({
      from: this.config.from, to, subject: 'Reset your Party Finder password',
      text: `Reset your Party Finder password using this link:\n\n${resetUrl}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, ignore this email. Your password will stay the same.`,
      disableFileAccess: true, disableUrlAccess: true,
    });
    if (result.rejected.length > 0) throw new Error('Reset email rejected');
  }
}
