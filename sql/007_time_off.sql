-- Fase 9: folgas e férias das biomédicas (marcação visual no calendário)

SET search_path TO agenda_app;

CREATE TABLE IF NOT EXISTS time_off (
  id           SERIAL PRIMARY KEY,
  biomedica_id INT NOT NULL REFERENCES users(id),
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('folga','ferias')),
  note         TEXT NULL,
  created_by   INT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_time_off_biomedica_dates ON time_off (biomedica_id, start_date, end_date);
