import React, { useEffect, useState, useRef } from 'react';
import { Stage, Layer, Line, Rect, Circle, Text as KonvaText } from 'react-konva';
import { v4 as uuidv4 } from 'uuid';
import { socketService } from '../services/websocket';
import type { ElementPayload, CursorPayload } from '../services/websocket';

const CURRENT_USER_ID = uuidv4().slice(0, 6);
const USER_COLOR = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

export const Whiteboard: React.FC<{ boardId: string }> = ({ boardId }) => {
    const [elements, setElements] = useState<ElementPayload[]>([]);
    const [cursors, setCursors] = useState<Record<string, CursorPayload>>({});
    const [tool, setTool] = useState<'select' | 'stroke' | 'rect' | 'circle' | 'sticky'>('select');
    const [color, setColor] = useState('#2563eb');
    const [strokeWidth, setStrokeWidth] = useState(3);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Pan & Zoom state
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
    const [stageScale, setStageScale] = useState(1);

    const stageRef = useRef<any>(null);
    const isDrawing = useRef(false);
    const activeElementId = useRef<string | null>(null);

    // Helper to convert screen mouse coordinates to virtual canvas coordinates
    const getTransformedPointerPosition = () => {
        const stage = stageRef.current;
        if (!stage) return null;
        const pointer = stage.getPointerPosition();
        if (!pointer) return null;

        return {
            x: (pointer.x - stage.x()) / stage.scaleX(),
            y: (pointer.y - stage.y()) / stage.scaleY(),
        };
    };

    // 1. Initial Load from MySQL & Connect WebSockets
    useEffect(() => {
        fetch(`http://localhost:8081/api/boards/${boardId}/elements`)
            .then((res) => res.json())
            .then((data: any[]) => {
                const loaded: ElementPayload[] = data.map((d) => ({
                    action: 'CREATE',
                    id: d.id,
                    boardId: d.boardId,
                    type: d.type,
                    x: d.x ?? 0,
                    y: d.y ?? 0,
                    width: d.width,
                    height: d.height,
                    strokeColor: d.strokeColor,
                    fillColor: d.fillColor,
                    strokeWidth: d.strokeWidth,
                    zIndex: d.zIndex,
                    payload: d.payload,
                }));
                setElements(loaded);
            })
            .catch((err) => console.error('Error fetching elements:', err));

        socketService.connect(
            boardId,
            (remoteCursor) => {
                if (remoteCursor.userId === CURRENT_USER_ID) return;
                setCursors((prev) => ({
                    ...prev,
                    [remoteCursor.userId]: {
                        ...remoteCursor,
                        lastSeen: Date.now(),
                    } as any,
                }));
            },
            (remoteElement) => {
                setElements((prev) => {
                    const filtered = prev.filter((el) => el.id !== remoteElement.id);
                    if (remoteElement.action === 'DELETE') return filtered;
                    return [...filtered, remoteElement];
                });
            }
        );

        return () => socketService.disconnect();
    }, [boardId]);

    // 2. Keyboard listener for Delete / Backspace
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
                const toDelete = elements.find((el) => el.id === selectedId);
                if (toDelete) {
                    const deletePayload: ElementPayload = {
                        ...toDelete,
                        action: 'DELETE',
                    };
                    setElements((prev) => prev.filter((el) => el.id !== selectedId));
                    socketService.sendElement(boardId, deletePayload);
                    setSelectedId(null);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, elements, boardId]);

    // Clean up inactive cursors
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            setCursors((prev) => {
                let changed = false;
                const next = { ...prev };
                for (const [id, user] of Object.entries(next)) {
                    if ((user as any).lastSeen && now - (user as any).lastSeen > 8000) {
                        delete next[id];
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }, 2000);

        return () => clearInterval(timer);
    }, []);

    // 3. Zoom with Mouse Wheel
    const handleWheel = (e: any) => {
        e.evt.preventDefault();
        const scaleBy = 1.05;
        const stage = stageRef.current;
        if (!stage) return;

        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
        const clampedScale = Math.max(0.1, Math.min(newScale, 5));

        setStageScale(clampedScale);
        setStagePos({
            x: pointer.x - mousePointTo.x * clampedScale,
            y: pointer.y - mousePointTo.y * clampedScale,
        });
    };

    // 4. Mouse Down / Start Drawing or Placing Shapes
    const handleMouseDown = (e: any) => {
        if (tool === 'select') {
            if (e.target === e.target.getStage()) {
                setSelectedId(null);
            }
            return;
        }

        const pos = getTransformedPointerPosition();
        if (!pos) return;

        const newId = uuidv4();
        activeElementId.current = newId;

        if (tool === 'sticky') {
            const newSticky: ElementPayload = {
                action: 'CREATE',
                id: newId,
                boardId,
                type: 'sticky' as any,
                x: pos.x - 80,
                y: pos.y - 80,
                width: 160,
                height: 160,
                strokeColor: '#eab308',
                fillColor: '#fef08a',
                strokeWidth: 1,
                zIndex: elements.length + 1,
                payload: 'Double click to edit note',
            };
            setElements((prev) => [...prev, newSticky]);
            socketService.sendElement(boardId, newSticky);
            activeElementId.current = null;
            return;
        }

        isDrawing.current = true;

        if (tool === 'stroke') {
            const newStroke: ElementPayload = {
                action: 'CREATE',
                id: newId,
                boardId,
                type: 'stroke',
                x: 0,
                y: 0,
                strokeColor: color,
                strokeWidth: strokeWidth,
                zIndex: elements.length + 1,
                payload: JSON.stringify([pos.x, pos.y]),
            };
            setElements((prev) => [...prev, newStroke]);
        } else if (tool === 'rect') {
            const newRect: ElementPayload = {
                action: 'CREATE',
                id: newId,
                boardId,
                type: 'rect',
                x: pos.x,
                y: pos.y,
                width: 1,
                height: 1,
                strokeColor: color,
                strokeWidth: strokeWidth,
                zIndex: elements.length + 1,
            };
            setElements((prev) => [...prev, newRect]);
        } else if (tool === 'circle') {
            const newCircle: ElementPayload = {
                action: 'CREATE',
                id: newId,
                boardId,
                type: 'circle' as any,
                x: pos.x,
                y: pos.y,
                width: 1,
                height: 1,
                strokeColor: color,
                strokeWidth: strokeWidth,
                zIndex: elements.length + 1,
            };
            setElements((prev) => [...prev, newCircle]);
        }
    };

    // 5. Mouse Move / In-Progress Drawing & Cursor Emission
    const handleMouseMove = (e: any) => {
        const rawPos = e.target.getStage()?.getPointerPosition();
        const virtualPos = getTransformedPointerPosition();
        if (!rawPos || !virtualPos) return;

        socketService.sendCursor(boardId, {
            userId: CURRENT_USER_ID,
            userName: `User-${CURRENT_USER_ID}`,
            color: USER_COLOR,
            x: rawPos.x,
            y: rawPos.y,
        });

        if (!isDrawing.current || !activeElementId.current) return;

        setElements((prev) =>
            prev.map((el) => {
                if (el.id !== activeElementId.current) return el;

                if (el.type === 'stroke') {
                    const pts = JSON.parse(el.payload || '[]');
                    return { ...el, payload: JSON.stringify([...pts, virtualPos.x, virtualPos.y]) };
                } else if (el.type === 'rect') {
                    return {
                        ...el,
                        width: virtualPos.x - el.x,
                        height: virtualPos.y - el.y,
                    };
                } else if ((el.type as any) === 'circle') {
                    const dx = virtualPos.x - el.x;
                    const dy = virtualPos.y - el.y;
                    const radius = Math.sqrt(dx * dx + dy * dy);
                    return {
                        ...el,
                        width: radius,
                    };
                }
                return el;
            })
        );
    };

    // 6. Mouse Up / Commit Shape to MySQL
    const handleMouseUp = () => {
        if (!isDrawing.current) return;
        isDrawing.current = false;

        const finished = elements.find((el) => el.id === activeElementId.current);
        if (finished) {
            socketService.sendElement(boardId, finished);
        }
        activeElementId.current = null;
    };

    // 7. Drag End handler for updating moved shapes
    const handleDragEnd = (id: string, e: any) => {
        const el = elements.find((item) => item.id === id);
        if (!el) return;

        const updated: ElementPayload = {
            ...el,
            action: 'UPDATE',
            x: e.target.x(),
            y: e.target.y(),
        };

        setElements((prev) => prev.map((item) => (item.id === id ? updated : item)));
        socketService.sendElement(boardId, updated);
    };

    // 8. Export Canvas to Image
    const handleExport = () => {
        if (!stageRef.current) return;
        setSelectedId(null);
        setTimeout(() => {
            const uri = stageRef.current.toDataURL({ pixelRatio: 2 });
            const link = document.createElement('a');
            link.download = `whiteboard-${boardId}.png`;
            link.href = uri;
            link.click();
        }, 50);
    };

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#f8fafc' }}>
            {/* Top-Right Collaboration Bar */}
            <div
                style={{
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    zIndex: 20,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                }}
            >
                <button
                    onClick={() => {
                        navigator.clipboard.writeText(window.location.href);
                        alert('Room link copied to clipboard!');
                    }}
                    style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: 13,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                    }}
                >
                    🔗 Share
                </button>

                <div
                    title="You"
                    style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        backgroundColor: USER_COLOR,
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: 12,
                        border: '2px solid #ffffff',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                    }}
                >
                    You
                </div>

                {Object.values(cursors).map((c) => (
                    <div
                        key={c.userId}
                        title={c.userName}
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: '50%',
                            backgroundColor: c.color,
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: 12,
                            border: '2px solid #ffffff',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                        }}
                    >
                        {c.userName.replace('User-', '').slice(0, 2).toUpperCase()}
                    </div>
                ))}
            </div>

            {/* Top Floating Control Bar */}
            <div
                style={{
                    position: 'absolute',
                    top: 16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 20,
                    background: '#ffffff',
                    padding: '8px 16px',
                    borderRadius: '12px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    userSelect: 'none',
                }}
            >
                <button
                    onClick={() => setTool('select')}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: tool === 'select' ? '#2563eb' : '#f1f5f9',
                        color: tool === 'select' ? '#fff' : '#0f172a',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                    }}
                >
                    Select
                </button>

                <button
                    onClick={() => setTool('stroke')}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: tool === 'stroke' ? '#2563eb' : '#f1f5f9',
                        color: tool === 'stroke' ? '#fff' : '#0f172a',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                    }}
                >
                    Pen
                </button>

                <button
                    onClick={() => setTool('rect')}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: tool === 'rect' ? '#2563eb' : '#f1f5f9',
                        color: tool === 'rect' ? '#fff' : '#0f172a',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                    }}
                >
                    Rect
                </button>

                <button
                    onClick={() => setTool('circle')}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: tool === 'circle' ? '#2563eb' : '#f1f5f9',
                        color: tool === 'circle' ? '#fff' : '#0f172a',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                    }}
                >
                    Circle
                </button>

                <button
                    onClick={() => setTool('sticky')}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: tool === 'sticky' ? '#eab308' : '#fef08a',
                        color: '#713f12',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                    }}
                >
                    Sticky Note
                </button>

                <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    style={{ border: 'none', width: 28, height: 28, cursor: 'pointer', background: 'transparent' }}
                    title="Color"
                />

                <input
                    type="range"
                    min="1"
                    max="14"
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(Number(e.target.value))}
                    style={{ cursor: 'pointer', width: 70 }}
                    title="Stroke Width"
                />

                <div style={{ width: 1, height: 20, background: '#cbd5e1', margin: '0 4px' }} />

                <button
                    onClick={handleExport}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: '#10b981',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: 600,
                    }}
                >
                    Export PNG
                </button>
            </div>

            {/* Main Konva Stage */}
            <Stage
                ref={stageRef}
                width={window.innerWidth}
                height={window.innerHeight}
                x={stagePos.x}
                y={stagePos.y}
                scaleX={stageScale}
                scaleY={stageScale}
                onWheel={handleWheel}
                draggable={tool === 'select' && !selectedId}
                onDragEnd={(e) => {
                    if (e.target === stageRef.current) {
                        setStagePos({ x: e.target.x(), y: e.target.y() });
                    }
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
            >
                <Layer>
                    {elements.map((el) => {
                        const isSelected = el.id === selectedId;

                        if (el.type === 'stroke') {
                            return (
                                <Line
                                    key={el.id}
                                    id={el.id}
                                    x={el.x}
                                    y={el.y}
                                    points={JSON.parse(el.payload || '[]')}
                                    stroke={isSelected ? '#3b82f6' : el.strokeColor}
                                    strokeWidth={isSelected ? el.strokeWidth + 2 : el.strokeWidth}
                                    tension={0.4}
                                    lineCap="round"
                                    lineJoin="round"
                                    draggable={tool === 'select'}
                                    onClick={() => tool === 'select' && setSelectedId(el.id)}
                                    onDragEnd={(e) => handleDragEnd(el.id, e)}
                                    shadowBlur={isSelected ? 6 : 0}
                                    shadowColor="#3b82f6"
                                />
                            );
                        }

                        if (el.type === 'rect') {
                            return (
                                <Rect
                                    key={el.id}
                                    id={el.id}
                                    x={el.x}
                                    y={el.y}
                                    width={el.width}
                                    height={el.height}
                                    stroke={isSelected ? '#3b82f6' : el.strokeColor}
                                    strokeWidth={isSelected ? el.strokeWidth + 2 : el.strokeWidth}
                                    draggable={tool === 'select'}
                                    onClick={() => tool === 'select' && setSelectedId(el.id)}
                                    onDragEnd={(e) => handleDragEnd(el.id, e)}
                                    shadowBlur={isSelected ? 6 : 0}
                                    shadowColor="#3b82f6"
                                />
                            );
                        }

                        if ((el.type as any) === 'circle') {
                            return (
                                <Circle
                                    key={el.id}
                                    id={el.id}
                                    x={el.x}
                                    y={el.y}
                                    radius={Math.max(el.width || 20, 5)}
                                    stroke={isSelected ? '#3b82f6' : el.strokeColor}
                                    strokeWidth={isSelected ? el.strokeWidth + 2 : el.strokeWidth}
                                    draggable={tool === 'select'}
                                    onClick={() => tool === 'select' && setSelectedId(el.id)}
                                    onDragEnd={(e) => handleDragEnd(el.id, e)}
                                    shadowBlur={isSelected ? 6 : 0}
                                    shadowColor="#3b82f6"
                                />
                            );
                        }

                        if ((el.type as any) === 'sticky') {
                            return (
                                <React.Fragment key={el.id}>
                                    <Rect
                                        id={el.id}
                                        x={el.x}
                                        y={el.y}
                                        width={el.width || 160}
                                        height={el.height || 160}
                                        fill={el.fillColor || '#fef08a'}
                                        stroke={isSelected ? '#3b82f6' : '#eab308'}
                                        strokeWidth={isSelected ? 2 : 1}
                                        cornerRadius={6}
                                        draggable={tool === 'select'}
                                        onClick={() => tool === 'select' && setSelectedId(el.id)}
                                        onDragEnd={(e) => handleDragEnd(el.id, e)}
                                        shadowBlur={isSelected ? 8 : 4}
                                        shadowColor="rgba(0,0,0,0.15)"
                                    />
                                    <KonvaText
                                        x={(el.x ?? 0) + 12}
                                        y={(el.y ?? 0) + 12}
                                        width={(el.width || 160) - 24}
                                        text={el.payload || 'Double click to edit note'}
                                        fontSize={14}
                                        fontFamily="sans-serif"
                                        fill="#713f12"
                                        listening={tool === 'select'}
                                        onDblClick={() => {
                                            const newText = prompt('Edit note text:', el.payload || '');
                                            if (newText !== null) {
                                                const updated: ElementPayload = {
                                                    ...el,
                                                    payload: newText,
                                                    action: 'UPDATE',
                                                };
                                                setElements((prev) =>
                                                    prev.map((item) => (item.id === el.id ? updated : item))
                                                );
                                                socketService.sendElement(boardId, updated);
                                            }
                                        }}
                                    />
                                </React.Fragment>
                            );
                        }

                        return null;
                    })}
                </Layer>
            </Stage>

            {/* Live Peer Cursors */}
            {Object.values(cursors).map((c) => (
                <div
                    key={c.userId}
                    style={{
                        position: 'absolute',
                        left: c.x,
                        top: c.y,
                        pointerEvents: 'none',
                        transform: 'translate(-2px, -2px)',
                        transition: 'all 0.04s linear',
                        zIndex: 10,
                    }}
                >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill={c.color}>
                        <path d="M4 0l16 12-7 1.5-4 8.5-2.5-1.5 4-8.5-6.5-1.5z" />
                    </svg>
                    <span
                        style={{
                            position: 'relative',
                            left: 12,
                            top: -6,
                            background: c.color,
                            color: '#ffffff',
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontWeight: 500,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {c.userName}
                    </span>
                </div>
            ))}
        </div>
    );
};