import { Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Room from './pages/Room.jsx';
import StatusScreen from './components/StatusScreen.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/room/:code" element={<Room />} />
      <Route path="*" element={<StatusScreen emoji="🧭" title="Page not found">There is nothing here.</StatusScreen>} />
    </Routes>
  );
}
