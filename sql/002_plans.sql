-- Fase 2: planos estruturados (substituem o campo de texto livre `plano`)

SET search_path TO agenda_app;

CREATE TABLE IF NOT EXISTS plans (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL UNIQUE,
  total_sessoes INT  NOT NULL DEFAULT 1,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (nome, total_sessoes, sort_order) VALUES
  ('Sessão de lavagem capilar avulsa', 1, 10),
  ('Plano de lavagem capilar',         3, 20),
  ('PRP avulso',                       1, 30),
  ('MMP avulso',                       1, 40),
  ('MMP + PRP avulso',                 1, 50),
  ('Start',                            6, 60),
  ('Essential',                        6, 70),
  ('Diamond',                          6, 80)
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE entries ADD COLUMN IF NOT EXISTS plan_id INT NULL REFERENCES plans(id);

-- Nenhum backfill de `entries.plano` necessário: auditoria confirmou 0 linhas
-- com plano preenchido até o momento desta migração.
