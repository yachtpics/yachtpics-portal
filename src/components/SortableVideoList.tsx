"use client";

import type { ReactNode } from "react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Drag-to-reorder for a listing's videos — shared by the broker and admin
 * listing pages so both behave identically.
 *
 * Only the grip handle starts a drag, and the pointer has to travel a few
 * pixels first (same threshold as the photo grid), so taps on the card's
 * buttons and the video's own controls are never mistaken for a drag.
 *
 * The list only reports the move; the page owns the state and the write.
 */
export default function SortableVideoList<T extends { id: string }>({
  items,
  onMove,
  children,
}: {
  items: T[];
  /** Called once per completed drag with the dragged id and the id it was dropped on. */
  onMove: (activeId: string, overId: string) => void;
  /** Render one card. Place `handle` wherever the grip should sit. */
  children: (item: T, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onMove(String(active.id), String(over.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((v) => v.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-4">
          {items.map((item) => (
            <SortableVideoItem key={item.id} id={item.id} disabled={items.length < 2}>
              {(handle) => children(item, handle)}
            </SortableVideoItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableVideoItem({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

  // Same grip as the photo grid. touch-none on the handle only, so a finger on
  // the grip drags the card on a phone while the rest of the page still scrolls.
  const handle = disabled ? null : (
    <div
      {...attributes}
      {...listeners}
      title="Drag to reorder"
      aria-label="Drag to reorder"
      className="flex h-11 w-11 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-white border border-hairline text-ink-700 shadow-elev-1 hover:bg-ink-50 hover:text-ink-950 cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <circle cx="4" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/>
        <circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/>
        <circle cx="4" cy="9" r="1.2"/><circle cx="8" cy="9" r="1.2"/>
      </svg>
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        // Translate, not Transform: cards differ in height and scaling one to
        // another's size mid-drag looks broken.
        transform: CSS.Translate.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 20 : undefined,
        opacity: isDragging ? 0.85 : undefined,
      }}
    >
      {children(handle)}
    </div>
  );
}
