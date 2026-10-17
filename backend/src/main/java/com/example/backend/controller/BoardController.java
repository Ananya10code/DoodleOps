package com.example.backend.controller;

import com.example.backend.model.Board;
import com.example.backend.model.BoardElement;
import com.example.backend.repository.BoardElementRepository;
import com.example.backend.repository.BoardRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/boards")
@CrossOrigin(origins = "*")
public class BoardController {

    private final BoardRepository boardRepository;
    private final BoardElementRepository elementRepository;

    public BoardController(BoardRepository boardRepository, BoardElementRepository elementRepository) {
        this.boardRepository = boardRepository;
        this.elementRepository = elementRepository;
    }

    // Create or fetch board
    @PostMapping
    public ResponseEntity<Board> createBoard(@RequestParam(defaultValue = "Untitled Whiteboard") String title) {
        String boardId = UUID.randomUUID().toString().substring(0, 8);
        Board board = boardRepository.save(new Board(boardId, title));
        return ResponseEntity.ok(board);
    }

    // Get board metadata
    @GetMapping("/{boardId}")
    public ResponseEntity<Board> getBoard(@PathVariable String boardId) {
        return boardRepository.findById(boardId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // Load all canvas elements for initial render
    @GetMapping("/{boardId}/elements")
    public ResponseEntity<List<BoardElement>> getBoardElements(@PathVariable String boardId) {
        List<BoardElement> elements = elementRepository.findByBoardIdOrderByZIndexAsc(boardId);
        return ResponseEntity.ok(elements);
    }
}