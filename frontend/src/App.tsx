import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import {
  LayoutDashboard,
  Plane,
  History,
  AlertTriangle,
  LogOut,
  Plus,
  Trash2,
  Navigation,
  Flame,
  Radio,
  Battery,
  Shield,
  Activity,
  Menu,
  X,
} from 'lucide-react';
import { Auth } from './components/Auth';
import { MapPanel } from './components/MapPanel';
import type {
  User,
  Drone,
  Waypoint,
  FlightSession,
  TelemetryLog,
  Alert,
  DashboardStats,
} from './types';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

const BASE_URL = 'http://localhost:4000';
const BASE_LAT = 12.971598;
const BASE_LNG = 77.594562;

function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('drone_token'));
  const [user, setUser] = useState<User | null>(
    localStorage.getItem('drone_user') ? JSON.parse(localStorage.getItem('drone_user')!) : null
  );

  // Tab View Control: 'monitor' | 'fleet' | 'logs' | 'alerts'
  const [activeTab, setActiveTab] = useState<'monitor' | 'fleet' | 'logs' | 'alerts'>('monitor');

  // Application Data States
  const [drones, setDrones] = useState<Drone[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [sessions, setSessions] = useState<FlightSession[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Selection and Interactive States
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [liveHistory, setLiveHistory] = useState<any[]>([]); // holds last 20 telemetry points of selected drone
  const [inspectedSession, setInspectedSession] = useState<FlightSession | null>(null);
  const [inspectedSessionTrack, setInspectedSessionTrack] = useState<TelemetryLog[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Forms States
  const [newDroneName, setNewDroneName] = useState('');
  const [newDroneSN, setNewDroneSN] = useState('');
  const [newDroneModel, setNewDroneModel] = useState('');
  // WebSocket reference
  const socketRef = useRef<Socket | null>(null);
  const lastSeenRef = useRef<Record<string, number>>({});
  const droneStatusesRef = useRef<Record<string, string>>({});

  // Fetch helper wrapper with token header
  const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    };
    const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
    if (response.status === 401) {
      handleLogout();
      throw new Error('Session expired');
    }
    return response;
  };

  const handleAuthSuccess = (authUser: User, authToken: string) => {
    setUser(authUser);
    setToken(authToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('drone_token');
    localStorage.removeItem('drone_user');
    setToken(null);
    setUser(null);
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  // 1. Fetch data on token activation
  useEffect(() => {
    if (!token) return;

    const loadData = async () => {
      try {
        const droneRes = await apiFetch('/api/drones');
        const droneData = await droneRes.json();
        setDrones(droneData);
        if (droneData.length > 0 && !selectedDroneId) {
          setSelectedDroneId(droneData[0].id);
        }
        // Initialize last seen and statuses refs
        droneData.forEach((d: Drone) => {
          droneStatusesRef.current[d.id] = d.status;
          if (d.isOnline) {
            lastSeenRef.current[d.id] = Date.now();
          }
        });

        const statsRes = await apiFetch('/api/analytics/dashboard');
        setStats(await statsRes.json());

        const sessionRes = await apiFetch('/api/sessions');
        setSessions(await sessionRes.json());

        const alertRes = await apiFetch('/api/analytics/alerts');
        setAlerts(await alertRes.json());
      } catch (err) {
        console.error('Failed to load initial workspace data:', err);
      }
    };

    loadData();
  }, [token, activeTab]);

  // 2. Establish WebSockets pipeline
  useEffect(() => {
    if (!token) return;

    // Connect to WebSocket server
    socketRef.current = io(BASE_URL);

    // Bind real-time telemetry updates
    socketRef.current.on('telemetry', (payload) => {
      // Record last seen heartbeat
      lastSeenRef.current[payload.droneId] = Date.now();

      // Retrieve previous status from Ref to avoid React stale closure bugs
      const prevStatus = droneStatusesRef.current[payload.droneId] || 'IDLE';
      const isLandedPacket = prevStatus !== 'IDLE' && payload.status === 'IDLE';

      // Update the status ref immediately
      droneStatusesRef.current[payload.droneId] = payload.status;

      // Update drone coordinates in state list
      setDrones((prevDrones) => {
        return prevDrones.map((d) =>
          d.id === payload.droneId
            ? {
              ...d,
              status: payload.status,
              batteryLevel: payload.batteryLevel,
              currentLatitude: payload.latitude,
              currentLongitude: payload.longitude,
              currentAltitude: payload.altitude,
              isOnline: true,
            }
            : d
        );
      });

      // Append selected drone telemetry to active charts history (only during flight, plus the touchdown frame)
      if (payload.droneId === selectedDroneId && (payload.status !== 'IDLE' || isLandedPacket)) {
        setLiveHistory((prev) => {
          const timestamp = new Date(payload.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          const newHistory = [...prev, { ...payload, time: timestamp }];
          // Allow tracking up to 500 ticks (~8.3 mins) to display the overall session trajectory
          if (newHistory.length > 500) newHistory.shift();
          return newHistory;
        });
      }
    });

    // Bind real-time safety alerts warnings
    socketRef.current.on('alert', () => {
      // Re-trigger alert listing
      apiFetch('/api/analytics/alerts')
        .then((res) => res.json())
        .then((data) => setAlerts(data));

      // Re-trigger stats counts
      apiFetch('/api/analytics/dashboard')
        .then((res) => res.json())
        .then((data) => setStats(data));
    });

    // Bind background compilation completion notification
    socketRef.current.on('session-compiled', () => {
      // Re-trigger stats counts and session history lists
      apiFetch('/api/sessions')
        .then((res) => res.json())
        .then((data) => setSessions(data))
        .catch((err) => console.error('Error refreshing sessions:', err));

      apiFetch('/api/analytics/dashboard')
        .then((res) => res.json())
        .then((data) => setStats(data))
        .catch((err) => console.error('Error refreshing stats:', err));

      apiFetch('/api/drones')
        .then((res) => res.json())
        .then((data) => setDrones(data))
        .catch((err) => console.error('Error refreshing drones:', err));
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [token, selectedDroneId]);

  // 3. Heartbeat watchdog checker to mark drones offline if telemetry stops broadcasting
  useEffect(() => {
    if (!token) return;

    const checkOfflineDrones = () => {
      const now = Date.now();
      setDrones((prevDrones) => {
        let changed = false;
        const nextDrones = prevDrones.map((d) => {
          const lastSeen = lastSeenRef.current[d.id];
          // Transition from Online to Offline if we haven't received telemetry in 5 seconds
          if (d.isOnline && (!lastSeen || now - lastSeen > 5000)) {
            changed = true;
            return { ...d, isOnline: false };
          }
          // Transition from Offline to Online if we received telemetry recently
          if (!d.isOnline && lastSeen && now - lastSeen < 5000) {
            changed = true;
            return { ...d, isOnline: true };
          }
          return d;
        });
        return changed ? nextDrones : prevDrones;
      });
    };

    const interval = setInterval(checkOfflineDrones, 2500); // Check statuses every 2.5 seconds
    return () => clearInterval(interval);
  }, [token]);

  // Clear live history when switching selected drones
  useEffect(() => {
    setLiveHistory([]);
    setWaypoints([]);
  }, [selectedDroneId]);

  // Reset logs tab pagination page when switching tabs
  useEffect(() => {
    setLogsPage(1);
    setMobileMenuOpen(false);
  }, [activeTab]);

  // Fetch telemetry logs for session inspection
  const handleInspectSession = async (session: FlightSession) => {
    setInspectedSession(session);
    try {
      const res = await apiFetch(`/api/sessions/${session.id}/telemetry`);
      const data = await res.json();
      setInspectedSessionTrack(data);
    } catch (err) {
      console.error('Failed to load session coordinate tracks:', err);
    }
  };

  // Handle map clicking to build mission waypoints
  const handleMapClick = (lat: number, lng: number) => {
    if (activeTab !== 'monitor') return;

    // Check geofence boundary (300 meters)
    const distance = getDistanceMeters(BASE_LAT, BASE_LNG, lat, lng);
    if (distance > 300) {
      alert(`⚠️ Cannot add waypoint: Click coordinates are ${Math.round(distance)}m away from base station. Geofence safety limit is 300m.`);
      return;
    }

    // Create new waypoint coordinates with default values (15m altitude, 5m/s speed)
    const newWaypoint: Waypoint = {
      latitude: lat,
      longitude: lng,
      altitude: 15,
      speed: 5,
    };
    setWaypoints((prev) => [...prev, newWaypoint]);
  };

  const handleUpdateWaypoint = (index: number, field: 'altitude' | 'speed', rawValue: string) => {
    if (rawValue === '') {
      setWaypoints((prev) =>
        prev.map((wp, idx) => (idx === index ? { ...wp, [field]: '' } : wp))
      );
      return;
    }

    const parsed = Number(rawValue);
    let validatedValue = isNaN(parsed) ? 0 : Math.max(0, parsed);

    // Enforce safety caps matching background alerts limits
    if (field === 'altitude') {
      validatedValue = Math.min(50, validatedValue); // Limit to 50m max altitude
    } else if (field === 'speed') {
      validatedValue = Math.min(12, validatedValue); // Limit to 12m/s max speed
    }

    setWaypoints((prev) =>
      prev.map((wp, idx) => (idx === index ? { ...wp, [field]: validatedValue } : wp))
    );
  };

  const handleDeleteWaypoint = (index: number) => {
    setWaypoints((prev) => prev.filter((_, idx) => idx !== index));
  };

  // REST API Actions
  const handleDispatch = async () => {
    if (!selectedDroneId || waypoints.length === 0) return;
    try {
      const formattedWaypoints = waypoints.map((wp) => ({
        ...wp,
        altitude: Number(wp.altitude) || 0,
        speed: Number(wp.speed) || 0,
      }));

      const response = await apiFetch(`/api/sessions/drones/${selectedDroneId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ waypoints: formattedWaypoints }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      // Reset coordinates and refresh drones list
      setWaypoints([]);
      setLiveHistory([]); // Clear chart history for the new flight session

      const droneRes = await apiFetch('/api/drones');
      setDrones(await droneRes.json());

      // Refresh dashboard stats so that "Active Sessions" card immediately shows "1"
      const statsRes = await apiFetch('/api/analytics/dashboard');
      setStats(await statsRes.json());

      setActiveTab('monitor');
    } catch (err: any) {
      alert(`Dispatch failed: ${err.message}`);
    }
  };

  const handleOverride = async (action: 'RETURN_TO_BASE' | 'LAND' | 'EMERGENCY_LAND') => {
    if (!selectedDroneId) return;
    try {
      const response = await apiFetch(`/api/sessions/drones/${selectedDroneId}/override`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      // Refresh drones list
      const droneRes = await apiFetch('/api/drones');
      setDrones(await droneRes.json());
    } catch (err: any) {
      alert(`Override failed: ${err.message}`);
    }
  };



  const handleCreateDrone = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await apiFetch('/api/drones', {
        method: 'POST',
        body: JSON.stringify({ name: newDroneName, serialNumber: newDroneSN, model: newDroneModel }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      // Reset forms & refresh list
      setNewDroneName('');
      setNewDroneSN('');
      setNewDroneModel('');
      const droneRes = await apiFetch('/api/drones');
      setDrones(await droneRes.json());
    } catch (err: any) {
      alert(`Registration failed: ${err.message}`);
    }
  };

  const handleDeleteDrone = async (id: string) => {
    if (!window.confirm('Are you sure you want to remove this drone?')) return;
    try {
      const response = await apiFetch(`/api/drones/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setDrones((prev) => prev.filter((d) => d.id !== id));
        if (selectedDroneId === id) setSelectedDroneId(null);
      }
    } catch (err) {
      console.error('Failed to remove drone:', err);
    }
  };

  if (!token || !user) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  const selectedDrone = drones.find((d) => d.id === selectedDroneId);

  const ITEMS_PER_PAGE = 5;
  const totalLogsPages = Math.ceil(sessions.length / ITEMS_PER_PAGE) || 1;
  const currentLogsPage = Math.min(logsPage, totalLogsPages);
  const logsStartIndex = (currentLogsPage - 1) * ITEMS_PER_PAGE;
  const paginatedSessions = sessions.slice(logsStartIndex, logsStartIndex + ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col lg:flex-row text-slate-100 font-sans">

      {/* Mobile Top Bar */}
      <header className="lg:hidden flex items-center justify-between px-6 py-4 border-b border-slate-900 bg-slate-900/35 backdrop-blur z-20 shrink-0">
        <div className="flex items-center space-x-2 text-indigo-500">
          <Plane className="h-6 w-6 animate-pulse" />
          <span className="text-lg font-bold tracking-wider text-slate-100">AERO-FLOW</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Mobile Menu Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed top-[61px] left-0 right-0 bottom-0 bg-slate-950/95 backdrop-blur z-10 flex flex-col justify-between p-6 overflow-y-auto border-t border-slate-900">
          <div className="space-y-6">
            {/* User Profile */}
            <div className="flex items-center space-x-3 pb-4 border-b border-slate-900">
              <div className="h-10 w-10 bg-indigo-500/20 text-indigo-400 font-bold rounded-full flex items-center justify-center border border-indigo-500/30">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold">{user.name}</p>
                <div className="flex items-center text-[10px] text-slate-400 font-medium tracking-wide space-x-1">
                  {user.role === 'ADMIN' ? (
                    <>
                      <Shield className="h-3 w-3 text-indigo-400 shrink-0" />
                      <span>Role: Admin</span>
                    </>
                  ) : (
                    <span>Role: Pilot</span>
                  )}
                </div>
              </div>
            </div>

            {/* Nav Tabs */}
            <nav className="space-y-2">
              <button
                onClick={() => {
                  setActiveTab('monitor');
                  setInspectedSession(null);
                }}
                className={`w-full flex items-center space-x-3 py-3 px-4 rounded-xl text-sm font-medium transition-all ${activeTab === 'monitor' && !inspectedSession
                  ? 'bg-indigo-600 text-slate-100 shadow-md shadow-indigo-600/25'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
              >
                <LayoutDashboard className="h-5 w-5" />
                <span>Real-Time Monitor</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('fleet');
                  setInspectedSession(null);
                }}
                className={`w-full flex items-center space-x-3 py-3 px-4 rounded-xl text-sm font-medium transition-all ${activeTab === 'fleet'
                  ? 'bg-indigo-600 text-slate-100 shadow-md shadow-indigo-600/25'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
              >
                <Plane className="h-5 w-5" />
                <span>My Drones</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('logs');
                  setInspectedSession(null);
                }}
                className={`w-full flex items-center space-x-3 py-3 px-4 rounded-xl text-sm font-medium transition-all ${activeTab === 'logs' || inspectedSession
                  ? 'bg-indigo-600 text-slate-100 shadow-md shadow-indigo-600/25'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
              >
                <History className="h-5 w-5" />
                <span>Flight History Logs</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('alerts');
                  setInspectedSession(null);
                }}
                className={`w-full flex items-center space-x-3 py-3 px-4 rounded-xl text-sm font-medium transition-all ${activeTab === 'alerts'
                  ? 'bg-indigo-600 text-slate-100 shadow-md shadow-indigo-600/25'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
              >
                <div className="relative">
                  <AlertTriangle className="h-5 w-5" />
                  {alerts.filter((a) => !a.resolved).length > 0 && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></span>
                  )}
                </div>
                <span>Safety Alerts</span>
              </button>
            </nav>
          </div>

          {/* Log Out */}
          <div className="pt-4 border-t border-slate-900 mt-auto">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 border border-slate-800 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 hover:border-red-500/30 transition-all cursor-pointer"
            >
              <LogOut className="h-5 w-5" />
              <span>Secure Log Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Sidebar Navigation (Desktop) */}
      <aside className="hidden lg:flex w-64 border-r border-slate-900 bg-slate-900/35 backdrop-blur flex-col justify-between shrink-0">
        <div>
          {/* Logo Brand */}
          <div className="flex items-center space-x-2 px-6 py-6 border-b border-slate-900 text-indigo-500">
            <Plane className="h-8 w-8 animate-pulse" />
            <span className="text-xl font-bold tracking-wider text-slate-100">AERO-FLOW</span>
          </div>

          {/* User Profile */}
          <div className="px-6 py-4 border-b border-slate-900 flex items-center space-x-3">
            <div className="h-10 w-10 bg-indigo-500/20 text-indigo-400 font-bold rounded-full flex items-center justify-center border border-indigo-500/30">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold truncate">{user.name}</p>
              <div className="flex items-center text-[10px] text-slate-400 font-medium tracking-wide space-x-1">
                {user.role === 'ADMIN' ? (
                  <>
                    <Shield className="h-3 w-3 text-indigo-400 shrink-0" />
                    <span>Role: Admin</span>
                  </>
                ) : (
                  <span>Role: Pilot</span>
                )}
              </div>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav className="mt-6 px-4 space-y-1.5">
            <button
              onClick={() => {
                setActiveTab('monitor');
                setInspectedSession(null);
              }}
              className={`w-full flex items-center space-x-3 py-3 px-4 rounded-xl text-sm font-medium transition-all ${activeTab === 'monitor' && !inspectedSession
                ? 'bg-indigo-600 text-slate-100 shadow-md shadow-indigo-600/25'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
            >
              <LayoutDashboard className="h-5 w-5" />
              <span>Real-Time Monitor</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('fleet');
                setInspectedSession(null);
              }}
              className={`w-full flex items-center space-x-3 py-3 px-4 rounded-xl text-sm font-medium transition-all ${activeTab === 'fleet'
                ? 'bg-indigo-600 text-slate-100 shadow-md shadow-indigo-600/25'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
            >
              <Plane className="h-5 w-5" />
              <span>My Drones</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('logs');
                setInspectedSession(null);
              }}
              className={`w-full flex items-center space-x-3 py-3 px-4 rounded-xl text-sm font-medium transition-all ${activeTab === 'logs' || inspectedSession
                ? 'bg-indigo-600 text-slate-100 shadow-md shadow-indigo-600/25'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
            >
              <History className="h-5 w-5" />
              <span>Flight History Logs</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('alerts');
                setInspectedSession(null);
              }}
              className={`w-full flex items-center space-x-3 py-3 px-4 rounded-xl text-sm font-medium transition-all ${activeTab === 'alerts'
                ? 'bg-indigo-600 text-slate-100 shadow-md shadow-indigo-600/25'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
            >
              <div className="relative">
                <AlertTriangle className="h-5 w-5" />
                {alerts.filter((a) => !a.resolved).length > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></span>
                )}
              </div>
              <span>Safety Alerts</span>
            </button>
          </nav>
        </div>

        {/* Log Out */}
        <div className="p-4 border-t border-slate-900">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center space-x-2 py-3 px-4 border border-slate-800 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 hover:border-red-500/30 transition-all cursor-pointer"
          >
            <LogOut className="h-5 w-5" />
            <span>Secure Log Out</span>
          </button>
        </div>
      </aside>

      {/* Main Panel Content Area */}
      <main className="flex-1 flex flex-col min-h-screen bg-slate-950/65 overflow-y-auto">

        {/* Top Header stats aggregations */}
        {stats && (
          <header className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 px-4 md:px-8 py-4 md:py-6 border-b border-slate-900 bg-slate-900/10 backdrop-blur shrink-0">
            <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-2xl flex items-center space-x-4">
              <Plane className="h-10 w-10 text-indigo-400 bg-indigo-500/10 p-2 rounded-xl" />
              <div>
                <p className="text-xs font-semibold text-slate-400">Total Drones</p>
                <p className="text-xl font-bold">{stats.totalDrones}</p>
              </div>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-2xl flex items-center space-x-4">
              <Activity className="h-10 w-10 text-emerald-400 bg-emerald-500/10 p-2 rounded-xl" />
              <div>
                <p className="text-xs font-semibold text-slate-400">Active Sessions</p>
                <p className="text-xl font-bold">{stats.activeDrones}</p>
              </div>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-2xl flex items-center space-x-4">
              <History className="h-10 w-10 text-sky-400 bg-sky-500/10 p-2 rounded-xl" />
              <div>
                <p className="text-xs font-semibold text-slate-400">Completed Sessions</p>
                <p className="text-xl font-bold">{stats.completedSessions}</p>
              </div>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-2xl flex items-center space-x-4">
              <Navigation className="h-10 w-10 text-purple-400 bg-purple-500/10 p-2 rounded-xl" />
              <div>
                <p className="text-xs font-semibold text-slate-400">Total Distance</p>
                <p className="text-xl font-bold">{stats.totalDistanceKm} km</p>
              </div>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 p-4 rounded-2xl flex items-center space-x-4 col-span-2 md:col-span-1 lg:col-span-1">
              <AlertTriangle className="h-10 w-10 text-red-400 bg-red-500/10 p-2 rounded-xl" />
              <div>
                <p className="text-xs font-semibold text-slate-400">Active Warnings</p>
                <p className="text-xl font-bold text-red-400">{stats.activeAlerts}</p>
              </div>
            </div>
          </header>
        )}

        <div className="flex-1 p-4 md:p-8 flex flex-col">

          {/* TAB 1: REAL-TIME MONITOR */}
          {activeTab === 'monitor' && !inspectedSession && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8">

              {/* Left Column: Map & Controls */}
              <div className="col-span-1 lg:col-span-8 flex flex-col space-y-6">

                <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-900/25 border border-slate-900 p-4 rounded-2xl backdrop-blur gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                    <div className="flex items-center space-x-3">
                      <Plane className="h-6 w-6 text-indigo-400 shrink-0" />
                      <span className="font-semibold text-sm whitespace-nowrap">Select Drone:</span>
                    </div>
                    <select
                      value={selectedDroneId || ''}
                      onChange={(e) => setSelectedDroneId(e.target.value || null)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full sm:w-auto"
                    >
                      {drones.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.model}) {d.isOnline ? '[Online]' : '[Offline]'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedDrone && (
                    <div className="flex space-x-2 shrink-0 w-full sm:w-auto justify-end sm:justify-start">
                      <span className={`px-3 py-1.5 rounded-xl text-xs font-bold ${selectedDrone.status === 'IDLE' ? 'bg-slate-800 text-slate-400' :
                        selectedDrone.status === 'FLYING' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          selectedDrone.status === 'RETURNING' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            selectedDrone.status === 'EMERGENCY' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                              'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                        }`}>
                        STATUS: {selectedDrone.status}
                      </span>
                    </div>
                  )}
                </div>

                {/* Map Display Panel */}
                <div className="h-[450px] shrink-0 relative">
                  <MapPanel
                    drones={drones}
                    selectedDroneId={selectedDroneId}
                    waypoints={waypoints}
                    onMapClick={handleMapClick}
                  />
                </div>

                {/* Mission Waypoints Designer & Controls */}
                {selectedDrone && (
                  <div className="bg-slate-900/25 border border-slate-900 p-6 rounded-2xl backdrop-blur space-y-4">
                    <h3 className="text-base font-semibold">Session Design & Command Center</h3>

                    {selectedDrone.status === 'IDLE' ? (
                      <div className="space-y-4">
                        {waypoints.length === 0 ? (
                          <div className="p-6 bg-indigo-950/15 border border-indigo-900/30 rounded-2xl flex flex-col space-y-3 text-left">
                            <div className="flex items-center space-x-2 text-indigo-400">
                              <Navigation className="h-5 w-5 animate-pulse" />
                              <span className="font-bold text-xs uppercase tracking-wider text-left">Flight Session Map Planner</span>
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              To define a session route, <strong>click directly on the interactive map above</strong> to drop sequential waypoint pins (Pin #1, Pin #2, etc.). Once placed, configure target parameters inside the checklist before dispatching.
                            </p>

                            {/* Safety limits parameters */}
                            <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-3 space-y-2">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Takeoff Safety Thresholds:</p>
                              <div className="grid grid-cols-3 gap-4 text-[11px]">
                                <div>
                                  <p className="text-slate-500">Max Geofence</p>
                                  <p className="font-semibold text-indigo-300">300 meters</p>
                                </div>
                                <div>
                                  <p className="text-slate-500">Max Altitude</p>
                                  <p className="font-semibold text-indigo-300">50 meters</p>
                                </div>
                                <div>
                                  <p className="text-slate-500">Max Speed</p>
                                  <p className="font-semibold text-indigo-300">12 m/s</p>
                                </div>
                              </div>
                            </div>

                            {!selectedDrone.isOnline ? (
                              <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-3 flex items-start space-x-2.5 text-[11px] text-red-200 leading-normal text-left">
                                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold">Drone is offline:</span> Please check the power state and hardware signal of the drone to enable map navigation routing.
                                </div>
                              </div>
                            ) : (
                              <div className="pt-1 text-[10px] text-indigo-400/90 font-semibold uppercase tracking-widest flex items-center space-x-1.5">
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-ping"></span>
                                <span>Awaiting Map Clicks...</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-slate-950/80 border border-slate-900 rounded-xl p-4 flex flex-col space-y-4">
                            {!selectedDrone.isOnline && (
                              <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-3 flex items-start space-x-2.5 text-[11px] text-red-200 leading-normal text-left">
                                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold">Drone is offline:</span> Please verify connection to allow waypoint dispatching.
                                </div>
                              </div>
                            )}
                            <p className="text-xs font-semibold text-slate-400">Waypoint Checklist & Direct Settings:</p>

                            <div className="flex flex-col space-y-2 max-h-60 overflow-y-auto pr-1">
                              {waypoints.map((wp, idx) => (
                                <div key={idx} className="bg-slate-900 border border-slate-800 text-xs px-3.5 py-2.5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:space-x-4">
                                  <div className="flex items-center space-x-3 overflow-hidden">
                                    <span className="font-bold text-indigo-400 shrink-0">#{idx + 1}</span>
                                    <span className="font-mono text-slate-400 text-[11px] truncate">
                                      ({wp.latitude.toFixed(5)}, {wp.longitude.toFixed(5)})
                                    </span>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                                    {/* Altitude Setting */}
                                    <div className="flex items-center space-x-1">
                                      <span className="text-[10px] text-slate-500 font-medium">Altitude:</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="50"
                                        onKeyDown={(e) => {
                                          if (e.key === '-' || e.key === 'e') e.preventDefault();
                                        }}
                                        value={wp.altitude}
                                        onChange={(e) => handleUpdateWaypoint(idx, 'altitude', e.target.value)}
                                        className="w-12 px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded text-slate-100 text-xs text-center focus:ring-1 focus:ring-indigo-500 outline-none"
                                      />
                                      <span className="text-[10px] text-slate-500">m</span>
                                    </div>

                                    {/* Speed Setting */}
                                    <div className="flex items-center space-x-1">
                                      <span className="text-[10px] text-slate-500 font-medium">Speed:</span>
                                      <input
                                        type="number"
                                        min="0"
                                        max="12"
                                        onKeyDown={(e) => {
                                          if (e.key === '-' || e.key === 'e') e.preventDefault();
                                        }}
                                        value={wp.speed}
                                        onChange={(e) => handleUpdateWaypoint(idx, 'speed', e.target.value)}
                                        className="w-12 px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded text-slate-100 text-xs text-center focus:ring-1 focus:ring-indigo-500 outline-none"
                                      />
                                      <span className="text-[10px] text-slate-500">m/s</span>
                                    </div>

                                    {/* Delete Button */}
                                    <button
                                      onClick={() => handleDeleteWaypoint(idx)}
                                      className="text-red-400 hover:text-red-300 p-1 rounded-lg hover:bg-red-500/10 transition-all cursor-pointer"
                                      title="Delete Waypoint"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="flex items-center justify-between border-t border-slate-900 pt-3">
                              <button
                                onClick={() => setWaypoints([])}
                                className="text-[10px] text-red-400 hover:text-red-300 font-semibold uppercase tracking-wider cursor-pointer"
                              >
                                Clear Route Checklist
                              </button>

                              <button
                                disabled={!selectedDrone.isOnline}
                                onClick={handleDispatch}
                                className="flex items-center space-x-1.5 py-2 px-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-indigo-600/15"
                              >
                                <Navigation className="h-4 w-4" />
                                <span>{selectedDrone.isOnline ? 'Dispatch Session' : 'Drone Offline'}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      // Active overrides during flight
                      <div className="space-y-4">
                        <div className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-xl text-xs text-indigo-200">
                          Drone is currently executing flight tasks. You can send immediate override telemetry instructions.
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <button
                            onClick={() => handleOverride('RETURN_TO_BASE')}
                            className="py-3 px-4 bg-amber-600 hover:bg-amber-500 font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-amber-600/15"
                          >
                            Return to Base
                          </button>
                          <button
                            onClick={() => handleOverride('LAND')}
                            className="py-3 px-4 bg-sky-600 hover:bg-sky-500 font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-sky-600/15"
                          >
                            Land in Place
                          </button>
                          <button
                            onClick={() => handleOverride('EMERGENCY_LAND')}
                            className="py-3 px-4 bg-red-600 hover:bg-red-500 font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-red-600/15 animate-pulse"
                          >
                            Emergency Land
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Live Status & Charts */}
              <div className="col-span-1 lg:col-span-4 flex flex-col space-y-6">

                {/* Live parameters cards */}
                {selectedDrone && (
                  <div className="grid grid-cols-2 gap-4 shrink-0">
                    <div className="bg-slate-900/25 border border-slate-900 p-4 rounded-2xl flex items-center space-x-3">
                      <Battery className={`h-6 w-6 shrink-0 ${selectedDrone.batteryLevel < 20 ? 'text-red-500 animate-bounce' : 'text-emerald-400'}`} />
                      <div className="overflow-hidden">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Battery</p>
                        <p className="text-sm font-bold truncate">{selectedDrone.batteryLevel}%</p>
                      </div>
                    </div>
                    <div className="bg-slate-900/25 border border-slate-900 p-4 rounded-2xl flex items-center space-x-3">
                      <Flame className={`h-6 w-6 shrink-0 ${selectedDrone.currentAltitude && selectedDrone.currentAltitude > 0 && selectedDrone.batteryLevel < 100 && selectedDrone.status !== 'IDLE' ? 'text-amber-500' : 'text-slate-400'}`} />
                      <div className="overflow-hidden">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Engine Temp</p>
                        <p className="text-sm font-bold truncate">
                          {liveHistory.length > 0 ? `${liveHistory[liveHistory.length - 1].temperature}°C` : '25.0°C'}
                        </p>
                      </div>
                    </div>
                    <div className="bg-slate-900/25 border border-slate-900 p-4 rounded-2xl flex items-center space-x-3">
                      <Radio className="h-6 w-6 text-sky-400 shrink-0" />
                      <div className="overflow-hidden">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Signal Strength</p>
                        <p className="text-sm font-bold truncate">
                          {liveHistory.length > 0 ? `${liveHistory[liveHistory.length - 1].signalStrength} dBm` : '-30 dBm'}
                        </p>
                      </div>
                    </div>
                    <div className="bg-slate-900/25 border border-slate-900 p-4 rounded-2xl flex items-center space-x-3">
                      <Navigation className="h-6 w-6 text-indigo-400 shrink-0" />
                      <div className="overflow-hidden">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Altitude</p>
                        <p className="text-sm font-bold truncate">{selectedDrone.currentAltitude || 0.0} m</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Telemetry charts */}
                <div className="bg-slate-900/25 border border-slate-900 p-6 rounded-2xl backdrop-blur flex flex-col space-y-6 h-[340px] shrink-0">
                  <div>
                    <h3 className="text-sm font-semibold mb-3">Altitude Profile (meters)</h3>
                    <div className="h-28 w-full">
                      {liveHistory.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={liveHistory}>
                            <defs>
                              <linearGradient id="colorAlt" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="time" hide />
                            <YAxis hide />
                            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '10px' }} />
                            <Area type="monotone" dataKey="altitude" stroke="#6366f1" fillOpacity={1} fill="url(#colorAlt)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="w-full h-full bg-slate-950/40 rounded-xl flex items-center justify-center text-xs text-slate-500">
                          Waiting for live flight data...
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-3">Speed Vector (m/s)</h3>
                    <div className="h-28 w-full">
                      {liveHistory.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={liveHistory}>
                            <defs>
                              <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="time" hide />
                            <YAxis hide />
                            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '10px' }} />
                            <Area type="monotone" dataKey="speed" stroke="#10b981" fillOpacity={1} fill="url(#colorSpeed)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="w-full h-full bg-slate-950/40 rounded-xl flex items-center justify-center text-xs text-slate-500">
                          Waiting for live flight data...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DRONE FLEET */}
          {activeTab === 'fleet' && (
            <div className="space-y-6">

              {/* Register drone form (Admin only) */}
              {user.role === 'ADMIN' && (
                <div className="bg-slate-900/25 border border-slate-900 p-6 rounded-2xl backdrop-blur">
                  <h3 className="text-base font-semibold mb-4">Register New Drone</h3>
                  <form onSubmit={handleCreateDrone} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <input
                      type="text"
                      required
                      placeholder="Drone Name (e.g. Gamma Scout)"
                      value={newDroneName}
                      onChange={(e) => setNewDroneName(e.target.value)}
                      className="px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Serial Number (e.g. SN-GAMMA444)"
                      value={newDroneSN}
                      onChange={(e) => setNewDroneSN(e.target.value)}
                      className="px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Model (e.g. DJI Inspire 3)"
                      value={newDroneModel}
                      onChange={(e) => setNewDroneModel(e.target.value)}
                      className="px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                    />
                    <button
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center space-x-2 text-sm transition-all cursor-pointer shadow-lg shadow-indigo-600/15"
                    >
                      <Plus className="h-5 w-5" />
                      <span>Provision Drone</span>
                    </button>
                  </form>
                </div>
              )}

              {/* Drones list table */}
              <div className="bg-slate-900/25 border border-slate-900 rounded-2xl overflow-x-auto backdrop-blur">
                <table className="min-w-full divide-y divide-slate-900">
                  <thead className="bg-slate-900/35">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Drone Name</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Model</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Serial Number</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Battery</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Last Coordinates</th>
                      {user.role === 'ADMIN' && (
                        <th className="px-6 py-4 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900">
                    {drones.map((drone) => (
                      <tr key={drone.id} className="hover:bg-slate-900/10 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{drone.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">{drone.model}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-indigo-400">{drone.serialNumber}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${drone.status === 'IDLE' ? 'bg-slate-800 text-slate-400' :
                            drone.status === 'FLYING' ? 'bg-emerald-500/15 text-emerald-400' :
                              drone.status === 'RETURNING' ? 'bg-amber-500/15 text-amber-400' :
                                drone.status === 'EMERGENCY' ? 'bg-red-500/20 text-red-400' :
                                  'bg-sky-500/15 text-sky-400'
                            }`}>
                            {drone.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">
                          <div className="flex items-center space-x-1.5">
                            <div className="w-1.5 h-3 bg-emerald-400 rounded-sm"></div>
                            <span>{drone.batteryLevel}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-400">
                          {drone.currentLatitude && drone.currentLongitude
                            ? `(${drone.currentLatitude.toFixed(5)}, ${drone.currentLongitude.toFixed(5)})`
                            : 'N/A'}
                        </td>
                        {user.role === 'ADMIN' && (
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            {drone.id !== 'drone-alpha-111' && drone.id !== 'drone-beta-222' ? (
                              <button
                                onClick={() => handleDeleteDrone(drone.id)}
                                className="text-red-400 hover:text-red-300 p-2 rounded-lg hover:bg-red-500/10 transition-all cursor-pointer"
                              >
                                <Trash2 className="h-5 w-5" />
                              </button>
                            ) : (
                              <span className="text-xs text-slate-500">Locked System</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: FLIGHT LOGS (SESSION HISTORY) */}
          {(activeTab === 'logs' || inspectedSession) && (
            <div className="flex-1 flex flex-col space-y-6">

              {!inspectedSession ? (
                <div className="bg-slate-900/25 border border-slate-900 rounded-2xl flex flex-col overflow-hidden backdrop-blur">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-900">
                      <thead className="bg-slate-900/35">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Drone</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Pilot</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Start Time</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Distance</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Speed</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Battery Used</th>
                          <th className="px-6 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Inspect Flight</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900">
                        {paginatedSessions.map((session) => (
                          <tr key={session.id} className="hover:bg-slate-900/10 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{session.drone?.name || 'Unknown'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">{session.pilot?.name || 'Auto-Dispatch'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                              {new Date(session.startTime).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${session.status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-indigo-500/15 text-indigo-400'
                                }`}>
                                {session.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{session.distanceTraveled} km</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">{session.avgSpeed} m/s</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">{session.batteryConsumed}%</td>
                            <td className="px-6 py-4 whitespace-nowrap text-right">
                              <button
                                onClick={() => handleInspectSession(session)}
                                className="text-indigo-400 hover:text-indigo-300 font-semibold text-xs tracking-wide cursor-pointer hover:underline"
                              >
                                Review track path
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 bg-slate-900/35 border-t border-slate-900 rounded-b-2xl gap-4">
                    <div className="text-xs text-slate-400 text-center sm:text-left">
                      Showing <span className="font-semibold text-slate-200">{sessions.length === 0 ? 0 : logsStartIndex + 1}</span> to{' '}
                      <span className="font-semibold text-slate-200">{Math.min(logsStartIndex + ITEMS_PER_PAGE, sessions.length)}</span> of{' '}
                      <span className="font-semibold text-slate-200">{sessions.length}</span> flights
                    </div>
                    <div className="flex items-center justify-between sm:justify-end space-x-2 w-full sm:w-auto">
                      <button
                        onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                        disabled={currentLogsPage === 1}
                        className="py-1 px-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-all cursor-pointer"
                      >
                        Previous
                      </button>
                      <span className="text-xs text-slate-400 px-2">
                        Page <span className="font-semibold text-slate-200">{currentLogsPage}</span> of <span className="font-semibold text-slate-200">{totalLogsPages}</span>
                      </span>
                      <button
                        onClick={() => setLogsPage((p) => Math.min(totalLogsPages, p + 1))}
                        disabled={currentLogsPage === totalLogsPages}
                        className="py-1 px-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-all cursor-pointer"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                // Detailed inspector panel for a single flight session
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="col-span-1 lg:col-span-8 flex flex-col space-y-4">
                    <div className="flex justify-between items-center bg-slate-900/25 border border-slate-900 p-4 rounded-2xl backdrop-blur shrink-0">
                      <div>
                        <h3 className="text-base font-semibold">Inspecting Flight session</h3>
                        <p className="text-xs text-slate-400">ID: {inspectedSession.id}</p>
                      </div>
                      <button
                        onClick={() => {
                          setInspectedSession(null);
                          setInspectedSessionTrack([]);
                        }}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 font-semibold rounded-xl text-xs transition-all cursor-pointer"
                      >
                        Back to List
                      </button>
                    </div>

                    {/* Historical path playback map */}
                    <div className="h-[450px] shrink-0">
                      <MapPanel
                        drones={[]}
                        selectedDroneId={null}
                        waypoints={[]}
                        historicalTrack={inspectedSessionTrack}
                      />
                    </div>
                  </div>

                  {/* Summary analytics cards */}
                  <div className="col-span-1 lg:col-span-4 bg-slate-900/25 border border-slate-900 p-6 rounded-2xl backdrop-blur flex flex-col space-y-6">
                    <h3 className="text-base font-semibold">Post-Flight Analytics Summary</h3>

                    <div className="space-y-4">
                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-900">
                        <p className="text-[10px] text-slate-400 uppercase font-semibold">Drone Details</p>
                        <p className="text-sm font-semibold">{inspectedSession.drone?.name}</p>
                        <p className="text-xs text-slate-500">Model: {inspectedSession.drone?.model}</p>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-900">
                        <p className="text-[10px] text-slate-400 uppercase font-semibold">Total Distance Flown</p>
                        <p className="text-lg font-extrabold text-indigo-400">{inspectedSession.distanceTraveled} km</p>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-900">
                        <p className="text-[10px] text-slate-400 uppercase font-semibold">Peak Cruise Altitude</p>
                        <p className="text-lg font-extrabold text-indigo-400">{inspectedSession.maxAltitude} meters</p>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-900">
                        <p className="text-[10px] text-slate-400 uppercase font-semibold">Average Cruising Speed</p>
                        <p className="text-lg font-extrabold text-indigo-400">{inspectedSession.avgSpeed} m/s</p>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-900">
                        <p className="text-[10px] text-slate-400 uppercase font-semibold">Battery Depleted</p>
                        <p className="text-lg font-extrabold text-indigo-400">{inspectedSession.batteryConsumed}%</p>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-900">
                        <p className="text-[10px] text-slate-400 uppercase font-semibold">Flight Dispatcher</p>
                        <p className="text-sm font-semibold">{inspectedSession.pilot?.name || 'Auto-Pilot Schedule'}</p>
                        <p className="text-xs text-slate-500">{inspectedSession.pilot?.email || 'System Default'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SYSTEM ALERTS */}
          {activeTab === 'alerts' && (
            <div className="bg-slate-900/25 border border-slate-900 rounded-2xl overflow-x-auto backdrop-blur flex-1">
              <table className="min-w-full divide-y divide-slate-900">
                <thead className="bg-slate-900/35">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Drone</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Alert Type</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Severity</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Message</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Time Detected</th>
                    <th className="px-6 py-4 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {alerts.map((alert) => (
                    <tr key={alert.id} className="hover:bg-slate-900/10 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{alert.drone?.name || 'Unknown'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-red-400 font-bold">{alert.type}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${alert.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-amber-500/15 text-amber-400'
                          }`}>
                          {alert.severity}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-300">{alert.message}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                        {new Date(alert.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${alert.resolved ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                          }`}>
                          {alert.resolved ? 'RESOLVED' : 'ACTIVE'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
