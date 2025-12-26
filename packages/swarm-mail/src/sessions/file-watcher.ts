import { EventEmitter } from "node:events";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";

/**
 * File event emitted by the watcher
 */
export interface FileEvent {
  /** Absolute path to the file */
  path: string;
  /** Type of file system event */
  event: "added" | "changed" | "unlinked";
}

/**
 * Options for FileWatcher configuration
 */
export interface FileWatcherOptions {
  /** Debounce duration in milliseconds (default: 500ms) */
  debounce?: number;
  /** Only watch files matching this pattern (default: *.jsonl) */
  pattern?: string;
}

/**
 * File watcher with debounced event emission for auto-indexing.
 * 
 * Watches directories for JSONL file changes and emits debounced events
 * to trigger session indexing. Built for CASS inhousing (ADR-010).
 * 
 * Features:
 * - Cross-platform file watching (chokidar)
 * - Debouncing (500ms default, batches rapid changes)
 * - Error recovery with graceful degradation
 * - Start/stop support
 * 
 * @example
 * ```typescript
 * const watcher = new FileWatcher([
 *   "~/.config/swarm-tools/sessions",
 *   "~/Library/Application Support/Cursor/User/History"
 * ]);
 * 
 * watcher.on("file-added", (event) => {
 *   console.log("Index this:", event.path);
 * });
 * 
 * watcher.on("error", (error) => {
 *   console.error("Watcher error:", error);
 * });
 * 
 * await watcher.start();
 * ```
 */
export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly paths: string[];
  private readonly debounce: number;
  private readonly pattern: string;

  /**
   * Create a new file watcher
   * 
   * @param paths - Array of directory paths to watch
   * @param options - Configuration options
   */
  constructor(paths: string[], options: FileWatcherOptions = {}) {
    super();
    this.paths = paths;
    this.debounce = options.debounce ?? 500;
    this.pattern = options.pattern ?? "**/*.jsonl";
  }

  /**
   * Start watching the configured directories
   * 
   * Emits:
   * - 'ready': When watcher is initialized
   * - 'file-added': When a new JSONL file is detected
   * - 'file-changed': When an existing JSONL file is modified
   * - 'file-unlinked': When a JSONL file is removed
   * - 'error': When an error occurs
   */
  async start(): Promise<void> {
    if (this.watcher) {
      // Already started
      return;
    }

    this.watcher = chokidar.watch(this.paths, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    // Set up event handlers
    this.watcher.on("add", (path) => this.handleFileEvent(path, "added"));
    this.watcher.on("change", (path) => this.handleFileEvent(path, "changed"));
    this.watcher.on("unlink", (path) => this.handleFileEvent(path, "unlinked"));

    this.watcher.on("error", (error) => {
      this.emit("error", error);
    });

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      this.watcher!.on("ready", () => {
        this.emit("ready");
        resolve();
      });
    });
  }

  /**
   * Stop watching directories and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close the watcher
    await this.watcher.close();
    this.watcher = null;
  }

  /**
   * Handle a file system event with debouncing
   * 
   * @param path - Absolute path to the file
   * @param event - Type of event (added/changed/unlinked)
   */
  private handleFileEvent(
    path: string,
    event: "added" | "changed" | "unlinked"
  ): void {
    // Filter: only process .jsonl files
    if (!path.endsWith(".jsonl")) {
      return;
    }

    // Clear existing debounce timer for this path
    const existingTimer = this.debounceTimers.get(path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(path);
      
      // Emit event after debounce period
      const fileEvent: FileEvent = { path, event };
      this.emit(`file-${event}`, fileEvent);
    }, this.debounce);

    this.debounceTimers.set(path, timer);
  }
}
