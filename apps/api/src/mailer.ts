import { connect, type Socket } from 'node:net';

/**
 * Minimal SMTP sender for non-production mail (Mailpit/MailHog catchers).
 * No authentication, no TLS — point SMTP_HOST at a catcher, never at a real
 * relay. All sends should be fire-and-forget from request handlers so a
 * missing catcher never breaks the API.
 */

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  from?: string;
}

export function smtpConfig() {
  return {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    from: process.env.SMTP_FROM ?? 'worktime@localhost',
  };
}

function readResponse(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('smtp-timeout')), timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      // Multi-line replies continue while the code is followed by '-'.
      if (lines.length >= 2 && /^[0-9]{3} /.test(lines[lines.length - 2])) {
        clearTimeout(timer);
        socket.off('data', onData);
        resolve(buffer);
      }
    };
    socket.on('data', onData);
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function command(socket: Socket, line: string, expectCode: string, timeoutMs: number): Promise<void> {
  socket.write(`${line}\r\n`);
  const res = await readResponse(socket, timeoutMs);
  if (!res.startsWith(expectCode)) throw new Error(`smtp-unexpected:${res.split('\r\n')[0]}`);
}

export async function sendMail(options: MailOptions, timeoutMs = 5000): Promise<void> {
  const { host, port, from } = smtpConfig();
  const sender = options.from ?? from;
  const socket = connect(port, host);
  try {
    const greeting = await readResponse(socket, timeoutMs);
    if (!greeting.startsWith('220')) throw new Error(`smtp-greeting:${greeting.split('\r\n')[0]}`);
    await command(socket, `EHLO worktime`, '250', timeoutMs);
    await command(socket, `MAIL FROM:<${sender}>`, '250', timeoutMs);
    await command(socket, `RCPT TO:<${options.to}>`, '250', timeoutMs);
    await command(socket, 'DATA', '354', timeoutMs);
    const body = options.text
      .split('\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    socket.write(`From: ${sender}\r\nTo: ${options.to}\r\nSubject: ${options.subject}\r\n\r\n${body}\r\n.\r\n`);
    const dataRes = await readResponse(socket, timeoutMs);
    if (!dataRes.startsWith('250')) throw new Error(`smtp-data:${dataRes.split('\r\n')[0]}`);
    socket.write('QUIT\r\n');
  } finally {
    socket.destroy();
  }
}
