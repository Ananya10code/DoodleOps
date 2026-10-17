package com.doodleops;

import com.doodleops.Messages.ElementDto;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.regex.Pattern;

@RestController
public class BoardRestController {

    private static final Pattern BOARD_ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private final BoardElementService elementService;

    public BoardRestController(BoardElementService elementService) {
        this.elementService = elementService;
    }

    /** Canvas hydration on initial page load and after every reconnect. */
    @GetMapping("/api/boards/{boardId}/elements")
    public ResponseEntity<List<ElementDto>> elements(@PathVariable String boardId) {
        if (!BOARD_ID.matcher(boardId).matches()) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(elementService.list(boardId));
    }
}
