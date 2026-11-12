import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSubmit } from "../hooks/useSubmit";
import { IconClose, IconMore } from "./icons";
import { ErrorNotice } from "./ui";

const FOCUSABLE = 'input:not([disabled]),select:not([disabled]),textarea,button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

/** A modal dialog: Esc and backdrop close it, Tab stays inside, focus returns to where it was. */
export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = root.current!;
    const previous = document.activeElement as HTMLElement | null;
    (el.querySelector<HTMLElement>("input:not([disabled]),select") ?? el.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab") {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={root} className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** "Are you sure?" for destructive actions. Nothing is sent until the red button is pressed. */
export function ConfirmDialog({
  title, children, confirmLabel, onConfirm, onClose,
}: {
  title: string; children: ReactNode; confirmLabel: string; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const action = useSubmit(onConfirm);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <p>{children}</p>
        {action.error && <ErrorNotice error={action.error} />}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger-solid" disabled={action.busy}
            onClick={async () => { if ((await action.run()) !== undefined) onClose(); }}>
            {action.busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean }

/** A "⋯" button that opens a small menu. Keyboard: Enter/Space opens, arrows move, Esc closes. */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = trigger.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    menu.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    const buttons = [...(menu.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <>
      <button ref={trigger} type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <IconMore />
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="menu" role="menu" aria-label={label} style={{ top: pos.top, right: pos.right }} onKeyDown={onMenuKey}>
            {items.map((item) => (
              <button key={item.label} type="button" role="menuitem" className={item.danger ? "menu-item menu-danger" : "menu-item"}
                onClick={() => { setOpen(false); item.onSelect(); }}>
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
