import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Whiteboard } from './components/Whiteboard';

const WhiteboardRoomWrapper = () => {
  const { roomId } = useParams<{ roomId: string }>();
  return <Whiteboard boardId={roomId || 'default-room'} />;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* If user hits "/", automatically generate a random room and redirect */}
        <Route
          path="/"
          element={<Navigate to={`/board/${uuidv4().slice(0, 8)}`} replace />}
        />
        {/* Dynamic Room URL */}
        <Route path="/board/:roomId" element={<WhiteboardRoomWrapper />} />
      </Routes>
    </BrowserRouter>
  );
}