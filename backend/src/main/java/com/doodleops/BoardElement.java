package com.doodleops;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

/**
 * A single canvas element. Geometry conventions:
 *  - rect / sticky : x,y = top-left, width/height = size
 *  - circle        : x,y = centre,   width = height = diameter
 *  - stroke        : x,y = offset,   payload = JSON array [x1,y1,x2,y2,...]
 *  - sticky        : payload = note text
 */
@Entity
@Table(name = "board_element",
       indexes = @Index(name = "idx_board_element_board_id", columnList = "board_id"))
@Getter @Setter @NoArgsConstructor
public class BoardElement {

    @Id
    @Column(length = 36)
    private String id;

    @Column(name = "board_id", nullable = false, length = 64)
    private String boardId;

    @Column(nullable = false, length = 20)
    private String type;

    @Column(nullable = false)
    private double x;

    @Column(nullable = false)
    private double y;

    private Double width;
    private Double height;

    @Column(name = "stroke_color", length = 20)
    private String strokeColor;

    @Column(name = "fill_color", length = 20)
    private String fillColor;

    @Column(name = "stroke_width", nullable = false)
    private int strokeWidth;

    @Column(name = "z_index", nullable = false)
    private int zIndex;

    @Column(columnDefinition = "LONGTEXT")
    private String payload;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Optimistic locking: concurrent writers to the same row get a retryable conflict. */
    @Version
    private Long version;
}
