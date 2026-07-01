-- Fase 4: protocolo de tratamento por sessão de cada plano

SET search_path TO agenda_app;

CREATE TABLE IF NOT EXISTS plan_session_treatments (
  id            SERIAL PRIMARY KEY,
  plan_id       INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  sessao_numero INT NOT NULL,
  tratamento    TEXT NOT NULL,
  UNIQUE (plan_id, sessao_numero)
);

ALTER TABLE entries ADD COLUMN IF NOT EXISTS tratamento TEXT NULL;

-- Seed: somente o plano "Start" está confirmado (Microagulhamento + Drug Delivery
-- em todas as 6 sessões). Os demais planos ficam sem protocolo pré-cadastrado até
-- o cliente fornecer a lista — preenchimento manual pela tela de admin "Planos".
INSERT INTO plan_session_treatments (plan_id, sessao_numero, tratamento)
SELECT id, s, 'Microagulhamento + Drug Delivery'
FROM plans, generate_series(1, 6) AS s
WHERE plans.nome = 'Start'
ON CONFLICT (plan_id, sessao_numero) DO NOTHING;
