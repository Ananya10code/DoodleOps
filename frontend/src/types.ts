export type Tool = 'select' | 'stroke' | 'rect' | 'circle' | 'sticky' | 'eraser';
export type ElementType = 'stroke' | 'rect' | 'circle' | 'sticky';
export type ElementAction = 'DRAGGING' | 'CREATE' | 'UPDATE' | 'DELETE';

/**
 * rect / sticky : x,y top-left, width/height size
 * circle        : x,y centre,   width = height = diameter
 * stroke        : x,y offset,   payload = JSON number[] of points
 * sticky        : payload = note text
 */
export interface BoardElement {
  id: string;
  boardId: string;
  type: ElementType;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  zIndex: number;
  payload: string | null;
}

export interface ElementMessage {
  action: ElementAction;
  senderId: string;
  element: BoardElement;
}

export interface CursorMessage {
  userId: string;
  name: string;
  color: string;
  x: number | null;
  y: number | null;
  leave?: boolean;
}
