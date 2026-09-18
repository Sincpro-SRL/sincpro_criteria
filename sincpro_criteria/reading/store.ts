/**
 * The smallest thing that can be watched.
 *
 * A reading holds state that changes over time, and something has to hear about it. This is
 * that something, in twenty lines and with no framework: `subscribe` returns the function
 * that stops listening, and the snapshot keeps its identity until the state actually changes
 * — which is exactly the contract React's `useSyncExternalStore` asks for, and what every
 * other framework's adapter is happy with.
 *
 * @module
 */

/** Something whose state can be read and watched. */
export interface Watchable<S> {
  /** The state as it is now. The same object until something changes it. */
  snapshot(): S;

  /** Hears about every change until the returned function is called. */
  subscribe(listener: () => void): () => void;
}

/** Holds one state object and tells the listeners when it is replaced. */
export class Store<S> implements Watchable<S> {
  private state: S;
  private readonly listeners = new Set<() => void>();

  constructor(initial: S) {
    this.state = initial;
  }

  snapshot(): S {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Replaces the state with what the given part changes, and tells everyone. */
  protected write(part: Partial<S>): void {
    this.state = { ...this.state, ...part };
    for (const listener of [...this.listeners]) listener();
  }
}
