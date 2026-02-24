import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/reguflux',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  app.use(express.json());

  // API Routes
  const seedDatabase = async () => {
    try {
      const sectorCount = await pool.query('SELECT COUNT(*) FROM sectors');
      if (parseInt(sectorCount.rows[0].count) === 0) {
        console.log('Seeding database with default sectors...');
        await pool.query("INSERT INTO sectors (name, prefix) VALUES ('Ortopedia', 'ORT'), ('Clínica Geral', 'CLI'), ('Pediatria', 'PED')");
      }
    } catch (err) {
      console.error('Error seeding database:', err);
    }
  };
  await seedDatabase();

  app.get('/api/sectors', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM sectors');
      res.json(result.rows);
    } catch (error: any) {
      console.error('API Error /api/sectors:', error.message, error.stack);
      res.status(500).json({ error: 'Failed to fetch sectors', details: error.message });
    }
  });

  app.post('/api/tickets', async (req, res) => {
    const { sector_id, patient_name, is_priority } = req.body;

    if (!sector_id || !patient_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const sectorResult = await client.query('SELECT prefix FROM sectors WHERE id = $1 FOR UPDATE', [sector_id]);
      if (sectorResult.rows.length === 0) {
        throw new Error('Sector not found');
      }
      const prefix = sectorResult.rows[0].prefix;

      const lastTicketResult = await client.query(`
        SELECT MAX(ticket_number) as max_number 
        FROM queue_tickets 
        WHERE sector_id = $1 AND created_at::DATE = CURRENT_DATE
      `, [sector_id]);

      const nextNumber = (lastTicketResult.rows[0].max_number || 0) + 1;
      const ticketCode = `${prefix}-${nextNumber.toString().padStart(3, '0')}`;

      const insertResult = await client.query(`
        INSERT INTO queue_tickets (sector_id, patient_name, ticket_number, ticket_code, is_priority, status)
        VALUES ($1, $2, $3, $4, $5, 'WAITING')
        RETURNING *
      `, [sector_id, patient_name, nextNumber, ticketCode, !!is_priority]);

      const newTicket = insertResult.rows[0];

      await client.query('COMMIT');
      io.emit('queue_updated', { sector_id });
      res.status(201).json(newTicket);
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('API Error /api/tickets:', error.message, error.stack);
      res.status(500).json({ error: 'Failed to create ticket', details: error.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/queue/:sector_id', async (req, res) => {
    const { sector_id } = req.params;
    try {
      const result = await pool.query(`
        SELECT * FROM queue_tickets 
        WHERE sector_id = $1 AND created_at::DATE = CURRENT_DATE AND status = 'WAITING'
        ORDER BY is_priority DESC, created_at ASC
      `, [sector_id]);
      res.json(result.rows);
    } catch (error: any) {
      console.error('API Error /api/queue/:sector_id:', error.message, error.stack);
      res.status(500).json({ error: 'Failed to fetch queue', details: error.message });
    }
  });

  app.get('/api/tickets/:id', async (req, res) => {
    try {
      const ticketResult = await pool.query('SELECT * FROM queue_tickets WHERE id = $1', [req.params.id]);
      if (ticketResult.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
      const ticket = ticketResult.rows[0];
      const queueResult = await pool.query(`
        SELECT id FROM queue_tickets 
        WHERE sector_id = $1 AND created_at::DATE = CURRENT_DATE AND status = 'WAITING'
        ORDER BY is_priority DESC, created_at ASC
      `, [ticket.sector_id]);
      const position = queueResult.rows.findIndex(q => q.id === ticket.id) + 1;
      res.json({ ...ticket, position });
    } catch (error: any) {
      console.error('API Error /api/tickets/:id:', error.message, error.stack);
      res.status(500).json({ error: 'Failed to fetch ticket', details: error.message });
    }
  });

  app.post('/api/queue/:sector_id/call', async (req, res) => {
    const { sector_id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const nextTicketResult = await client.query(`
        SELECT * FROM queue_tickets 
        WHERE sector_id = $1 AND created_at::DATE = CURRENT_DATE AND status = 'WAITING'
        ORDER BY is_priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `, [sector_id]);

      if (nextTicketResult.rows.length === 0) {
        await client.query('COMMIT');
        return res.status(404).json({ message: 'Queue is empty' });
      }

      const nextTicket = nextTicketResult.rows[0];
      const updateResult = await client.query(`
        UPDATE queue_tickets 
        SET status = 'CALLED', called_at = CURRENT_TIMESTAMP 
        WHERE id = $1
        RETURNING *
      `, [nextTicket.id]);

      const calledTicket = updateResult.rows[0];
      const sectorResult = await client.query('SELECT name FROM sectors WHERE id = $1', [sector_id]);
      const sectorName = sectorResult.rows[0].name;

      await client.query('COMMIT');

      io.emit('ticket_called', {
        ticket: calledTicket,
        sector_name: sectorName,
        room: `Consultório ${Math.floor(Math.random() * 5) + 1}`
      });
      io.emit('queue_updated', { sector_id });
      io.emit(`ticket_update_${calledTicket.id}`, calledTicket);
      res.json(calledTicket);
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('API Error /api/queue/:sector_id/call:', error.message, error.stack);
      res.status(500).json({ error: 'Failed to call next ticket', details: error.message });
    } finally {
      client.release();
    }
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  const PORT = parseInt(process.env.PORT || '3000', 10);

  if (process.env.NODE_ENV === 'production') {
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    app.use(express.static(path.join(__dirname, 'dist')));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer();
