package com.doodleops;

import com.doodleops.Messages.CursorMessage;
import com.doodleops.Messages.ElementDto;
import com.doodleops.Messages.ElementMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Controller;

import java.util.regex.Pattern;

@Controller
public class WhiteboardController {

    private static final Logger log = LoggerFactory.getLogger(WhiteboardController.class);
    private static final Pattern BOARD_ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");

    private final SimpMessagingTemplate messagingTemplate;
    private final BoardElementService elementService;

    public WhiteboardController(SimpMessagingTemplate messagingTemplate, BoardElementService elementService) {
        this.messagingTemplate = messagingTemplate;
        this.elementService = elementService;
    }

    /** Ephemeral cursor / presence telemetry: never persisted. */
    @MessageMapping("/board/{boardId}/cursor")
    public void cursor(@DestinationVariable String boardId, @Payload CursorMessage message) {
        requireValid(boardId);
        messagingTemplate.convertAndSend(topic(boardId, "cursors"), message);
    }

    @MessageMapping("/board/{boardId}/element")
    public void element(@DestinationVariable String boardId, @Payload ElementMessage message) {
        requireValid(boardId);
        if (message.action() == null || message.element() == null) {
            throw new IllegalArgumentException("Missing action or element");
        }
        ElementMessage out = switch (message.action()) {
            // Low-latency path: relay only, no database write until the client commits.
            case DRAGGING -> message;
            case DELETE -> {
                elementService.delete(boardId, message.element().id());
                yield message;
            }
            case CREATE, UPDATE -> {
                ElementDto saved = saveWithRetry(boardId, message.element());
                yield new ElementMessage(message.action(), message.senderId(), saved);
            }
        };
        messagingTemplate.convertAndSend(topic(boardId, "elements"), out);
    }

    private ElementDto saveWithRetry(String boardId, ElementDto dto) {
        for (int attempt = 0; ; attempt++) {
            try {
                return elementService.upsert(boardId, dto);
            } catch (ObjectOptimisticLockingFailureException | DataIntegrityViolationException ex) {
                if (attempt >= 2) throw ex;   // concurrent write or duplicate insert: re-read and retry
            }
        }
    }

    @MessageExceptionHandler
    public void onError(Exception ex) {
        log.warn("Rejected whiteboard message: {}", ex.getMessage());
    }

    private static String topic(String boardId, String channel) {
        return "/topic/board/" + boardId + "/" + channel;
    }

    private static void requireValid(String boardId) {
        if (boardId == null || !BOARD_ID.matcher(boardId).matches()) throw new IllegalArgumentException("Invalid board id");
    }
}
