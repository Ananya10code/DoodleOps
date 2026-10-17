<<<<<<< HEAD
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Label, Layer, Line, Path, Rect, Shape, Stage, Tag, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Context } from 'konva/lib/Context';
import type { Shape as KonvaShape } from 'konva/lib/Shape';
import type { KonvaEventObject } from 'konva/lib/Node';
import { API_BASE, socket, type ConnectionStatus } from '../services/websocket';
import { uuid } from '../utils';
import type { BoardElement, CursorMessage, ElementAction, ElementMessage, ElementType, Tool } from '../types';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const DRAG_INTERVAL_MS = 35; // ephemeral DRAGGING broadcast cadence
const CURSOR_INTERVAL_MS = 16; // ~60fps cursor telemetry
const HEARTBEAT_MS = 2000;
const PRESENCE_TTL_MS = 8000;
const HISTORY_LIMIT = 200;
const GRID = 40;
const STICKY_W = 180;
const STICKY_H = 140;
const STICKY_FILL = '#FFE58A';
const STICKY_PAD = 10;
const STICKY_FONT = 16;
const MIN_SIZE = 8;
const FONT = '"Avenir Next", "Segoe UI", system-ui, sans-serif';
const PAPER = '#F4F6F5';
const DOT = '#B6C0C7';
const ACCENT = '#3547D9';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'stroke', label: 'Pen' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'sticky', label: 'Note' },
  { id: 'eraser', label: 'Eraser' },
];

/* ------------------------------------------------------------------ */
/* Identity (per browser tab)                                          */
/* ------------------------------------------------------------------ */

interface Identity {
  id: string;
  name: string;
  color: string;
}

const PEER_COLORS = ['#E5484D', '#3E63DD', '#30A46C', '#F76B15', '#8E4EC6', '#0B9AA6', '#D6409F'];
const PEER_NAMES = ['Otter', 'Heron', 'Lynx', 'Finch', 'Marten', 'Ibis', 'Gecko', 'Puffin'];

function loadIdentity(): Identity {
  try {
    const raw = sessionStorage.getItem('doodleops.identity');
    if (raw) return JSON.parse(raw) as Identity;
  } catch {
    /* storage unavailable */
  }
  const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
  const identity: Identity = {
    id: uuid(),
    name: `${pick(PEER_NAMES)} ${10 + Math.floor(Math.random() * 90)}`,
    color: pick(PEER_COLORS),
  };
  try {
    sessionStorage.setItem('doodleops.identity', JSON.stringify(identity));
  } catch {
    /* storage unavailable */
  }
  return identity;
}

const identity = loadIdentity();

/* ------------------------------------------------------------------ */
/* Types & pure helpers                                                */
/* ------------------------------------------------------------------ */

interface View {
  x: number; // stage position (screen px)
  y: number;
  scale: number; // scaleX === scaleY
}

type OpType = 'CREATE' | 'UPDATE' | 'DELETE';

/** Command-pattern record holding snapshots from before and after a mutation. */
interface Op {
  type: OpType;
  before: BoardElement | null;
  after: BoardElement | null;
}

interface RemoteCursor extends CursorMessage {
  lastSeen: number;
}

