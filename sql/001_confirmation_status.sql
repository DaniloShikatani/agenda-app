-- Fase 1: status simplificado de agendamento (Pendente/Confirmado/Cancelado)
-- Totalmente separado da coluna legada `status` (usada pelo módulo Financeiro/prestação de contas).

SET search_path TO agenda_app;

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (confirmation_status IN ('pendente', 'confirmado', 'cancelado'));

-- Backfill de histórico apenas para exibição sensata dos dados antigos:
-- concluido (prestação de contas já feita) -> confirmado
-- biomedica_faltou / paciente_cancelou -> cancelado
UPDATE entries SET confirmation_status = 'confirmado' WHERE status = 'concluido';
UPDATE entries SET confirmation_status = 'cancelado'
  WHERE status IN ('biomedica_faltou', 'paciente_cancelou');
