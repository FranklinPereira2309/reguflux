import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import { format } from 'date-fns';

const db = new Database('fluxomed.db');

// Initialize SQLite Database (Simulating PostgreSQL)
db.exec(`
  CREATE TABLE IF NOT EXISTS sectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS queue_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    patient_name TEXT NOT NULL,
    ticket_number INTEGER NOT NULL,
    ticket_code TEXT NOT NULL,
    is_priority BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'WAITING',
    called_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id)
  );

  -- Create unique index for daily sequence per sector
  CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_ticket_per_sector_per_day 
  ON queue_tickets(sector_id, ticket_number, date(created_at));
`);

// Seed sectors if empty
const sectorCount = db.prepare('SELECT COUNT(*) as count FROM sectors').get() as { count: number };
if (sectorCount.count === 0) {
  const insertSector = db.prepare('INSERT INTO sectors (name, prefix) VALUES (?, ?)');
  insertSector.run('Ortopedia', 'ORT');
  insertSector.run('Clínica Geral', 'CLI');
  insertSector.run('Pediatria', 'PED');
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get('/api/sectors', (req, res) => {
    const sectors = db.prepare('SELECT * FROM sectors').all();
    res.json(sectors);
  });

  // Endpoint de criação de senha (lidando com a concorrência)
  app.post('/api/tickets', (req, res) => {
    const { sector_id, patient_name, is_priority } = req.body;
    
    if (!sector_id || !patient_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      // Usando transaction para garantir a consistência e evitar concorrência
      const createTicket = db.transaction(() => {
        const today = new Date().toISOString().split('T')[0];
        
        // Em PostgreSQL usaríamos: SELECT COALESCE(MAX(ticket_number), 0) FROM queue_tickets WHERE sector_id = $1 AND DATE(created_at) = CURRENT_DATE FOR UPDATE
        // No SQLite, a transaction já bloqueia o banco, garantindo a atomicidade
        const lastTicket = db.prepare(`
          SELECT MAX(ticket_number) as max_number 
          FROM queue_tickets 
          WHERE sector_id = ? AND date(created_at) = ?
        `).get(sector_id, today) as { max_number: number | null };

        const nextNumber = (lastTicket.max_number || 0) + 1;
        
        const sector = db.prepare('SELECT prefix FROM sectors WHERE id = ?').get(sector_id) as { prefix: string };
        if (!sector) throw new Error('Sector not found');

        const ticketCode = `${sector.prefix}-${nextNumber.toString().padStart(3, '0')}`;

        const insert = db.prepare(`
          INSERT INTO queue_tickets (sector_id, patient_name, ticket_number, ticket_code, is_priority, status)
          VALUES (?, ?, ?, ?, ?, 'WAITING')
        `);
        
        const result = insert.run(sector_id, patient_name, nextNumber, ticketCode, is_priority ? 1 : 0);
        
        return db.prepare('SELECT * FROM queue_tickets WHERE id = ?').get(result.lastInsertRowid);
      });

      const newTicket = createTicket();
      
      // Emitir evento WebSocket para atualizar a lista de espera
      io.emit('queue_updated', { sector_id });
      
      res.status(201).json(newTicket);
    } catch (error: any) {
      console.error('Error creating ticket:', error);
      res.status(500).json({ error: 'Failed to create ticket', details: error.message });
    }
  });

  // Obter fila de um setor
  app.get('/api/queue/:sector_id', (req, res) => {
    const { sector_id } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    // Regra de prioridade: is_priority primeiro, depois ordem de chegada
    const queue = db.prepare(`
      SELECT * FROM queue_tickets 
      WHERE sector_id = ? AND date(created_at) = ? AND status = 'WAITING'
      ORDER BY is_priority DESC, created_at ASC
    `).all(sector_id, today);
    
    res.json(queue);
  });

  // Obter ticket específico
  app.get('/api/tickets/:id', (req, res) => {
    const ticket = db.prepare('SELECT * FROM queue_tickets WHERE id = ?').get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    
    // Calcular posição na fila
    const today = new Date().toISOString().split('T')[0];
    const queue = db.prepare(`
      SELECT id FROM queue_tickets 
      WHERE sector_id = ? AND date(created_at) = ? AND status = 'WAITING'
      ORDER BY is_priority DESC, created_at ASC
    `).all((ticket as any).sector_id, today) as { id: number }[];
    
    const position = queue.findIndex(q => q.id === (ticket as any).id) + 1;
    
    res.json({ ...ticket, position });
  });

  // Chamar próximo paciente (Médico)
  app.post('/api/queue/:sector_id/call', (req, res) => {
    const { sector_id } = req.params;
    const today = new Date().toISOString().split('T')[0];

    try {
      const callNext = db.transaction(() => {
        // Encontra o próximo paciente (prioridade primeiro, depois mais antigo)
        const nextTicket = db.prepare(`
          SELECT * FROM queue_tickets 
          WHERE sector_id = ? AND date(created_at) = ? AND status = 'WAITING'
          ORDER BY is_priority DESC, created_at ASC
          LIMIT 1
        `).get(sector_id, today) as any;

        if (!nextTicket) return null;

        // Atualiza o status para CALLED
        db.prepare(`
          UPDATE queue_tickets 
          SET status = 'CALLED', called_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(nextTicket.id);

        return db.prepare('SELECT * FROM queue_tickets WHERE id = ?').get(nextTicket.id);
      });

      const calledTicket = callNext();

      if (!calledTicket) {
        return res.status(404).json({ message: 'Queue is empty' });
      }

      const sector = db.prepare('SELECT name FROM sectors WHERE id = ?').get(sector_id) as any;

      // EMITIR EVENTOS WEBSOCKET
      // 1. Atualiza a TV da sala de espera
      io.emit('ticket_called', { 
        ticket: calledTicket, 
        sector_name: sector.name,
        room: `Consultório ${Math.floor(Math.random() * 5) + 1}` // Simulação de sala
      });
      
      // 2. Atualiza a lista de espera dos médicos/recepção
      io.emit('queue_updated', { sector_id });
      
      // 3. Notifica o paciente específico no celular
      io.emit(`ticket_update_${calledTicket.id}`, calledTicket);

      res.json(calledTicket);
    } catch (error: any) {
      console.error('Error calling next ticket:', error);
      res.status(500).json({ error: 'Failed to call next ticket' });
    }
  });

  // WebSocket Connection
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
