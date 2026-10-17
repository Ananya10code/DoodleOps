package com.example.backend.repository;

import com.example.backend.model.BoardElement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface BoardElementRepository extends JpaRepository<BoardElement, String> {

    @Query("SELECT b FROM BoardElement b WHERE b.boardId = :boardId ORDER BY b.zIndex ASC")
    List<BoardElement> findByBoardIdOrderByZIndexAsc(@Param("boardId") String boardId);

    void deleteByBoardId(String boardId);
}