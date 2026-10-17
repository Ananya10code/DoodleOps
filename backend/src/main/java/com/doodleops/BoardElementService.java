package com.doodleops;

import com.doodleops.Messages.ElementDto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

@Service
public class BoardElementService {

    private static final Set<String> TYPES = Set.of("stroke", "rect", "circle", "sticky");
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9-]{1,36}$");
    private static final int MAX_PAYLOAD_CHARS = 1_000_000;

    private final BoardElementRepository elementRepository;

    public BoardElementService(BoardElementRepository elementRepository) {
        this.elementRepository = elementRepository;
    }

    @Transactional(readOnly = true)
    public List<ElementDto> list(String boardId) {
        return elementRepository.findByBoardIdOrderByZIndexAsc(boardId).stream().map(ElementDto::from).toList();
    }

    @Transactional
    public ElementDto upsert(String boardId, ElementDto dto) {
        validate(dto);
        BoardElement e = elementRepository.findById(dto.id()).orElseGet(() -> {
            BoardElement created = new BoardElement();
            created.setId(dto.id());
            created.setBoardId(boardId);
            return created;
        });
        if (!boardId.equals(e.getBoardId())) {
            throw new IllegalArgumentException("Element belongs to a different board");
        }
        e.setType(dto.type());
        e.setX(dto.x());
        e.setY(dto.y());
        e.setWidth(dto.width());
        e.setHeight(dto.height());
        e.setStrokeColor(dto.strokeColor());
        e.setFillColor(dto.fillColor());
        e.setStrokeWidth(Math.max(1, Math.min(64, dto.strokeWidth())));
        e.setZIndex(dto.zIndex());
        e.setPayload(dto.payload());
        return ElementDto.from(elementRepository.save(e));
    }

    @Transactional
    public void delete(String boardId, String id) {
        elementRepository.findById(id)
                .filter(e -> e.getBoardId().equals(boardId))
                .ifPresent(elementRepository::delete);
    }

    private static void validate(ElementDto d) {
        if (d == null || d.id() == null || !ID.matcher(d.id()).matches()) throw new IllegalArgumentException("Invalid element id");
        if (d.type() == null || !TYPES.contains(d.type())) throw new IllegalArgumentException("Invalid element type");
        if (!Double.isFinite(d.x()) || !Double.isFinite(d.y())) throw new IllegalArgumentException("Invalid coordinates");
        if (d.strokeColor() != null && d.strokeColor().length() > 20) throw new IllegalArgumentException("Invalid stroke color");
        if (d.fillColor() != null && d.fillColor().length() > 20) throw new IllegalArgumentException("Invalid fill color");
        if (d.payload() != null && d.payload().length() > MAX_PAYLOAD_CHARS) throw new IllegalArgumentException("Payload too large");
    }
}
