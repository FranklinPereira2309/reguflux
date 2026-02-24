-- Modelagem do Banco de Dados PostgreSQL para o ReguFlux

-- Tabela de Setores
CREATE TABLE sectors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    prefix VARCHAR(10) NOT NULL UNIQUE, -- Ex: 'ORT' para Ortopedia
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Senhas/Tickets
CREATE TABLE queue_tickets (
    id SERIAL PRIMARY KEY,
    sector_id INTEGER NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    patient_name VARCHAR(255) NOT NULL,
    ticket_number INTEGER NOT NULL, -- Número sequencial do dia
    ticket_code VARCHAR(20) NOT NULL, -- Código formatado (Ex: ORT-042)
    is_priority BOOLEAN DEFAULT FALSE, -- Fura-fila para idosos, gestantes, etc.
    status VARCHAR(20) DEFAULT 'WAITING', -- WAITING, CALLED, COMPLETED, CANCELLED
    called_at TIMESTAMP WITH TIME ZONE, -- Quando o médico chamou
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Restrição para garantir que não haja números duplicados no mesmo setor no mesmo dia
CREATE UNIQUE INDEX unique_ticket_per_sector_per_day ON queue_tickets (sector_id, ticket_number, (created_at::DATE));

-- Índices para otimizar buscas frequentes
CREATE INDEX idx_queue_tickets_sector_status ON queue_tickets(sector_id, status);
CREATE INDEX idx_queue_tickets_created_date ON queue_tickets((created_at::DATE));
CREATE INDEX idx_queue_tickets_priority ON queue_tickets(is_priority DESC, created_at ASC);

-- Inserindo alguns setores de exemplo
INSERT INTO sectors (name, prefix) VALUES 
('Ortopedia', 'ORT'),
('Clínica Geral', 'CLI'),
('Pediatria', 'PED');
