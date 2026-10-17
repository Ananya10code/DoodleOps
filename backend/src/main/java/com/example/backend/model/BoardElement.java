package com.example.backend.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "board_elements", indexes = {
        @Index(name = "idx_element_board_id", columnList = "board_id")
})
public class BoardElement {

    @Id
    @Column(name = "id", length = 64, nullable = false)
    private String id;

    @Column(name = "board_id", length = 64, nullable = false)
    private String boardId;

    @Column(name = "type", length = 32, nullable = false)
    private String type; // 'rect', 'circle', 'stroke', 'text'

    @Column(name = "x_pos")
    private Double x;

    @Column(name = "y_pos")
    private Double y;

    @Column(name = "width")
    private Double width;

    @Column(name = "height")
    private Double height;

    @Column(name = "stroke_color", length = 32)
    private String strokeColor;

    @Column(name = "fill_color", length = 32)
    private String fillColor;

    @Column(name = "stroke_width")
    private Integer strokeWidth;

    @Column(name = "z_index")
    private Integer zIndex;

    @Lob
    @Column(name = "payload", columnDefinition = "LONGTEXT")
    private String payload;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public BoardElement() {
    }

    @PrePersist
    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getBoardId() {
        return boardId;
    }

    public void setBoardId(String boardId) {
        this.boardId = boardId;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public Double getX() {
        return x;
    }

    public void setX(Double x) {
        this.x = x;
    }

    public Double getY() {
        return y;
    }

    public void setY(Double y) {
        this.y = y;
    }

    public Double getWidth() {
        return width;
    }

    public void setWidth(Double width) {
        this.width = width;
    }

    public Double getHeight() {
        return height;
    }

    public void setHeight(Double height) {
        this.height = height;
    }

    public String getStrokeColor() {
        return strokeColor;
    }

    public void setStrokeColor(String strokeColor) {
        this.strokeColor = strokeColor;
    }

    public String getFillColor() {
        return fillColor;
    }

    public void setFillColor(String fillColor) {
        this.fillColor = fillColor;
    }

    public Integer getStrokeWidth() {
        return strokeWidth;
    }

    public void setStrokeWidth(Integer strokeWidth) {
        this.strokeWidth = strokeWidth;
    }

    public Integer getZIndex() {
        return zIndex;
    }

    public void setZIndex(Integer zIndex) {
        this.zIndex = zIndex;
    }

    public String getPayload() {
        return payload;
    }

    public void setPayload(String payload) {
        this.payload = payload;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}