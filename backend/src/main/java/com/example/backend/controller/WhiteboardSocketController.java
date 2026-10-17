package com.example.backend.controller;

import com.example.backend.dto.CursorMessage;
import com.example.backend.dto.ElementMessage;
import com.example.backend.model.BoardElement;
import com.example.backend.repository.BoardElementRepository;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

@Controller
public class WhiteboardSocketController {

    private final SimpMessagingTemplate messagingTemplate;
    private final BoardElementRepository elementRepository;

    public WhiteboardSocketController(SimpMessagingTemplate messagingTemplate,
            BoardElementRepository elementRepository) {
        this.messagingTemplate = messagingTemplate;
        this.elementRepository = elementRepository;
    }

    // 1. Live Cursors: Broadcast only (No database write)
    @MessageMapping("/room/{boardId}/cursor")
    public void broadcastCursor(@DestinationVariable String boardId, CursorMessage cursor) {
        messagingTemplate.convertAndSend("/topic/room/" + boardId + "/cursor", cursor);
    }

    // 2. Elements: Broadcast to peers and persist changes to MySQL
    @MessageMapping("/room/{boardId}/element")
    public void handleElement(@DestinationVariable String boardId, ElementMessage msg) {
        // Broadcast immediately for smooth UI
        messagingTemplate.convertAndSend("/topic/room/" + boardId + "/element", msg);

        if ("DELETE".equalsIgnoreCase(msg.getAction())) {
            elementRepository.deleteById(msg.getId());
            return;
        }

        // CREATE or UPDATE -> persist in MySQL
        BoardElement element = new BoardElement();
        element.setId(msg.getId());
        element.setBoardId(boardId);
        element.setType(msg.getType());
        element.setX(msg.getX());
        element.setY(msg.getY());
        element.setWidth(msg.getWidth());
        element.setHeight(msg.getHeight());
        element.setStrokeColor(msg.getStrokeColor());
        element.setFillColor(msg.getFillColor());
        element.setStrokeWidth(msg.getStrokeWidth());
        element.setZIndex(msg.getZIndex());
        element.setPayload(msg.getPayload());

        elementRepository.save(element);
    }
}