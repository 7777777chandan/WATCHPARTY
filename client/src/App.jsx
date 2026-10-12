import { useEffect, useState } from 'react';
import { socket } from './socket';

export default function App() {
  const [id, setId] = useState(null);
  useEffect(() => {
    const onConnect = () => setId(socket.id);
    const onDisconnect = () => setId(null);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.disconnect();
    };
  }, []);
  return <main>{id ? `Connected (socket id: ${id})` : 'Disconnected'}</main>;
}
