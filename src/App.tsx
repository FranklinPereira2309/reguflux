import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { Stethoscope, Monitor, Users, Smartphone, Plus, Volume2 } from 'lucide-react';

// Types
interface Sector {
  id: number;
  name: string;
  prefix: string;
}

interface Ticket {
  id: number;
  sector_id: number;
  patient_name: string;
  ticket_number: number;
  ticket_code: string;
  is_priority: boolean;
  status: string;
  called_at: string | null;
  created_at: string;
}

// Socket Connection
const socket: Socket = io();

export default function App() {
  const [view, setView] = useState<'home' | 'patient' | 'reception' | 'doctor' | 'tv'>('home');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer" 
            onClick={() => setView('home')}
          >
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Stethoscope className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">FluxoMed</h1>
          </div>
          <nav className="hidden md:flex gap-4">
            <button onClick={() => setView('patient')} className="text-sm font-medium text-slate-600 hover:text-indigo-600">Paciente</button>
            <button onClick={() => setView('reception')} className="text-sm font-medium text-slate-600 hover:text-indigo-600">Recepção</button>
            <button onClick={() => setView('doctor')} className="text-sm font-medium text-slate-600 hover:text-indigo-600">Médico</button>
            <button onClick={() => setView('tv')} className="text-sm font-medium text-slate-600 hover:text-indigo-600">TV (Sala de Espera)</button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 md:p-8">
        {view === 'home' && <HomeView setView={setView} />}
        {view === 'patient' && <PatientView />}
        {view === 'reception' && <ReceptionView />}
        {view === 'doctor' && <DoctorView />}
        {view === 'tv' && <TVView />}
      </main>
    </div>
  );
}

function HomeView({ setView }: { setView: (v: any) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
      <DashboardCard 
        title="Painel do Paciente" 
        description="Acesso via QR Code para gerar senha digital."
        icon={<Smartphone className="w-8 h-8 text-indigo-500" />}
        onClick={() => setView('patient')}
      />
      <DashboardCard 
        title="Painel da Recepção" 
        description="Geração manual de senhas e prioridades."
        icon={<Users className="w-8 h-8 text-emerald-500" />}
        onClick={() => setView('reception')}
      />
      <DashboardCard 
        title="Painel do Médico" 
        description="Lista de espera e chamada de pacientes."
        icon={<Stethoscope className="w-8 h-8 text-blue-500" />}
        onClick={() => setView('doctor')}
      />
      <DashboardCard 
        title="Painel da TV" 
        description="Exibição em tempo real das senhas chamadas."
        icon={<Monitor className="w-8 h-8 text-amber-500" />}
        onClick={() => setView('tv')}
      />
    </div>
  );
}

function DashboardCard({ title, description, icon, onClick }: any) {
  return (
    <div 
      onClick={onClick}
      className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md hover:border-indigo-100 transition-all cursor-pointer flex flex-col items-center text-center gap-4"
    >
      <div className="p-4 bg-slate-50 rounded-full">
        {icon}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
        <p className="text-sm text-slate-500 mt-1">{description}</p>
      </div>
    </div>
  );
}

