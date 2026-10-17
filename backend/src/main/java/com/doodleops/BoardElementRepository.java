package com.doodleops;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BoardElementRepository extends JpaRepository<BoardElement, String> {
    List<BoardElement> findByBoardIdOrderByZIndexAsc(String boardId);
}
