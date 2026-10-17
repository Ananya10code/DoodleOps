<<<<<<< HEAD
import { useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import Whiteboard from './components/Whiteboard';
import { uuid } from './utils';

const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

function NewBoard() {
  const id = useMemo(() => uuid().slice(0, 8), []);
  return <Navigate to={`/board/${id}`} replace />;
}

function BoardRoute() {
  const { roomId } = useParams();
  if (!roomId || !ROOM_ID.test(roomId)) return <Navigate to="/" replace />;
  return <Whiteboard key={roomId} boardId={roomId} />;
}
=======
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Whiteboard } from './components/Whiteboard';

const WhiteboardRoomWrapper = () => {
  const { roomId } = useParams<{ roomId: string }>();
  return <Whiteboard boardId={roomId || 'default-room'} />;
};
>>>>>>> abdebd9583869536fbbcb39e4385065772fbe0f7

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
<<<<<<< HEAD
        <Route path="/" element={<NewBoard />} />
        <Route path="/board/:roomId" element={<BoardRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
=======
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
>>>>>>> abdebd9583869536fbbcb39e4385065772fbe0f7
