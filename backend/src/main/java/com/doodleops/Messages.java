package com.doodleops;

/** Wire-format records shared by the WebSocket and REST layers. */
public final class Messages {
    private Messages() {}

    public enum ElementAction { DRAGGING, CREATE, UPDATE, DELETE }

    public record ElementDto(
            String id, String boardId, String type,
            double x, double y, Double width, Double height,
            String strokeColor, String fillColor,
            int strokeWidth, int zIndex, String payload) {

        public static ElementDto from(BoardElement e) {
            return new ElementDto(e.getId(), e.getBoardId(), e.getType(), e.getX(), e.getY(),
                    e.getWidth(), e.getHeight(), e.getStrokeColor(), e.getFillColor(),
                    e.getStrokeWidth(), e.getZIndex(), e.getPayload());
        }
    }

    public record ElementMessage(ElementAction action, String senderId, ElementDto element) {}

    /** x / y are null for a presence-only heartbeat from a user who has not moved yet. */
    public record CursorMessage(String userId, String name, String color, Double x, Double y, Boolean leave) {}
}
