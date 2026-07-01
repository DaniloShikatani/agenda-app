const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: parseInt(process.env.SMTP_PORT || '587') === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
} else {
  console.warn('[mailer] SMTP não configurado — envio de e-mails desabilitado');
}

function buildHtml(date, rows) {
  const tr = rows.map(r => `<tr>
    <td>${(r.time || '').slice(0, 5)}</td>
    <td>${r.patient}</td>
    <td>${r.plan_nome || r.plano || '—'}</td>
    <td>${r.sessao ? `${r.sessao}/${r.total_sessoes || '?'}` : '—'}</td>
    <td>${r.tratamento || '—'}</td>
    <td>${r.biomedica_name}</td>
    <td>${r.address || '—'}</td>
  </tr>`).join('');
  return `<h3>Agenda encerrada — ${date}</h3>
    <table border="1" cellpadding="6" style="border-collapse:collapse">
      <tr><th>Horário</th><th>Paciente</th><th>Plano</th><th>Sessão</th><th>Tratamento</th><th>Biomédica</th><th>Local</th></tr>
      ${tr}
    </table>`;
}

async function sendDailyAgendaEmail({ to, date, rows }) {
  if (!transporter) return { sent: false, reason: 'not_configured' };
  if (!to.length) return { sent: false, reason: 'no_recipients' };
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: to.join(','),
    subject: `Agenda do dia ${date} — encerrada`,
    html: buildHtml(date, rows),
  });
  return { sent: true };
}

module.exports = { sendDailyAgendaEmail };
