import { createContext, useContext, useEffect, useState } from 'react';
import { socket } from '../socket.js';
import { useClockSyncService } from '../hooks/useClockSync.js';

const SocketContext = createContext(null);

/** One shared socket for the whole app plus its connection status. */
export function SocketProvider({ children }) {
  const [connected, setConnected] = useState(socket.connected);
  const [everConnected, setEverConnected] = useState(socket.connected);
  useClockSyncService(socket);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setEverConnected(true);
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return <SocketContext.Provider value={{ socket, connected, everConnected }}>{children}</SocketContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside <SocketProvider>');
  return ctx;
}
