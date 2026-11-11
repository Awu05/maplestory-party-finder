import { beforeEach, expect, it, vi } from 'vitest';
import { SmtpPasswordResetMailer } from '../src/auth/resetMailer.js';

const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  mocks.sendMail.mockResolvedValue({ rejected: [] });
});
const smtp = { host: 'smtp.example.com', port: 587, secure: false, from: 'pf@example.com', user: 'pf', password: 'secret' };

it('requires TLS and sends a plain-text reset link without filesystem or URL fetching', async () => {
  const mailer = new SmtpPasswordResetMailer(smtp);
  await mailer.send('maple@example.com', 'https://pf.example/reset-password#token=secret');
  expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
    host: smtp.host, port: 587, secure: false, requireTLS: true,
    auth: { user: 'pf', pass: 'secret' }, logger: false, debug: false, socketTimeout: 8000,
  }));
  expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
    from: smtp.from, to: 'maple@example.com', subject: 'Reset your Party Finder password',
    text: expect.stringContaining('https://pf.example/reset-password#token=secret'),
    disableFileAccess: true, disableUrlAccess: true,
  }));
  expect(mocks.sendMail.mock.calls[0]![0].text).toContain('30 minutes');
});

it('supports TLS from the start of the connection', () => {
  new SmtpPasswordResetMailer({ ...smtp, port: 465, secure: true });
  expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true, requireTLS: false }));
});

it('reports SMTP rejections so the reset token can be invalidated', async () => {
  mocks.sendMail.mockResolvedValue({ rejected: ['maple@example.com'] });
  await expect(new SmtpPasswordResetMailer(smtp).send('maple@example.com', 'https://pf.example/reset-password#token=secret')).rejects.toThrow('Reset email rejected');
});
