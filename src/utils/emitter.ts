/**
 * 极简事件源：索引变化要通知侧栏、正文块、设置面板等多个消费者，
 * 直接互相引用会绕成环，换成「谁关心谁订阅」。
 */
export class Emitter<T> {
	private listeners = new Set<(value: T) => void>();

	on(listener: (value: T) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(value: T): void {
		for (const listener of Array.from(this.listeners)) {
			try {
				listener(value);
			} catch (error) {
				// 一个订阅者出错不该拖垮其它订阅者（正文块可能已经被卸载）。
				console.error("[sub-page] 订阅者出错", error);
			}
		}
	}

	clear(): void {
		this.listeners.clear();
	}
}
