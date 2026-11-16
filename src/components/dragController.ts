import { Platform } from "obsidian";

export interface DragHandlers {
	/** 拖拽者是否不允许落到该行（拖到自己或自己的后代上）。 */
	isForbidden(draggedId: string, targetId: string): boolean;
	onDropOn(draggedId: string, targetId: string): void;
	onDropBetween(draggedId: string, targetId: string, position: "before" | "after"): void;
	onDropRoot(draggedId: string): void;
}

export interface DragController {
	attach(listEl: HTMLElement): void;
	destroy(): void;
}

/** 行的上 1/4 = 前插，下 1/4 = 后插，中间 = 成为子页面。 */
const EDGE_RATIO = 0.25;

/**
 * 桌面端 HTML5 拖放。移动端不接（触摸拖拽要 Pointer Events + 自动滚动，收益不抵复杂度）。
 * 落点反馈全部靠行上的 CSS 类，不插额外 DOM，也就没有绝对定位与滚动同步的问题。
 */
export function createDragController(handlers: DragHandlers): DragController {
	let draggedId: string | null = null;
	let list: HTMLElement | null = null;

	const rows = (): HTMLElement[] => (list ? Array.from(list.querySelectorAll<HTMLElement>(".sp-row")) : []);

	const clearMarks = (): void => {
		for (const row of rows()) {
			row.removeClass("is-drop-target");
			row.removeClass("is-drop-before");
			row.removeClass("is-drop-after");
			row.removeClass("is-dragging");
		}
		list?.removeClass("is-drop-root");
	};

	const onDragStart = (event: DragEvent): void => {
		const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(".sp-row");
		const id = row?.getAttribute("data-id");
		if (!row || !id) return;
		draggedId = id;
		row.addClass("is-dragging");
		event.dataTransfer?.setData("text/plain", id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
	};

	const onDragOver = (event: DragEvent): void => {
		if (!draggedId || !list) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

		const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(".sp-row");
		const id = row?.getAttribute("data-id");
		clearMarks();
		if (!row || !id) {
			list.addClass("is-drop-root");
			return;
		}
		if (handlers.isForbidden(draggedId, id)) return;

		const rect = row.getBoundingClientRect();
		const ratio = rect.height === 0 ? 0.5 : (event.clientY - rect.top) / rect.height;
		if (ratio < EDGE_RATIO) row.addClass("is-drop-before");
		else if (ratio > 1 - EDGE_RATIO) row.addClass("is-drop-after");
		else row.addClass("is-drop-target");
	};

	const onDrop = (event: DragEvent): void => {
		if (!draggedId) return;
		event.preventDefault();
		const dragged = draggedId;
		const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(".sp-row");
		const id = row?.getAttribute("data-id");
		const mode = !row || !id ? "root" : row.hasClass("is-drop-before") ? "before" : row.hasClass("is-drop-after") ? "after" : "on";
		draggedId = null;
		clearMarks();
		if (mode === "root" || !id) {
			handlers.onDropRoot(dragged);
			return;
		}
		if (id === dragged || handlers.isForbidden(dragged, id)) return;
		if (mode === "on") handlers.onDropOn(dragged, id);
		else handlers.onDropBetween(dragged, id, mode);
	};

	const onDragEnd = (): void => {
		draggedId = null;
		clearMarks();
	};

	const onDragLeave = (event: DragEvent): void => {
		// 只在真正离开列表时清标记，否则跨行会一路闪。
		if (list && !list.contains(event.relatedTarget as Node | null)) clearMarks();
	};

	return {
		attach(element: HTMLElement): void {
			list = element;
			if (!Platform.isDesktopApp) return;
			element.addEventListener("dragstart", onDragStart);
			element.addEventListener("dragover", onDragOver);
			element.addEventListener("drop", onDrop);
			element.addEventListener("dragend", onDragEnd);
			element.addEventListener("dragleave", onDragLeave);
		},
		destroy(): void {
			clearMarks();
			list = null;
			draggedId = null;
		},
	};
}
