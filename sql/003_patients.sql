-- Fase 3: cadastro de pacientes + duração de atendimento por sexo

SET search_path TO agenda_app;

CREATE TABLE IF NOT EXISTS patients (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  sexo       CHAR(1) NULL CHECK (sexo IN ('M','F')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patients_nome_lower ON patients (lower(nome));

ALTER TABLE entries ADD COLUMN IF NOT EXISTS patient_id       INT NULL REFERENCES patients(id);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS duration_minutes INT NULL;

-- Backfill: um paciente por nome distinto (case/espaço insensível) já usado em agendamentos.
-- Sexo fica NULL para pacientes históricos (nunca foi capturado antes) — não é destrutivo,
-- o texto original em entries.patient permanece intacto em cada linha.
INSERT INTO patients (nome)
SELECT DISTINCT ON (lower(trim(patient))) trim(patient)
FROM entries WHERE patient IS NOT NULL AND trim(patient) <> ''
ORDER BY lower(trim(patient));

UPDATE entries e SET patient_id = p.id
FROM patients p
WHERE lower(trim(e.patient)) = lower(trim(p.nome)) AND e.patient_id IS NULL;