// --- PATIENT VIEW ---
function PatientView() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSector, setSelectedSector] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/sectors').then(res => res.json()).then(setSectors);
  }, []);

  useEffect(() => {
    if (ticket) {
      // Listen for updates on this specific ticket
      socket.on(`ticket_update_${ticket.id}`, (updatedTicket: Ticket) => {
        setTicket(updatedTicket);
        if (updatedTicket.status === 'CALLED') {
          // Play sound or vibrate
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
      });

      return () => {
        socket.off(`ticket_update_${ticket.id}`);
      };
    }
  }, [ticket]);

  const generateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSector || !name) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector_id: selectedSector, patient_name: name, is_priority: false })
      });
      const data = await res.json();
      setTicket(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (ticket) {
    return (
      <div className="max-w-md mx-auto bg-white p-8 rounded-3xl shadow-lg border border-slate-100 text-center">
        <h2 className="text-xl font-medium text-slate-500 mb-2">Sua Senha</h2>
        <div className="text-6xl font-bold text-indigo-600 tracking-tighter mb-6">
          {ticket.ticket_code}
        </div>
        
        <div className="bg-slate-50 rounded-2xl p-6 mb-6">
          <p className="text-slate-600 mb-1">Paciente</p>
          <p className="text-lg font-semibold text-slate-800">{ticket.patient_name}</p>
        </div>

        {ticket.status === 'WAITING' ? (
          <div className="animate-pulse flex items-center justify-center gap-2 text-amber-600 bg-amber-50 py-3 rounded-xl font-medium">
            <div className="w-2 h-2 bg-amber-600 rounded-full"></div>
            Aguardando chamada...
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-emerald-600 bg-emerald-50 py-4 rounded-xl font-medium border border-emerald-100">
            <Volume2 className="w-8 h-8 animate-bounce" />
            <span className="text-xl">Dirija-se ao consultório!</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
      <div className="text-center mb-8">
        <Smartphone className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-800">Check-in Digital</h2>
        <p className="text-slate-500 mt-2">Gere sua senha sem passar pela recepção.</p>
      </div>

      <form onSubmit={generateTicket} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Seu Nome Completo</label>
          <input 
            type="text" 
            required
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            placeholder="Ex: João da Silva"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Setor de Atendimento</label>
          <div className="grid grid-cols-1 gap-3">
            {sectors.map(sector => (
              <div 
                key={sector.id}
                onClick={() => setSelectedSector(sector.id)}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedSector === sector.id ? 'border-indigo-600 bg-indigo-50' : 'border-slate-100 hover:border-slate-300'}`}
              >
                <div className="font-semibold text-slate-800">{sector.name}</div>
              </div>
            ))}
          </div>
        </div>

        <button 
          type="submit" 
          disabled={!selectedSector || !name || loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
        >
          {loading ? 'Gerando...' : 'Gerar Senha'}
        </button>
      </form>
    </div>
  );
}

// --- RECEPTION VIEW ---
function ReceptionView() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSector, setSelectedSector] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [isPriority, setIsPriority] = useState(false);
  const [lastTicket, setLastTicket] = useState<Ticket | null>(null);

  useEffect(() => {
    fetch('/api/sectors').then(res => res.json()).then(data => {
      setSectors(data);
      if (data.length > 0) setSelectedSector(data[0].id);
    });
  }, []);

  const generateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSector || !name) return;
    
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector_id: selectedSector, patient_name: name, is_priority: isPriority })
      });
      const data = await res.json();
      setLastTicket(data);
      setName('');
      setIsPriority(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-3 mb-8">
          <Users className="w-8 h-8 text-emerald-500" />
          <h2 className="text-2xl font-bold text-slate-800">Emissão Manual (Recepção)</h2>
        </div>

        <form onSubmit={generateTicket} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Nome do Paciente</label>
              <input 
                type="text" 
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                placeholder="Ex: Maria Oliveira"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Setor</label>
              <select 
                value={selectedSector || ''} 
                onChange={e => setSelectedSector(Number(e.target.value))}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
              >
                {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
            <input 
              type="checkbox" 
              id="priority"
              checked={isPriority}
              onChange={e => setIsPriority(e.target.checked)}
              className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500"
            />
            <label htmlFor="priority" className="font-medium text-slate-700 cursor-pointer">
              Atendimento Prioritário (Idosos, Gestantes, etc.)
            </label>
          </div>

          <button 
            type="submit" 
            disabled={!selectedSector || !name}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-8 py-4 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Emitir Ticket
          </button>
        </form>
      </div>

      <div className="bg-slate-800 text-white p-8 rounded-3xl shadow-lg flex flex-col items-center justify-center text-center">
        <h3 className="text-slate-400 font-medium mb-6 uppercase tracking-widest text-sm">Último Ticket Impresso</h3>
        
        {lastTicket ? (
          <div className="bg-white text-slate-900 w-full p-6 rounded-2xl shadow-inner relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500"></div>
            <p className="text-sm text-slate-500 mb-1">Senha</p>
            <div className="text-5xl font-bold tracking-tighter mb-4">{lastTicket.ticket_code}</div>
            <div className="border-t border-dashed border-slate-300 pt-4 text-left">
              <p className="text-xs text-slate-400 uppercase">Paciente</p>
              <p className="font-semibold truncate">{lastTicket.patient_name}</p>
              {lastTicket.is_priority && (
                <span className="inline-block mt-2 px-2 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded uppercase">Prioridade</span>
              )}
            </div>
          </div>
        ) : (
          <div className="text-slate-500 italic">Nenhum ticket emitido nesta sessão.</div>
        )}
      </div>
    </div>
  );
}

// --- DOCTOR VIEW ---
function DoctorView() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSector, setSelectedSector] = useState<number | null>(null);
  const [queue, setQueue] = useState<Ticket[]>([]);

  useEffect(() => {
    fetch('/api/sectors').then(res => res.json()).then(data => {
      setSectors(data);
      if (data.length > 0) setSelectedSector(data[0].id);
    });
  }, []);

  const fetchQueue = () => {
    if (!selectedSector) return;
    fetch(`/api/queue/${selectedSector}`)
      .then(res => res.json())
      .then(setQueue);
  };

  useEffect(() => {
    fetchQueue();
    
    socket.on('queue_updated', (data: { sector_id: number }) => {
      if (data.sector_id === selectedSector) {
        fetchQueue();
      }
    });

    return () => {
      socket.off('queue_updated');
    };
  }, [selectedSector]);

  const callNext = async () => {
    if (!selectedSector) return;
    try {
      await fetch(`/api/queue/${selectedSector}/call`, { method: 'POST' });
      // The socket event will trigger a queue refresh
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div className="flex items-center gap-3">
          <Stethoscope className="w-8 h-8 text-blue-500" />
          <h2 className="text-2xl font-bold text-slate-800">Painel do Médico</h2>
        </div>
        
        <select 
          value={selectedSector || ''} 
          onChange={e => setSelectedSector(Number(e.target.value))}
          className="px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
        >
          {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-semibold text-slate-700">Fila de Espera ({queue.length})</h3>
          <button 
            onClick={callNext}
            disabled={queue.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
          >
            <Volume2 className="w-5 h-5" />
            Chamar Próximo
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {queue.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              A fila está vazia no momento.
            </div>
          ) : (
            queue.map((ticket, index) => (
              <div key={ticket.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-6">
                  <div className="text-2xl font-bold text-slate-400 w-8">{index + 1}º</div>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-lg font-bold text-slate-800">{ticket.ticket_code}</span>
                      {ticket.is_priority && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded uppercase">Prioridade</span>
                      )}
                    </div>
                    <div className="text-slate-600">{ticket.patient_name}</div>
                  </div>
                </div>
                <div className="text-sm text-slate-400">
                  {new Date(ticket.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// --- TV VIEW ---
function TVView() {
  const [calledTicket, setCalledTicket] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    socket.on('ticket_called', (data: any) => {
      // Play sound
      const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
      audio.play().catch(e => console.log('Audio play blocked by browser'));
      
      setCalledTicket(data);
      setHistory(prev => {
        const newHistory = [data, ...prev].slice(0, 5); // Keep last 5
        return newHistory;
      });
    });

    return () => {
      socket.off('ticket_called');
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-slate-900 text-white flex flex-col z-50">
      <header className="p-6 border-b border-slate-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Stethoscope className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">FluxoMed</h1>
        </div>
        <div className="text-2xl font-medium text-slate-400">
          {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Main Display */}
        <div className="flex-1 flex flex-col items-center justify-center p-12 relative overflow-hidden">
          {calledTicket ? (
            <div className="text-center animate-in fade-in zoom-in duration-500">
              <h2 className="text-4xl text-slate-400 mb-4 font-medium uppercase tracking-widest">Senha Chamada</h2>
              <div className="text-[12rem] font-black tracking-tighter text-amber-400 leading-none mb-8 drop-shadow-2xl">
                {calledTicket.ticket.ticket_code}
              </div>
              <div className="text-6xl font-semibold mb-8">
                {calledTicket.ticket.patient_name}
              </div>
              <div className="inline-block bg-indigo-600 text-white text-5xl font-bold px-12 py-6 rounded-3xl">
                {calledTicket.room}
              </div>
            </div>
          ) : (
            <div className="text-4xl text-slate-600 font-medium">Aguardando chamadas...</div>
          )}
        </div>

        {/* Sidebar History */}
        <div className="w-1/3 bg-slate-800 border-l border-slate-700 flex flex-col">
          <div className="p-6 border-b border-slate-700 bg-slate-800/50">
            <h3 className="text-2xl font-semibold text-slate-300">Últimas Chamadas</h3>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            {history.slice(1).map((item, i) => (
              <div key={i} className="p-6 border-b border-slate-700 flex justify-between items-center">
                <div>
                  <div className="text-4xl font-bold text-slate-200 mb-2">{item.ticket.ticket_code}</div>
                  <div className="text-xl text-slate-400">{item.ticket.patient_name}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-medium text-indigo-400">{item.room}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
