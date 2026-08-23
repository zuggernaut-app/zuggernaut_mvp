'use strict';

const { createLogger } = require('../observability/logger');

const log = createLogger({ name: 'emailTransport' });

function resolveEmailTransport() {
  const explicit = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (explicit === 'console' || explicit === 'smtp') return explicit;
  return process.env.NODE_ENV === 'production' ? 'smtp' : 'console';
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_FROM?.trim()
  );
}

/**
 * @param {{ to: string; subject: string; text?: string; html?: string }} message
 */
async function sendEmail(message) {
  const { to, subject, text, html } = message;
  if (!to || !subject) {
    throw new TypeError('sendEmail requires to and subject');
  }

  const transport = resolveEmailTransport();

  if (transport === 'console') {
    log.info(
      {
        transport: 'console',
        to,
        subject,
        text: text ?? null,
        html: html ?? null,
      },
      'email.send'
    );
    return { delivered: true, transport: 'console' };
  }

  if (!smtpConfigured()) {
    log.warn(
      { transport: 'smtp', to, subject },
      'email.send.smtp_not_configured'
    );
    return { delivered: false, transport: 'smtp', reason: 'not_configured' };
  }

  // SES/SMTP provider wiring deferred — env gate only until outbound mail is configured in deploy.
  log.warn(
    { transport: 'smtp', to, subject },
    'email.send.smtp_provider_not_wired'
  );
  return { delivered: false, transport: 'smtp', reason: 'provider_not_wired' };
}

module.exports = {
  resolveEmailTransport,
  sendEmail,
};
