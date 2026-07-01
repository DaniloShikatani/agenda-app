require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { Pool } = require('pg');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'agenda_secret_2026';

const pool = new Pool({
  host:     process.env.DB_HOST     || 'renanbrigante_renanbrigantedb',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'renanbrigante',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASS     || 'NovaSenhaForte123!@',
  options:  '-c search_path=agenda_app',
});

const uploadDir = '/app/uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `comprovante-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(uploadDir));

// ── AUTH MIDDLEWARE ────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão' });
    next();
  };
}

// ── AUTH ───────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND active = true',
      [email.toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ── USERS (admin) ──────────────────────────────────────────────
app.get('/api/users', auth, requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email, role, active, created_at FROM users ORDER BY name');
  return res.json(rows);
});

app.post('/api/users', auth, requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, active',
      [name, email.toLowerCase(), hash, role]
    );
    if (role === 'biomedica') {
      await pool.query('INSERT INTO balances (biomedica_id, initial_balance) VALUES ($1, 0) ON CONFLICT DO NOTHING', [rows[0].id]);
    }
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email já cadastrado' });
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.put('/api/users/:id', auth, requireRole('admin'), async (req, res) => {
  const { name, email, password, role, active } = req.body;
  try {
    const fields = []; const vals = []; let i = 1;
    if (name     !== undefined) { fields.push(`name = $${i++}`);     vals.push(name); }
    if (email    !== undefined) { fields.push(`email = $${i++}`);    vals.push(email.toLowerCase()); }
    if (role     !== undefined) { fields.push(`role = $${i++}`);     vals.push(role); }
    if (active   !== undefined) { fields.push(`active = $${i++}`);   vals.push(active); }
    if (password)               { fields.push(`password_hash = $${i++}`); vals.push(await bcrypt.hash(password, 12)); }
    if (!fields.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, email, role, active`, vals);
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

app.delete('/api/users/:id', auth, requireRole('admin'), async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Não pode deletar a si mesmo' });
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  return res.json({ success: true });
});

// ── BIOMEDICAS (agendador + admin) ─────────────────────────────
app.get('/api/biomedicas', auth, requireRole('admin', 'agendador'), async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, email FROM users WHERE role = 'biomedica' AND active = true ORDER BY name");
  return res.json(rows);
});

// ── ENTRIES ────────────────────────────────────────────────────
app.get('/api/entries', auth, async (req, res) => {
  const { start, end, biomedica_id, status, patient, plano, plan_ids } = req.query;
  const vals = []; let i = 1;
  let where = '1=1';

  if (req.user.role === 'biomedica') {
    where += ` AND e.biomedica_id = $${i++}`;
    vals.push(req.user.id);
  } else if (biomedica_id) {
    where += ` AND e.biomedica_id = $${i++}`;
    vals.push(biomedica_id);
  }
  if (start)   { where += ` AND e.date >= $${i++}`;          vals.push(start); }
  if (end)     { where += ` AND e.date <= $${i++}`;          vals.push(end); }
  if (status)  { where += ` AND e.status = $${i++}`;         vals.push(status); }
  if (patient) { where += ` AND e.patient ILIKE $${i++}`;    vals.push('%' + patient + '%'); }
  if (plano)   { where += ` AND e.plano ILIKE $${i++}`;      vals.push('%' + plano + '%'); }
  if (plan_ids) {
    const ids = String(plan_ids).split(',').map(Number).filter(Boolean);
    if (ids.length) { where += ` AND e.plan_id = ANY($${i++}::int[])`; vals.push(ids); }
  }

  const { rows } = await pool.query(
    `SELECT e.*, b.name AS biomedica_name, c.name AS created_by_name, p.nome AS plan_nome
     FROM entries e
     JOIN users b ON b.id = e.biomedica_id
     JOIN users c ON c.id = e.created_by
     LEFT JOIN plans p ON p.id = e.plan_id
     WHERE ${where}
     ORDER BY e.date, e.time`,
    vals
  );
  return res.json(rows);
});

async function resolvePlanoText(queryable, plan_id, planoFallback) {
  if (!plan_id) return planoFallback || null;
  const { rows } = await queryable.query('SELECT nome FROM plans WHERE id=$1', [plan_id]);
  return rows.length ? rows[0].nome : (planoFallback || null);
}

app.post('/api/entries', auth, requireRole('admin', 'agendador'), async (req, res) => {
  const { biomedica_id, date, time, type, patient, address, value, driver, note, plano, plan_id, sessao, total_sessoes } = req.body;
  if (!biomedica_id || !date || !time || !patient) return res.status(400).json({ error: 'Biomedica, data, hora e paciente são obrigatórios' });
  try {
    const planoText = await resolvePlanoText(pool, plan_id, plano);
    const { rows } = await pool.query(
      `INSERT INTO entries (biomedica_id, date, time, type, patient, address, value, driver, note, created_by, status, plano, plan_id, sessao, total_sessoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente',$11,$12,$13,$14) RETURNING *`,
      [biomedica_id, date, time, type || 'Coleta', patient, address, value || 0, driver, note, req.user.id,
       planoText, plan_id || null, sessao || null, total_sessoes || null]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar agendamento' });
  }
});

app.post('/api/entries/bulk', auth, requireRole('admin', 'agendador'), async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'Lista vazia' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const e of entries) {
      const { biomedica_id, date, time, type, patient, address, value, driver, note, plano, plan_id, sessao, total_sessoes } = e;
      const planoText = await resolvePlanoText(client, plan_id, plano);
      const { rows } = await client.query(
        `INSERT INTO entries (biomedica_id, date, time, type, patient, address, value, driver, note, created_by, status, plano, plan_id, sessao, total_sessoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente',$11,$12,$13,$14) RETURNING *`,
        [biomedica_id, date, time, type || 'Coleta', patient, address, value || 0, driver, note, req.user.id,
         planoText, plan_id || null, sessao || null, total_sessoes || null]
      );
      created.push(rows[0]);
    }
    await client.query('COMMIT');
    return res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar agendamentos em lote' });
  } finally {
    client.release();
  }
});

