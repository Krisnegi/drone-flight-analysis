import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Drone, Waypoint, TelemetryLog } from '../types';

// Drone Icon SVG Markup
const droneSvg = (status: string) => {
  let color = 'text-indigo-400';
  if (status === 'FLYING') color = 'text-emerald-400';
  if (status === 'RETURNING') color = 'text-amber-400';
  if (status === 'LANDING') color = 'text-sky-400';
  if (status === 'EMERGENCY') color = 'text-red-500 animate-bounce';
  
  return `
    <div class="relative flex items-center justify-center">
      <div class="absolute w-10 h-10 bg-slate-900/80 rounded-full border border-slate-700/50 shadow-lg -z-10"></div>
      <svg class="w-7 h-7 ${color} fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 16h-2v-2h2v2zm0-4h-2V7h2v7z"/>
      </svg>
    </div>
  `;
};

const createDroneIcon = (status: string) => {
  return L.divIcon({
    html: droneSvg(status),
    className: 'custom-drone-icon',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

const waypointIcon = (index: number) => {
  return L.divIcon({
    html: `<div class="w-6 h-6 bg-indigo-500 border-2 border-slate-100 rounded-full flex items-center justify-center text-[10px] text-slate-100 font-extrabold shadow-md shadow-slate-950/40">${index + 1}</div>`,
    className: 'custom-waypoint-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

const baseStationIcon = L.divIcon({
  html: `<div class="w-8 h-8 bg-slate-900 border border-slate-700 rounded-xl flex items-center justify-center text-xs text-indigo-400 font-extrabold shadow-lg">📡</div>`,
  className: 'custom-base-icon',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// Center Base Coordinate
const BASE_LAT = 12.971598;
const BASE_LNG = 77.594562;

interface MapPanelProps {
  drones: Drone[];
  selectedDroneId: string | null;
  waypoints: Waypoint[];
  onMapClick?: (lat: number, lng: number) => void;
  historicalTrack?: TelemetryLog[];
  isPlaybackActive?: boolean;
}

// Click handler map utility
const MapClickHandler: React.FC<{ onClick?: (lat: number, lng: number) => void }> = ({ onClick }) => {
  useMapEvents({
    click(e) {
      if (onClick) {
        onClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
};

// Map center adjuster utility
const MapFocusController: React.FC<{ lat: number; lng: number }> = ({ lat, lng }) => {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
};

export const MapPanel: React.FC<MapPanelProps> = ({
  drones,
  selectedDroneId,
  waypoints,
  onMapClick,
  historicalTrack = [],
}) => {
  // Determine center focus coordinates
  let mapCenterLat = BASE_LAT;
  let mapCenterLng = BASE_LNG;

  const selectedDrone = drones.find((d) => d.id === selectedDroneId);
  if (selectedDrone?.currentLatitude && selectedDrone?.currentLongitude) {
    mapCenterLat = selectedDrone.currentLatitude;
    mapCenterLng = selectedDrone.currentLongitude;
  } else if (historicalTrack.length > 0) {
    mapCenterLat = historicalTrack[0].latitude;
    mapCenterLng = historicalTrack[0].longitude;
  }

  // Format Polylines path positions
  const waypointPositions = waypoints.map((wp) => [wp.latitude, wp.longitude] as [number, number]);
  const historicalPositions = historicalTrack.map((log) => [log.latitude, log.longitude] as [number, number]);

  return (
    <div className="w-full h-full relative border border-slate-800/80 rounded-2xl overflow-hidden shadow-inner">
      <MapContainer
        center={[mapCenterLat, mapCenterLng]}
        zoom={16}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" // Modern Sleek Dark Map tiles
        />

        {/* Focus centering handler */}
        <MapFocusController lat={mapCenterLat} lng={mapCenterLng} />

        {/* Base Station Marker */}
        <Marker position={[BASE_LAT, BASE_LNG]} icon={baseStationIcon}>
          <Popup>
            <div className="text-xs font-sans text-slate-800">
              <p className="font-bold">Operational Base Station</p>
              <p className="text-slate-500">Center reference for geofencing alarms (300m limits)</p>
            </div>
          </Popup>
        </Marker>

        {/* Map click listener to add waypoints */}
        {onMapClick && <MapClickHandler onClick={onMapClick} />}

        {/* Active Drones Markers */}
        {drones.map((drone) => {
          if (!drone.currentLatitude || !drone.currentLongitude) return null;
          return (
            <Marker
              key={drone.id}
              position={[drone.currentLatitude, drone.currentLongitude]}
              icon={createDroneIcon(drone.status)}
            >
              <Popup>
                <div className="text-xs font-sans text-slate-800">
                  <p className="font-bold text-slate-900">{drone.name}</p>
                  <p className="text-slate-500">Model: {drone.model}</p>
                  <p className="text-slate-500">Status: <span className="font-bold">{drone.status}</span></p>
                  <p className="text-slate-500">Battery: <span className="font-bold">{drone.batteryLevel}%</span></p>
                  {drone.currentAltitude !== null && (
                    <p className="text-slate-500">Altitude: <span className="font-bold">{drone.currentAltitude}m</span></p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Planned Mission Waypoints */}
        {waypoints.map((wp, idx) => (
          <Marker
            key={`wp-${idx}`}
            position={[wp.latitude, wp.longitude]}
            icon={waypointIcon(idx)}
          >
            <Popup>
              <div className="text-xs font-sans text-slate-800">
                <p className="font-bold text-indigo-600">Waypoint #{idx + 1}</p>
                <p>Altitude: {wp.altitude}m</p>
                <p>Speed: {wp.speed}m/s</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Dotted path for planned waypoints */}
        {waypointPositions.length > 0 && (
          <Polyline
            positions={waypointPositions}
            pathOptions={{ color: '#6366f1', dashArray: '8, 8', weight: 3 }}
          />
        )}

        {/* Solid path for historical track rendering */}
        {historicalPositions.length > 0 && (
          <Polyline
            positions={historicalPositions}
            pathOptions={{ color: '#10b981', weight: 4 }}
          />
        )}
      </MapContainer>

      {/* Floating map hint overlay */}
      {onMapClick && (
        <div className="absolute top-4 right-4 bg-slate-900/90 border border-slate-800 backdrop-blur px-3 py-1.5 rounded-lg z-[1000] text-xs text-slate-300 pointer-events-none shadow-md">
          🖱 Click on the map to define waypoints
        </div>
      )}
    </div>
  );
};
