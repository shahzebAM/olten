import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, pointerWithin, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, KeyboardCoordinateGetter } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { defaultWorkspaceMenuGroups, moveWorkspaceMenuGroup, moveWorkspaceMenuItem, normalizeWorkspaceMenuGroups, parseWorkspaceMenuGroups, workspaceNavigation } from '../lib/workspaceNavigation';
import type { WorkspaceMenuGroup } from '../lib/workspaceNavigation';

type Props = {
  company: string;
  groups: WorkspaceMenuGroup[];
  version?: number;
  onSave: (groups: WorkspaceMenuGroup[], expectedVersion?: number) => Promise<void>;
  onClose: () => void;
};

const button = 'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40';
const dragIcon = <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="1.5" /><circle cx="11" cy="5" r="1.5" /><circle cx="5" cy="10" r="1.5" /><circle cx="11" cy="10" r="1.5" /><circle cx="5" cy="15" r="1.5" /><circle cx="11" cy="15" r="1.5" /></svg>;

const workspaceMenuKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { context } = args;
  const activeKind = context.active?.data.current?.kind;
  // Nested module rectangles must not intercept a heading's next keyboard target.
  const eligibleRects = new Map([...context.droppableRects].filter(([id]) => {
    const target = context.droppableContainers.get(id)?.data.current;
    return activeKind === 'group' ? target?.kind === 'group' : target?.kind === 'item' || (target?.kind === 'group' && target.empty === true);
  }));
  return sortableKeyboardCoordinates(event, { ...args, context: { ...context, droppableRects: eligibleRects } });
};

function SortableMenuRow({ id, kind, busy, label, empty = false, children }: {
  id: string;
  kind: 'group' | 'item';
  busy: boolean;
  label: string;
  empty?: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `${kind}:${id}`, data: { kind, id, empty }, disabled: busy });
  return <div ref={setNodeRef} className={kind === 'group' ? 'erp-menu-group rounded-lg border border-slate-200 bg-white' : 'erp-menu-item flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2'} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1, position: 'relative', zIndex: isDragging ? 2 : undefined }}>
    <button type="button" {...attributes} {...listeners} disabled={busy} className="erp-menu-drag-handle rounded px-1 py-2 text-slate-500" style={{ touchAction: 'none', cursor: busy ? undefined : 'grab' }} aria-label={`Drag ${label}`} title={`Drag ${label}; keyboard: Space to pick up, arrows to move, Space to drop`}>{dragIcon}</button>
    {children}
  </div>;
}