app.put('/api/entries/:id', auth, requireRole('admin', 'agendador'), async (req, res) => {
  const { biomedica_id, date, time, type, patient, address, value, driver, note, plano, plan_id, sessao, total_sessoes } = req.body;
  try {
    const planoText = await resolvePlanoText(pool, plan_id, plano);
    const { rows } = await pool.query(
      `UPDATE entries SET biomedica_id=$1, date=$2, time=$3, type=$4, patient=$5, address=$6, value=$7, driver=$8, note=$9,
       plano=$10, plan_id=$11, sessao=$12, total_sessoes=$13, updated_at=now()
       WHERE id=$14 AND status='pendente' RETURNING *`,
      [biomedica_id, date, time, type, patient, address, value, driver, note,
       planoText, plan_id || null, sessao || null, total_sessoes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agendamento não encontrado ou já concluído' });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao atualizar agendamento' });
  }
});

app.patch('/api/entries/:id/status', auth, requireRole('admin', 'agendador'), async (req, res) => {
  const { status } = req.body;
  const valid = ['pendente', 'biomedica_faltou', 'paciente_cancelou'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    const { rows } = await pool.query(
      `UPDATE entries SET status=$1, updated_at=now() WHERE id=$2 AND status='pendente' RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agendamento não encontrado ou já concluído/cancelado' });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

app.patch('/api/entries/:id/confirmation-status', auth, requireRole('admin', 'agendador'), async (req, res) => {
  const { confirmation_status } = req.body;
  const valid = ['pendente', 'confirmado', 'cancelado'];
  if (!valid.includes(confirmation_status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    const { rows } = await pool.query(
      `UPDATE entries SET confirmation_status=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [confirmation_status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agendamento não encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar status de confirmação' });
  }
});

app.delete('/api/entries/:id', auth, requireRole('admin', 'agendador'), async (req, res) => {
  const { rows } = await pool.query("DELETE FROM entries WHERE id=$1 AND status='pendente' RETURNING id", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Agendamento não encontrado ou já concluído' });
  return res.json({ success: true });
});

// ── IMPORT CSV ────────────────────────────────────────────────
function parseCSV(text, delimiter) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lines.filter(l => l.trim()).map(line => {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === delimiter && !inQ) {
        fields.push(cur.trim()); cur = '';
      } else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  });
}

function parseDateBR(s) {
  if (!s) return null;
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

app.post('/api/entries/import', auth, requireRole('admin', 'agendador'), upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  try {
    const text = fs.readFileSync(req.file.path, 'utf8');
    fs.unlinkSync(req.file.path);

    const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
    const rows = parseCSV(text, delimiter);
    if (rows.length < 2) return res.status(400).json({ error: 'Arquivo vazio ou sem dados' });

    const { rows: bioRows } = await pool.query(
      "SELECT id, name, email FROM users WHERE role='biomedica' AND active=true"
    );

    let success = 0;
    const errors = [];
    const dataRows = rows.slice(1); // skip header

    for (let i = 0; i < dataRows.length; i++) {
      const [dateRaw, time, biomedica, type, patient, address, value, driver, note] = dataRows[i];
      const rowNum = i + 2;
      if (!dateRaw && !patient) continue; // skip blank rows

      const date = parseDateBR(dateRaw);
      if (!date)    { errors.push({ row: rowNum, message: `Data inválida: "${dateRaw}"` }); continue; }
      if (!time)    { errors.push({ row: rowNum, message: 'Hora obrigatória' }); continue; }
      if (!patient) { errors.push({ row: rowNum, message: 'Paciente obrigatório' }); continue; }
      if (!biomedica) { errors.push({ row: rowNum, message: 'Biomédica obrigatória' }); continue; }

      const bio = bioRows.find(b =>
        b.name.toLowerCase() === biomedica.toLowerCase() ||
        b.email.toLowerCase() === biomedica.toLowerCase()
      );
      if (!bio) { errors.push({ row: rowNum, message: `Biomédica não encontrada: "${biomedica}"` }); continue; }

      try {
        await pool.query(
          `INSERT INTO entries (biomedica_id, date, time, type, patient, address, value, driver, note, created_by, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente')`,
          [bio.id, date, time.substring(0,5), type || 'Coleta', patient, address || null,
           parseFloat(value) || 0, driver || null, note || null, req.user.id]
        );
        success++;
      } catch (err) {
        errors.push({ row: rowNum, message: `Erro ao inserir: ${err.message}` });
      }
    }

    return res.json({ success, errors, total: dataRows.filter(r => r.some(c => c)).length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao processar arquivo' });
  }
});

// ── PRESTAR CONTAS ─────────────────────────────────────────────
app.post('/api/entries/:id/prestar-contas', auth, requireRole('biomedica', 'admin'), upload.single('comprovante'), async (req, res) => {
  const { note, value } = req.body;
  const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const { rows: check } = await pool.query(
      "SELECT * FROM entries WHERE id=$1 AND status='pendente'",
      [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: 'Agendamento não encontrado ou já concluído' });
    if (req.user.role === 'biomedica' && check[0].biomedica_id !== req.user.id)
      return res.status(403).json({ error: 'Sem permissão' });

    const spentValue = value !== undefined && value !== '' ? parseFloat(value) : null;
    const { rows } = await pool.query(
      `UPDATE entries SET status='concluido', completed_at=now(),
       note=COALESCE($1, note),
       value=COALESCE($2, value),
       receipt_path=COALESCE($3, receipt_path),
       updated_at=now()
       WHERE id=$4 RETURNING *`,
      [note || null, spentValue, receiptPath, req.params.id]
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao prestar contas' });
  }
});

// ── FINANCEIRO ─────────────────────────────────────────────────
app.get('/api/financeiro/resumo', auth, async (req, res) => {
  try {
    const { start, end } = req.query;
    let biomedica_ids;
    if (req.user.role === 'biomedica') {
      biomedica_ids = [req.user.id];
    } else if (req.user.role === 'admin') {
      const { rows } = await pool.query("SELECT id FROM users WHERE role='biomedica' AND active=true");
      biomedica_ids = rows.map(r => r.id);
    } else {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const result = await Promise.all(biomedica_ids.map(async (bid) => {
      const { rows: user } = await pool.query('SELECT id, name FROM users WHERE id=$1', [bid]);

      // Gastos prestados (entries concluídos = dinheiro que a biomédica gastou)
      let expQ = "SELECT COALESCE(SUM(value),0) AS total FROM entries WHERE biomedica_id=$1 AND status='concluido'";
      const expV = [bid]; let ei = 2;
      if (start) { expQ += ` AND date >= $${ei++}`; expV.push(start); }
      if (end)   { expQ += ` AND date <= $${ei++}`; expV.push(end); }
      const { rows: expRows } = await pool.query(expQ, expV);

      // Depósitos (dinheiro que o admin colocou na conta da biomédica)
      let depQ = 'SELECT COALESCE(SUM(value),0) AS total FROM deposits WHERE biomedica_id=$1';
      const depV = [bid]; let di = 2;
      if (start) { depQ += ` AND date >= $${di++}`; depV.push(start); }
      if (end)   { depQ += ` AND date <= $${di++}`; depV.push(end); }
      const { rows: depRows } = await pool.query(depQ, depV);

      const total_expenses  = parseFloat(expRows[0].total);
      const total_deposited = parseFloat(depRows[0].total);
      return {
        biomedica_id:   bid,
        biomedica_name: user[0]?.name || '',
        total_expenses,
        total_deposited,
        balance: total_deposited - total_expenses, // positivo = saldo disponível na conta
      };
    }));
    return res.json(req.user.role === 'biomedica' ? result[0] : result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao calcular resumo financeiro' });
  }
});

app.get('/api/financeiro/deposits', auth, async (req, res) => {
  const bid = req.user.role === 'biomedica' ? req.user.id : req.query.biomedica_id;
  if (!bid) return res.json([]);
  const { start, end } = req.query;
  let query = `SELECT d.*, u.name AS created_by_name FROM deposits d
     JOIN users u ON u.id = d.created_by
     WHERE d.biomedica_id=$1`;
  const vals = [bid]; let i = 2;
  if (start) { query += ` AND d.date >= $${i++}`; vals.push(start); }
  if (end)   { query += ` AND d.date <= $${i++}`; vals.push(end); }
  query += ' ORDER BY d.date DESC';
  const { rows } = await pool.query(query, vals);
  return res.json(rows);
});

app.post('/api/financeiro/deposits', auth, requireRole('admin'), async (req, res) => {
  const { biomedica_id, date, value, note } = req.body;
  if (!biomedica_id || !date || !value) return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO deposits (biomedica_id, date, value, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [biomedica_id, date, parseFloat(value), note || null, req.user.id]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao registrar depósito' });
  }
});

app.delete('/api/financeiro/deposits/:id', auth, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM deposits WHERE id=$1', [req.params.id]);
  return res.json({ success: true });
});

// ── PARÂMETROS: TIPOS DE PROCEDIMENTO ─────────────────────────
app.get('/api/procedure-types', auth, async (req, res) => {
  const onlyActive = req.query.active === 'true';
  const where = onlyActive ? 'WHERE active = true' : '';
  const { rows } = await pool.query(`SELECT * FROM procedure_types ${where} ORDER BY sort_order, name`);
  return res.json(rows);
});

app.post('/api/procedure-types', auth, requireRole('admin'), async (req, res) => {
  const { name, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO procedure_types (name, sort_order) VALUES ($1, $2) RETURNING *',
      [name.trim(), sort_order || 0]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Tipo já cadastrado' });
    return res.status(500).json({ error: 'Erro ao criar tipo' });
  }
});

app.put('/api/procedure-types/:id', auth, requireRole('admin'), async (req, res) => {
  const { name, active, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE procedure_types SET name=$1, active=$2, sort_order=$3 WHERE id=$4 RETURNING *',
      [name, active, sort_order ?? 0, req.params.id]
    );
    return res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Nome já existe' });
    return res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

app.delete('/api/procedure-types/:id', auth, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM procedure_types WHERE id=$1', [req.params.id]);
  return res.json({ success: true });
});

// ── PLANOS ─────────────────────────────────────────────────────
app.get('/api/plans', auth, async (req, res) => {
  const onlyActive = req.query.active === 'true';
  const where = onlyActive ? 'WHERE ativo = true' : '';
  const { rows } = await pool.query(`SELECT * FROM plans ${where} ORDER BY sort_order, nome`);
  return res.json(rows);
});

app.post('/api/plans', auth, requireRole('admin'), async (req, res) => {
  const { nome, total_sessoes, sort_order } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO plans (nome, total_sessoes, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [nome.trim(), total_sessoes || 1, sort_order || 0]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Plano já cadastrado' });
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar plano' });
  }
});

app.put('/api/plans/:id', auth, requireRole('admin'), async (req, res) => {
  const { nome, total_sessoes, ativo, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE plans SET nome=$1, total_sessoes=$2, ativo=$3, sort_order=$4 WHERE id=$5 RETURNING *',
      [nome, total_sessoes, ativo, sort_order ?? 0, req.params.id]
    );
    return res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Nome já existe' });
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
});

app.delete('/api/plans/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM plans WHERE id=$1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Plano em uso em agendamentos — desative-o em vez de excluir' });
    console.error(err);
    return res.status(500).json({ error: 'Erro ao excluir plano' });
  }
});

// ── HEALTH ─────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok' });
  } catch {
    return res.status(500).json({ status: 'error' });
  }
});

// ── SPA FALLBACK ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => console.log(`Agenda app rodando na porta ${PORT}`));
