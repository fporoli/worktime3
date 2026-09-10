import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { sendMail, smtpConfig } from './mailer';

/** Minimal fake SMTP catcher: records envelope + message, then accepts. */
async function withFakeSmtp(fn: (port: number, seen: { mailFrom: string; rcptTo: string; data: string }) => Promise<void>) {
  const seen = { mailFrom: '', rcptTo: '', data: '' };
  const server = createServer((socket) => {
    socket.write('220 fake ESMTP\r\n');
    let buffer = '';
    let inData = false;
    let dataLines: string[] = [];
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (inData) {
          if (line === '.') {
            inData = false;
            seen.data = dataLines.join('\n');
            dataLines = [];
            socket.write('250 OK\r\n');
          } else {
            dataLines.push(line);
          }
          continue;
        }
        if (line.startsWith('EHLO')) socket.write('250-fake\r\n250 HELP\r\n');
        else if (line.startsWith('MAIL FROM:')) {
          seen.mailFrom = line;
          socket.write('250 OK\r\n');
        } else if (line.startsWith('RCPT TO:')) {
          seen.rcptTo = line;
          socket.write('250 OK\r\n');
        } else if (line === 'DATA') {
          inData = true;
          socket.write('354 End data\r\n');
        } else if (line === 'QUIT') socket.write('221 Bye\r\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch {
    server.close();
    return null; // localhost bind blocked (sandboxed CI) — caller skips
  }
  const port = (server.address() as { port: number }).port;
  try {
    await fn(port, seen);
  } catch (e: any) {
    if (e?.code === 'EPERM') {
      server.close();
      return null;
    }
    throw e;
  } finally {
    server.close();
  }
  return seen;
}

test('sendMail delivers envelope and message to SMTP', async (t) => {
  process.env.SMTP_HOST = '127.0.0.1';
  try {
    const seen = await withFakeSmtp(async (port) => {
      process.env.SMTP_PORT = String(port);
      await sendMail({ to: 'user@acme.example', subject: 'Welcome', text: 'Hello\n.Second line' });
    });
    if (!seen) {
      t.skip('localhost bind blocked in this environment');
      return;
    }
    assert.match(seen.mailFrom, /worktime@localhost/);
    assert.match(seen.rcptTo, /user@acme\.example/);
    assert.match(seen.data, /Subject: Welcome/);
    assert.match(seen.data, /Hello/);
    assert.match(seen.data, /^\.\.Second line/m);
  } finally {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
  }
});

test('sendMail fails fast when nothing listens', async () => {
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '1';
  await assert.rejects(() => sendMail({ to: 'a@b.c', subject: 'x', text: 'y' }, 1000));
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
});

test('smtpConfig has no auth/secure by default (local catcher), picks both up when set', () => {
  const bare = smtpConfig();
  assert.equal(bare.auth, undefined);
  assert.equal(bare.secure, false);

  process.env.SMTP_USER = 'relay-user';
  process.env.SMTP_PASSWORD = 'relay-pass';
  process.env.SMTP_SECURE = 'true';
  try {
    const configured = smtpConfig();
    assert.deepEqual(configured.auth, { user: 'relay-user', pass: 'relay-pass' });
    assert.equal(configured.secure, true);
  } finally {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_SECURE;
  }
});

test('smtpConfig requires both user and password — one alone does not enable auth', () => {
  process.env.SMTP_USER = 'only-user';
  try {
    assert.equal(smtpConfig().auth, undefined);
  } finally {
    delete process.env.SMTP_USER;
  }
});
