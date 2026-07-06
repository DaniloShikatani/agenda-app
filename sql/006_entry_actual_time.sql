-- Fase 8: horário real de início e fim do atendimento (registrado ao concluir/prestar contas)

SET search_path TO agenda_app;

ALTER TABLE entries ADD COLUMN IF NOT EXISTS actual_start_time TIME NULL;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS actual_end_time   TIME NULL;