interface DrawState {
  kind: 'stroke' | 'rect' | 'circle';
  el: BoardElement;
  startX: number;
  startY: number;
  points: number[];
  lastSend: number;
  sent: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

function upsert(list: BoardElement[], el: BoardElement): BoardElement[] {
  const i = list.findIndex((e) => e.id === el.id);
  if (i < 0) return [...list, el];
  const copy = list.slice();
  copy[i] = el;
  return copy;
}

function parsePoints(payload: string | null): number[] {
  if (!payload) return [];
  try {
    const v: unknown = JSON.parse(payload);
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

/** Screen space -> virtual canvas space. */
function toVirtual(raw: { x: number; y: number }, v: View) {
  return { x: (raw.x - v.x) / v.scale, y: (raw.y - v.y) / v.scale };
}

function snapshot(d: DrawState): BoardElement {
  return d.kind === 'stroke' ? { ...d.el, payload: JSON.stringify(d.points.map(r2)) } : d.el;
}

/* ------------------------------------------------------------------ */
/* Element node                                                        */
/* ------------------------------------------------------------------ */

interface ElementNodeProps {
  el: BoardElement;
  interactive: boolean;
  hideText?: boolean;
  onSelect?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDragMove?: (id: string, node: Konva.Node) => void;
  onDragEnd?: (id: string, node: Konva.Node) => void;
  onTransformEnd?: (id: string, node: Konva.Node) => void;
}

const ElementNode = memo(function ElementNode(props: ElementNodeProps) {
  const { el, interactive, hideText, onSelect, onEdit, onDragMove, onDragEnd, onTransformEnd } = props;
  const points = useMemo(() => (el.type === 'stroke' ? parsePoints(el.payload) : []), [el.type, el.payload]);

  const select = (e: KonvaEventObject<Event>) => {
    if (!interactive) return;
    e.cancelBubble = true;
    onSelect?.(el.id);
  };

  const common = {
    id: el.id,
    name: 'element',
    x: el.x,
    y: el.y,
    draggable: interactive,
    onMouseDown: select,
    onTouchStart: select,
    onDragMove: (e: KonvaEventObject<Event>) => onDragMove?.(el.id, e.target),
    onDragEnd: (e: KonvaEventObject<Event>) => onDragEnd?.(el.id, e.target),
    onTransformEnd: (e: KonvaEventObject<Event>) => onTransformEnd?.(el.id, e.target),
  };
  // Wider hit region so thin lines are easy to select and sweep-erase.
  const hitStrokeWidth = Math.max(el.strokeWidth, 16);

  switch (el.type) {
    case 'stroke':
      return (
        <Line
          {...common}
          points={points}
          stroke={el.strokeColor}
          strokeWidth={el.strokeWidth}
          tension={0.4}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={hitStrokeWidth}
        />
      );
    case 'rect':
      return (
        <Rect
          {...common}
          width={el.width ?? 0}
          height={el.height ?? 0}
          stroke={el.strokeColor}
          strokeWidth={el.strokeWidth}
          fill={el.fillColor ?? undefined}
          hitStrokeWidth={hitStrokeWidth}
        />
      );
    case 'circle':
      return (
        <Circle
          {...common}
          radius={(el.width ?? 0) / 2}
          stroke={el.strokeColor}
          strokeWidth={el.strokeWidth}
          fill={el.fillColor ?? undefined}
          hitStrokeWidth={hitStrokeWidth}
        />
      );
    case 'sticky': {
      const w = el.width ?? STICKY_W;
      const h = el.height ?? STICKY_H;
      return (
        <Group {...common} onDblClick={() => interactive && onEdit?.(el.id)} onDblTap={() => interactive && onEdit?.(el.id)}>
          <Rect
            width={w}
            height={h}
            fill={el.fillColor ?? STICKY_FILL}
            cornerRadius={4}
            shadowColor="#000"
            shadowOpacity={0.18}
            shadowBlur={8}
            shadowOffsetY={3}
          />
          <Text
            x={STICKY_PAD}
            y={STICKY_PAD}
            width={Math.max(0, w - STICKY_PAD * 2)}
            height={Math.max(0, h - STICKY_PAD * 2)}
            text={hideText ? '' : el.payload ?? ''}
            fontSize={STICKY_FONT}
            lineHeight={1}
            fontFamily={FONT}
            fill={el.strokeColor}
            wrap="word"
            ellipsis
          />
        </Group>
      );
    }
    default:
      return null;
  }
});

const RemoteCursorNode = memo(function RemoteCursorNode({ c, scale }: { c: RemoteCursor; scale: number }) {
  if (c.x === null || c.y === null) return null;
  return (
    <Group x={c.x} y={c.y} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
      <Path data="M0 0 L0 17 L4.4 13 L7.2 19.6 L10 18.4 L7.2 12 L13 12 Z" fill={c.color} stroke="#fff" strokeWidth={1.5} lineJoin="round" />
      <Label x={14} y={18}>
        <Tag fill={c.color} cornerRadius={4} />
        <Text text={c.name} fontSize={12} fontFamily={FONT} fill="#fff" padding={4} />
      </Label>
    </Group>
  );
});

/* ------------------------------------------------------------------ */
/* Whiteboard                                                          */
/* ------------------------------------------------------------------ */

export default function Whiteboard({ boardId }: { boardId: string }) {
  /* ---- state ---- */
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const [history, setHistory] = useState<Op[][]>([]);
  const [redoHistory, setRedoHistory] = useState<Op[][]>([]);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>('select');
  const [strokeColor, setStrokeColor] = useState('#1F2937');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BoardElement | null>(null);
  const [draftPts, setDraftPts] = useState<number[] | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>(socket.getStatus());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  /* ---- refs (stable access from callbacks) ---- */
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const cursorLayerRef = useRef<Konva.Layer>(null);
  const elementsRef = useRef<BoardElement[]>([]);
  const cursorsRef = useRef<Record<string, RemoteCursor>>({});
  const historyRef = useRef(history);
  const redoRef = useRef(redoHistory);
  const viewRef = useRef(view);
  const toolRef = useRef(tool);
  const styleRef = useRef({ color: strokeColor, width: strokeWidth });
  const selectedRef = useRef(selectedId);
  const editingIdRef = useRef<string | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  const eraseRef = useRef<Op[] | null>(null);
  const lastDragSend = useRef(0);
  const lastCursorSend = useRef(0);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRaf = useRef<number | null>(null);
  const finishRef = useRef<() => void>(() => undefined);
  const taRef = useRef<HTMLTextAreaElement>(null);

  historyRef.current = history;
  redoRef.current = redoHistory;
  viewRef.current = view;
  toolRef.current = tool;
  styleRef.current = { color: strokeColor, width: strokeWidth };
  selectedRef.current = selectedId;

  /* ---- element store (ref is the source of truth, state drives rendering) ---- */
  const setEls = useCallback((updater: (prev: BoardElement[]) => BoardElement[]) => {
    const next = updater(elementsRef.current);
    elementsRef.current = next;
    setElements(next);
  }, []);

  const setEditing = useCallback((id: string | null) => {
    editingIdRef.current = id;
    setEditingId(id);
  }, []);

  const nextZ = () => elementsRef.current.reduce((m, e) => Math.max(m, e.zIndex), 0) + 1;

  const makeElement = (type: ElementType, x: number, y: number, extra: Partial<BoardElement> = {}): BoardElement => ({
    id: uuid(),
    boardId,
    type,
    x,
    y,
    width: null,
    height: null,
    strokeColor: styleRef.current.color,
    fillColor: null,
    strokeWidth: styleRef.current.width,
    zIndex: nextZ(),
    payload: null,
    ...extra,
  });

  /* ---- networking helpers ---- */
  const publish = useCallback(
    (action: ElementAction, element: BoardElement) => {
      socket.publishElement(boardId, { action, senderId: identity.id, element });
    },
    [boardId],
  );

  const sendCursor = useCallback(
    (p: { x: number; y: number } | null, leave = false) => {
      socket.publishCursor(boardId, {
        userId: identity.id,
        name: identity.name,
        color: identity.color,
        x: p ? p.x : null,
        y: p ? p.y : null,
        leave,
      });
    },
    [boardId],
  );

  /** Apply to local state and broadcast. */
  const emit = useCallback(
    (action: ElementAction, el: BoardElement) => {
      if (action === 'DELETE') {
        setEls((p) => p.filter((e) => e.id !== el.id));
        setSelectedId((s) => (s === el.id ? null : s));
        if (editingIdRef.current === el.id) setEditing(null);
      } else {
        setEls((p) => upsert(p, el));
      }
      publish(action, el);
    },
    [publish, setEls, setEditing],
  );

  /* ---- undo / redo (command pattern) ---- */
  const forward = useCallback(
    (op: Op) => {
      if (op.type === 'DELETE') {
        if (op.before) emit('DELETE', op.before);
      } else if (op.after) {
        emit(op.type, op.after);
      }
    },
    [emit],
  );

  const revert = useCallback(
    (op: Op) => {
      switch (op.type) {
        case 'CREATE':
          if (op.after) emit('DELETE', op.after);
          break;
        case 'UPDATE':
          if (op.before) emit('UPDATE', op.before);
          break;
        case 'DELETE':
          if (op.before) emit('CREATE', op.before);
          break;
      }
    },
    [emit],
  );

  const pushHistory = useCallback((ops: Op[]) => {
    if (!ops.length) return;
    setHistory((h) => [...h, ops].slice(-HISTORY_LIMIT));
    setRedoHistory([]);
  }, []);

  const commit = useCallback(
    (ops: Op[]) => {
      ops.forEach(forward);
      pushHistory(ops);
    },
    [forward, pushHistory],
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.length) return;
    const entry = h[h.length - 1];
    [...entry].reverse().forEach(revert);
    setHistory(h.slice(0, -1));
    setRedoHistory([...redoRef.current, entry]);
  }, [revert]);

  const redo = useCallback(() => {
    const r = redoRef.current;
    if (!r.length) return;
    const entry = r[r.length - 1];
    entry.forEach(forward);
    setRedoHistory(r.slice(0, -1));
    setHistory([...historyRef.current, entry]);
  }, [forward]);

  /* ---- hydration + realtime subscriptions ---- */
  const hydrate = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/boards/${encodeURIComponent(boardId)}/elements`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BoardElement[];
      setEls(() => data);
      setLoadError(null);
    } catch (err) {
      setLoadError(`Couldn't load this board (${(err as Error).message}). Retrying when the connection returns.`);
    }
  }, [boardId, setEls]);

  const flushCursors = useCallback(() => {
    if (cursorRaf.current !== null) return;
    cursorRaf.current = requestAnimationFrame(() => {
      cursorRaf.current = null;
      setCursors(cursorsRef.current);
    });
  }, []);

  useEffect(() => {
    socket.connect();

    const onElement = (m: ElementMessage) => {
      if (m.senderId === identity.id || !m.element) return;
      if (m.action === 'DELETE') {
        const id = m.element.id;
        setEls((p) => p.filter((e) => e.id !== id));
        setSelectedId((s) => (s === id ? null : s));
        if (editingIdRef.current === id) setEditing(null);
      } else {
        setEls((p) => upsert(p, m.element));
      }
    };

    const onCursor = (m: CursorMessage) => {
      if (m.userId === identity.id) return;
      if (m.leave) {
        const { [m.userId]: _gone, ...rest } = cursorsRef.current;
        cursorsRef.current = rest;
      } else {
        cursorsRef.current = { ...cursorsRef.current, [m.userId]: { ...m, lastSeen: Date.now() } };
      }
      flushCursors();
    };

    const offStatus = socket.onStatus((s) => {
      setStatus(s);
      if (s === 'connected') {
        void hydrate(); // also resyncs anything missed while disconnected
        sendCursor(lastPosRef.current);
      }
    });
    const offElements = socket.subscribeElements(boardId, onElement);
    const offCursors = socket.subscribeCursors(boardId, onCursor);
    void hydrate();

    const heartbeat = window.setInterval(() => sendCursor(lastPosRef.current), HEARTBEAT_MS);
    const prune = window.setInterval(() => {
      const cutoff = Date.now() - PRESENCE_TTL_MS;
      const entries = Object.entries(cursorsRef.current);
      const alive = entries.filter(([, c]) => c.lastSeen >= cutoff);
      if (alive.length !== entries.length) {
        cursorsRef.current = Object.fromEntries(alive);
        flushCursors();
      }
    }, 1000);

    const onUnload = () => sendCursor(null, true);
    window.addEventListener('beforeunload', onUnload);

    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.clearInterval(heartbeat);
      window.clearInterval(prune);
      sendCursor(null, true);
      offStatus();
      offElements();
      offCursors();
      if (cursorRaf.current !== null) cancelAnimationFrame(cursorRaf.current);
    };
  }, [boardId, hydrate, sendCursor, flushCursors, setEls, setEditing]);

  /* ---- window-level listeners: resize, keyboard, pointer release ---- */
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === ' ') {
        e.preventDefault();
        setSpaceDown(true);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        e.preventDefault();
        const el = elementsRef.current.find((x) => x.id === selectedRef.current);
        if (el) commit([{ type: 'DELETE', before: el, after: null }]);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };
    const onBlur = () => setSpaceDown(false);
    const onPointerUp = () => finishRef.current();

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [undo, redo, commit]);

  /* ---- transformer attachment ---- */
  const selectedEl = useMemo(() => elements.find((e) => e.id === selectedId) ?? null, [elements, selectedId]);

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    let node: Konva.Node | undefined;
    if (selectedId && tool === 'select' && editingId !== selectedId && !spaceDown) {
      node = stage.findOne((n: Konva.Node) => n.id() === selectedId && n.hasName('element')) ?? undefined;
    }
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, tool, editingId, spaceDown, elements]);

  /* ---- element interaction callbacks (stable) ---- */
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  const handleEdit = useCallback(
    (id: string) => {
      setSelectedId(id);
      setEditing(id);
    },
    [setEditing],
  );

  const handleNodeDragMove = useCallback(
    (id: string, node: Konva.Node) => {
      const now = performance.now();
      if (now - lastDragSend.current < DRAG_INTERVAL_MS) return;
      lastDragSend.current = now;
      const el = elementsRef.current.find((e) => e.id === id);
      if (el) publish('DRAGGING', { ...el, x: node.x(), y: node.y() }); // no DB write, no local state change
    },
    [publish],
  );

  const handleNodeDragEnd = useCallback(
    (id: string, node: Konva.Node) => {
      const el = elementsRef.current.find((e) => e.id === id);
      if (!el) return;
      const next = { ...el, x: r2(node.x()), y: r2(node.y()) };
      if (next.x === el.x && next.y === el.y) return;
      commit([{ type: 'UPDATE', before: el, after: next }]); // persists the final position
    },
    [commit],
  );

  const handleTransformEnd = useCallback(
    (id: string, node: Konva.Node) => {
      const el = elementsRef.current.find((e) => e.id === id);
      if (!el) return;
      // Normalise: bake the scale into the geometry and reset it so transforms never compound.
      const sx = node.scaleX();
      const sy = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      const next: BoardElement = { ...el, x: r2(node.x()), y: r2(node.y()) };
      switch (el.type) {
        case 'rect':
        case 'sticky':
          next.width = r2(Math.max(MIN_SIZE, (el.width ?? 0) * sx));
          next.height = r2(Math.max(MIN_SIZE, (el.height ?? 0) * sy));
          break;
        case 'circle': {
          const d = r2(Math.max(MIN_SIZE, (el.width ?? 0) * Math.max(sx, sy)));
          next.width = d;
          next.height = d;
          break;
        }
        case 'stroke':
          next.payload = JSON.stringify(parsePoints(el.payload).map((v, i) => r2(v * (i % 2 === 0 ? sx : sy))));
          break;
      }
      commit([{ type: 'UPDATE', before: el, after: next }]);
    },
    [commit],
  );

  /* ---- sticky note editing ---- */
  const finishEdit = useCallback(
    (text: string) => {
      const id = editingIdRef.current;
      if (!id) return;
      setEditing(null);
      const el = elementsRef.current.find((e) => e.id === id);
      if (el && (el.payload ?? '') !== text) {
        commit([{ type: 'UPDATE', before: el, after: { ...el, payload: text } }]);
      }
    },
    [commit, setEditing],
  );

  const editingEl = useMemo(() => elements.find((e) => e.id === editingId) ?? null, [elements, editingId]);

  useEffect(() => {
    if (editingEl && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
    }
    // only when the editor opens for a different note
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  /* ---- stage pointer handling ---- */
  const eraseAt = (stage: Konva.Stage) => {
    const pos = stage.getPointerPosition();
    if (!pos || !eraseRef.current) return;
    const hit = stage.getIntersection(pos);
    const node = hit?.findAncestor('.element', true);
    if (!node) return;
    const el = elementsRef.current.find((e) => e.id === node.id());
    if (!el) return;
    eraseRef.current.push({ type: 'DELETE', before: el, after: null });
    emit('DELETE', el);
  };

  const handleDown = (e: KonvaEventObject<Event>) => {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'BUTTON')) active.blur();
    if (spaceDown) return;
    const stage = e.target.getStage();
    const raw = stage?.getPointerPosition();
    if (!stage || !raw) return;
    const p = toVirtual(raw, viewRef.current);

    switch (toolRef.current) {
      case 'select':
        if (e.target === stage) {
          setSelectedId(null);
          if (editingIdRef.current) setEditing(null);
        }
        break;
      case 'stroke': {
        const el = makeElement('stroke', 0, 0);
        drawRef.current = { kind: 'stroke', el, startX: p.x, startY: p.y, points: [p.x, p.y], lastSend: 0, sent: false };
        setDraft(el);
        setDraftPts([p.x, p.y]);
        break;
      }
      case 'rect':
      case 'circle': {
        const kind = toolRef.current;
        const el = makeElement(kind, p.x, p.y, { width: 0, height: 0 });
        drawRef.current = { kind, el, startX: p.x, startY: p.y, points: [], lastSend: 0, sent: false };
        setDraft(el);
        break;
      }
      case 'sticky': {
        const el = makeElement('sticky', p.x - STICKY_W / 2, p.y - STICKY_H / 2, {
          width: STICKY_W,
          height: STICKY_H,
          fillColor: STICKY_FILL,
          payload: '',
        });
        commit([{ type: 'CREATE', before: null, after: el }]);
        setTool('select');
        setSelectedId(el.id);
        setEditing(el.id);
        break;
      }
      case 'eraser':
        eraseRef.current = [];
        eraseAt(stage);
        break;
    }
  };

  const handleMove = (e: KonvaEventObject<Event>) => {
    const stage = e.target.getStage();
    const raw = stage?.getPointerPosition();
    if (!stage || !raw) return;
    const v = viewRef.current;
    const p = toVirtual(raw, v);
    lastPosRef.current = p;

    const now = performance.now();
    if (now - lastCursorSend.current >= CURSOR_INTERVAL_MS) {
      lastCursorSend.current = now;
      sendCursor(p);
    }

    const d = drawRef.current;
    if (d) {
      if (d.kind === 'stroke') {
        const n = d.points.length;
        if (Math.hypot(p.x - d.points[n - 2], p.y - d.points[n - 1]) < 1.5 / v.scale) return;
        d.points.push(p.x, p.y);
        setDraftPts([...d.points]);
      } else if (d.kind === 'rect') {
        d.el = {
          ...d.el,
          x: Math.min(d.startX, p.x),
          y: Math.min(d.startY, p.y),
          width: Math.abs(p.x - d.startX),
          height: Math.abs(p.y - d.startY),
        };
        setDraft(d.el);
      } else {
        const diameter = 2 * Math.hypot(p.x - d.startX, p.y - d.startY);
        d.el = { ...d.el, x: d.startX, y: d.startY, width: diameter, height: diameter };
        setDraft(d.el);
      }
      if (now - d.lastSend >= DRAG_INTERVAL_MS) {
        d.lastSend = now;
        d.sent = true;
        publish('DRAGGING', snapshot(d));
      }
    } else if (eraseRef.current && toolRef.current === 'eraser') {
      eraseAt(stage);
    }
  };

  finishRef.current = () => {
    const erased = eraseRef.current;
    if (erased) {
      eraseRef.current = null;
      pushHistory(erased); // one undo step per sweep
    }
    const d = drawRef.current;
    if (!d) return;
    drawRef.current = null;
    setDraft(null);
    setDraftPts(null);

    if (d.kind === 'stroke' && d.points.length === 2) d.points.push(d.points[0] + 0.01, d.points[1]);
    const el = snapshot(d);
    const valid =
      d.kind === 'stroke' ||
      (d.kind === 'rect' && (el.width ?? 0) >= 3 && (el.height ?? 0) >= 3) ||
      (d.kind === 'circle' && (el.width ?? 0) >= 6);
    if (valid) commit([{ type: 'CREATE', before: null, after: el }]);
    else if (d.sent) publish('DELETE', d.el); // retract the ephemeral ghost on peers
  };

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const v = viewRef.current;
    const factor = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.01 : 0.0015));
    const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
    const virtual = toVirtual(pointer, v);
    setView({ scale, x: pointer.x - virtual.x * scale, y: pointer.y - virtual.y * scale });
  };

  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
    const center = { x: size.w / 2, y: size.h / 2 };
    const virtual = toVirtual(center, v);
    setView({ scale, x: center.x - virtual.x * scale, y: center.y - virtual.y * scale });
  };

  const handleStageDrag = (e: KonvaEventObject<Event>) => {
    if (e.target === e.target.getStage()) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
  };

  /* ---- export ---- */
  const exportPng = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const tr = trRef.current;
    const cursorLayer = cursorLayerRef.current;
    const trVisible = tr ? tr.visible() : true;
    tr?.visible(false); // mask selection bounds + anchors
    cursorLayer?.visible(false);
    const uri = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' });
    tr?.visible(trVisible);
    cursorLayer?.visible(true);
    const a = document.createElement('a');
    a.href = uri;
    a.download = `doodleops-${boardId}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const share = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link to invite others:', url); // clipboard API needs https
    }
  };

  /* ---- derived render data ---- */
  const sorted = useMemo(() => [...elements].sort((a, b) => a.zIndex - b.zIndex), [elements]);
  const peers = useMemo(() => Object.values(cursors), [cursors]);
  const gridSpacing = useMemo(() => {
    let s = GRID;
    while (s * view.scale < 18) s *= 2; // keep the dot grid readable when zoomed out
    return s;
  }, [view.scale]);

  const interactive = tool === 'select' && !spaceDown;
  const cursorStyle = spaceDown ? 'grab' : tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair';

  const drawGrid = (ctx: Context, shape: KonvaShape) => {
    const left = -view.x / view.scale;
    const top = -view.y / view.scale;
    const right = left + size.w / view.scale;
    const bottom = top + size.h / view.scale;
    const r = 1.4 / view.scale;
    ctx.beginPath();
    for (let x = Math.floor(left / gridSpacing) * gridSpacing; x <= right; x += gridSpacing) {
      for (let y = Math.floor(top / gridSpacing) * gridSpacing; y <= bottom; y += gridSpacing) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fillShape(shape);
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className="board" style={{ cursor: cursorStyle }}>
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={tool === 'select' || spaceDown}
        onWheel={handleWheel}
        onMouseDown={handleDown}
        onTouchStart={handleDown}
        onMouseMove={handleMove}
        onTouchMove={handleMove}
        onDragMove={handleStageDrag}
        onDragEnd={handleStageDrag}
      >
        {/* Dot grid + paper: lives in virtual space, so it pans and zooms with the stage */}
        <Layer listening={false}>
          <Rect
            x={-view.x / view.scale}
            y={-view.y / view.scale}
            width={size.w / view.scale}
            height={size.h / view.scale}
            fill={PAPER}
          />
          <Shape fill={DOT} sceneFunc={drawGrid} listening={false} />
        </Layer>

        <Layer>
          {sorted.map((el) => (
            <ElementNode
              key={el.id}
              el={el}
              interactive={interactive}
              hideText={el.id === editingId}
              onSelect={handleSelect}
              onEdit={handleEdit}
              onDragMove={handleNodeDragMove}
              onDragEnd={handleNodeDragEnd}
              onTransformEnd={handleTransformEnd}
            />
          ))}
          {draft && draft.type !== 'stroke' && <ElementNode el={draft} interactive={false} />}
          {draft && draft.type === 'stroke' && draftPts && (
            <Line
              points={draftPts}
              stroke={draft.strokeColor}
              strokeWidth={draft.strokeWidth}
              tension={0.4}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            keepRatio={selectedEl?.type === 'circle'}
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            anchorSize={9}
            anchorStroke={ACCENT}
            anchorFill="#fff"
            borderStroke={ACCENT}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < MIN_SIZE || newBox.height < MIN_SIZE ? oldBox : newBox)}
          />
        </Layer>

        <Layer ref={cursorLayerRef} listening={false}>
          {peers.map((c) => (
            <RemoteCursorNode key={c.userId} c={c} scale={view.scale} />
          ))}
        </Layer>
      </Stage>

      {/* In-place sticky note editor, matched to the note's virtual position and scale */}
      {editingEl && (
        <textarea
          ref={taRef}
          className="note-editor"
          aria-label="Edit note text"
          defaultValue={editingEl.payload ?? ''}
          style={{
            left: view.x + editingEl.x * view.scale,
            top: view.y + editingEl.y * view.scale,
            width: editingEl.width ?? STICKY_W,
            height: editingEl.height ?? STICKY_H,
            transform: `scale(${view.scale})`,
            background: editingEl.fillColor ?? STICKY_FILL,
            color: editingEl.strokeColor,
          }}
          onBlur={(e) => finishEdit(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              finishEdit(e.currentTarget.value);
            }
          }}
        />
      )}

      <div className="panel brand">
        <strong>DoodleOps</strong>
        <span className="room">Board {boardId}</span>
        <span className={`status ${status}`} role="status">
          <i />
          {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
        </span>
        <button className="btn" onClick={share}>
          {copied ? 'Link copied' : 'Invite'}
        </button>
      </div>

      <div className="panel roster" aria-label="People on this board">
        <span className="avatar self" style={{ background: identity.color }} title={`${identity.name} (you)`}>
          {identity.name[0]}
        </span>
        {peers.map((c) => (
          <span key={c.userId} className="avatar" style={{ background: c.color }} title={c.name}>
            {c.name[0]}
          </span>
        ))}
      </div>

      <nav className="panel toolbar" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className="btn"
            aria-pressed={tool === t.id}
            onClick={() => {
              setTool(t.id);
              if (t.id !== 'select') setSelectedId(null);
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="sep" />
        <input type="color" aria-label="Stroke color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
        <label>
          Width
          <input
            type="range"
            min={1}
            max={32}
            value={strokeWidth}
            aria-label="Stroke width"
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
          />
        </label>
        <span className="sep" />
        <button className="btn" onClick={undo} disabled={!history.length} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="btn" onClick={redo} disabled={!redoHistory.length} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <span className="sep" />
        <button className="btn" onClick={exportPng}>
          Export PNG
        </button>
      </nav>

      <div className="panel zoom">
        <button className="btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
          −
        </button>
        <span>{Math.round(view.scale * 100)}%</span>
        <button className="btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
        <button className="btn" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>
          Reset view
        </button>
      </div>

      {loadError && <div className="panel banner">{loadError}</div>}
    </div>
  );
}
=======
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
>>>>>>> abdebd9583869536fbbcb39e4385065772fbe0f7
