-- Fase 7: fechamento diário da agenda (horário de almoço + conclusão + e-mail)

SET search_path TO agenda_app;

CREATE TABLE IF NOT EXISTS daily_agenda (
  date       DATE PRIMARY KEY,
  lunch_time TIME NULL,
  closed_at  TIMESTAMPTZ NULL,
  closed_by  INT NULL REFERENCES users(id)
);