export default function WorkspaceMenuEditor({ company, groups, version, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(() => normalizeWorkspaceMenuGroups(groups));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const saveLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [baseline] = useState(() => JSON.stringify(normalizeWorkspaceMenuGroups(groups)));
  const dirty = JSON.stringify(draft) !== baseline;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: workspaceMenuKeyboardCoordinates }),
  );

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const modal = dialog.current;
    modal?.showModal();
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      modal?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const close = () => { if (!saveLock.current) onClose(); };
  const trapKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? []);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const collision: CollisionDetection = args => {
    if (args.active.data.current?.kind === 'group') return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(container => container.data.current?.kind === 'group') });
    const underPointer = pointerWithin(args);
    const items = underPointer.filter(hit => args.droppableContainers.find(container => container.id === hit.id)?.data.current?.kind === 'item');
    return items.length ? items : underPointer.length ? underPointer : closestCenter(args);
  };
  const moveItem = (id: string, groupId: string, index: number) => {
    setDraft(current => moveWorkspaceMenuItem(current, id, groupId, index));
    const item = workspaceNavigation.find(item => item.id === id);
    setAnnouncement(`${item?.title ?? 'Module'} moved to ${draft.find(group => group.id === groupId)?.title ?? 'heading'}.`);
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (busy || !over || active.id === over.id) return;
    const activeData = active.data.current;
    const targetData = over.data.current;
    if (typeof activeData?.id !== 'string' || typeof targetData?.id !== 'string') return;
    if (activeData.kind === 'group') {
      const targetIndex = draft.findIndex(group => group.id === targetData.id);
      if (targetIndex >= 0) setDraft(current => moveWorkspaceMenuGroup(current, activeData.id, targetIndex));
      return;
    }
    const targetGroup = targetData.kind === 'group' ? draft.find(group => group.id === targetData.id) : draft.find(group => group.items.includes(targetData.id));
    if (targetGroup) moveItem(activeData.id, targetGroup.id, targetData.kind === 'group' ? targetGroup.items.length : targetGroup.items.indexOf(targetData.id));
  };
  const save = async () => {
    if (saveLock.current) return;
    const validated = parseWorkspaceMenuGroups(draft);
    if (!validated) { setError('Give each heading a name of 1–60 characters. Every module must remain assigned exactly once.'); return; }
    saveLock.current = true; setBusy(true); setError('');
    try { await onSave(validated, version); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The company menu could not be saved. Your edits are retained.'); }
    finally { saveLock.current = false; setBusy(false); }
  };

  const content = <div className="erp-modern erp-menu-editor-backdrop fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
    <dialog ref={dialog} aria-modal="true" aria-labelledby="workspace-menu-title" aria-describedby="workspace-menu-description" onKeyDown={trapKeys} onCancel={event => { event.preventDefault(); close(); }} className="erp-menu-editor m-auto flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white text-slate-900 shadow-2xl">
      <div className="erp-menu-editor-header flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
        <div><h2 id="workspace-menu-title" className="text-lg font-bold">Edit company menu</h2><p id="workspace-menu-description" className="mt-1 text-sm text-slate-600">{company} · Rename and arrange headings, then move modules between them. This menu is shared by everyone in this company; their existing access permissions still apply.</p></div>
        <button type="button" className={button} disabled={busy} onClick={close} aria-label="Close menu editor">✕</button>
      </div>
      <div className="erp-menu-editor-body space-y-4 overflow-y-auto p-4 sm:p-5">
        <p className="text-xs text-slate-600">Use the drag handles or the move controls. On a keyboard, focus a handle, press Space, use the arrow keys, then press Space to drop.</p>
        {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
        <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={dragEnd}>
          <SortableContext items={draft.map(group => `group:${group.id}`)} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {draft.map((group, groupIndex) => <SortableMenuRow key={group.id} id={group.id} kind="group" label={`${group.title || 'Untitled'} heading`} busy={busy} empty={group.items.length === 0}>
                <div className="erp-menu-group-header flex flex-wrap items-end gap-2 border-b border-slate-200 p-3">
                  <label className="min-w-40 flex-1 text-xs font-semibold text-slate-600">Heading name<input type="text" aria-label={`Heading ${groupIndex + 1} name`} maxLength={60} disabled={busy} value={group.title} onChange={event => setDraft(current => current.map(item => item.id === group.id ? { ...item, title: event.target.value } : item))} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" /></label>
                  <div className="erp-menu-move-controls flex flex-wrap gap-1">
                    <button type="button" className={button} aria-label={`Move ${group.title || 'heading'} up`} disabled={busy || groupIndex === 0} onClick={() => setDraft(current => moveWorkspaceMenuGroup(current, group.id, groupIndex - 1))}>↑</button>
                    <button type="button" className={button} aria-label={`Move ${group.title || 'heading'} down`} disabled={busy || groupIndex === draft.length - 1} onClick={() => setDraft(current => moveWorkspaceMenuGroup(current, group.id, groupIndex + 1))}>↓</button>
                    <button type="button" className={button} disabled={busy || group.items.length > 0 || draft.length === 1} title={group.items.length ? 'Move its modules to another heading first.' : 'Remove this empty heading'} onClick={() => setDraft(current => current.filter(item => item.id !== group.id))}>Remove empty heading</button>
                  </div>
                </div>
                <SortableContext items={group.items.map(id => `item:${id}`)} strategy={verticalListSortingStrategy}>
                  <div className="min-h-12 space-y-2 p-3">
                    {!group.items.length && <p className="py-3 text-center text-xs text-slate-500">Drop a module here or choose this heading from its move menu.</p>}
                    {group.items.map((id, itemIndex) => {
                      const item = workspaceNavigation.find(item => item.id === id);
                      if (!item) return null;
                      return <SortableMenuRow key={id} id={id} kind="item" label={item.title} busy={busy}>
                        <span className="min-w-36 flex-1 text-sm font-semibold">{item.title}</span>
                        <div className="erp-menu-move-controls flex flex-wrap items-center gap-1">
                          <button type="button" className={button} aria-label={`Move ${item.title} up`} disabled={busy || itemIndex === 0} onClick={() => moveItem(id, group.id, itemIndex - 1)}>↑</button>
                          <button type="button" className={button} aria-label={`Move ${item.title} down`} disabled={busy || itemIndex === group.items.length - 1} onClick={() => moveItem(id, group.id, itemIndex + 1)}>↓</button>
                          <label className="text-xs text-slate-600"><span className="sr-only">Move {item.title} to heading</span><select aria-label={`Move ${item.title} to heading`} disabled={busy} value={group.id} onChange={event => moveItem(id, event.target.value, draft.find(target => target.id === event.target.value)?.items.length ?? 0)} className="max-w-44 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs">{draft.map(target => <option key={target.id} value={target.id}>{target.title || 'Untitled heading'}</option>)}</select></label>
                        </div>
                      </SortableMenuRow>;
                    })}
                  </div>
                </SortableContext>
              </SortableMenuRow>)}
            </div>
          </SortableContext>
        </DndContext>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy || draft.length >= 30} onClick={() => setDraft(current => [...current, { id: `custom-${crypto.randomUUID()}`, title: 'New heading', items: [] }])}>+ Add heading</button>
          <button type="button" className={button} disabled={busy} onClick={() => { setDraft(defaultWorkspaceMenuGroups()); setError(''); }}>Use default groups</button>
        </div>
      </div>
      <div className="erp-menu-editor-footer flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 p-4">
        <p className="text-xs text-slate-600">{dirty ? 'Unsaved menu changes' : 'No unsaved changes'} · Module access is unchanged.</p>
        <div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={close}>Cancel</button><button type="button" disabled={busy || !dirty} onClick={() => { void save(); }} className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save company menu'}</button></div>
      </div>
    </dialog>
  </div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
