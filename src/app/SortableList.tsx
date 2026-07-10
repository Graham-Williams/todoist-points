"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

interface SortableListProps<T> {
  items: T[];
  getKey: (item: T) => string;
  // Called after a drop with the fully reordered array.
  onReorder: (newItems: T[]) => void;
  // The ROW CONTENT (no handle — SortableList adds the grip itself).
  renderItem: (item: T) => ReactNode;
  ulClassName?: string;
  liClassName?: string;
}

// A drag-to-reorder list. Only the grip handle initiates a drag (the
// PointerSensor's 5px activation constraint + attaching listeners to the handle
// only) so the row's buttons and number inputs stay fully clickable. Touch-
// friendly: the handle has `touch-none` so dragging it doesn't scroll the page.
export default function SortableList<T>({
  items,
  getKey,
  onReorder,
  renderItem,
  ulClassName,
  liClassName,
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const keys = items.map(getKey);
    const oldIndex = keys.indexOf(String(active.id));
    const newIndex = keys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  const keys = items.map(getKey);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <ul className={ulClassName}>
          {items.map((item) => (
            <SortableRow
              key={getKey(item)}
              id={getKey(item)}
              liClassName={liClassName}
            >
              {renderItem(item)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  liClassName,
  children,
}: {
  id: string;
  liClassName?: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the row being dragged above its siblings for a clear affordance.
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-2 ${liClassName ?? ""}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label="Drag to reorder"
        className="cursor-grab touch-none select-none px-1 pt-1 text-slate-500 hover:text-slate-300"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
