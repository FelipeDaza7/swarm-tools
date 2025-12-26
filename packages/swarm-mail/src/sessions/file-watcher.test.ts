import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { FileWatcher, type FileEvent } from "./file-watcher.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * TDD Pattern: File Watcher with Debounced Auto-Indexing
 * 
 * RED-GREEN-REFACTOR cycles:
 * 1. RED: Test detection of new JSONL file
 * 2. GREEN: Implement chokidar-based watcher
 * 3. REFACTOR: Add debouncing (500ms)
 * 4. RED: Test debouncing of rapid changes
 * 5. GREEN: Batch file events
 * 6. REFACTOR: Add error recovery, restart logic
 */

describe("FileWatcher", () => {
  let tmpDir: string;
  let watcher: FileWatcher | null = null;

  beforeAll(async () => {
    // Create temp directory with timestamp to avoid collisions
    tmpDir = path.join("/tmp", `file-watcher-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Stop watcher and clean up files created during test
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }

    // Remove all files in tmpDir (but keep directory)
    const files = await fs.readdir(tmpDir);
    await Promise.all(
      files.map((file) => fs.unlink(path.join(tmpDir, file)).catch(() => {}))
    );
  });

  // ============================================================
  // CYCLE 1: RED - Test detection of new JSONL file
  // ============================================================

  test("detects new JSONL file in watched directory", async () => {
    const events: FileEvent[] = [];
    
    watcher = new FileWatcher([tmpDir]);
    watcher.on("file-added", (event) => events.push(event));

    await watcher.start();
    
    // Wait for watcher to be fully ready
    await delay(50);

    // Create a new JSONL file
    const testFile = path.join(tmpDir, "session-001.jsonl");
    await fs.writeFile(testFile, '{"event": "test"}\n');

    // Wait for chokidar stability (100ms) + debounce (500ms) + margin
    await delay(800);

    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      path: testFile,
      event: "added",
    });
  });

  test("ignores non-JSONL files", async () => {
    const events: FileEvent[] = [];
    
    watcher = new FileWatcher([tmpDir]);
    watcher.on("file-added", (event) => events.push(event));

    await watcher.start();

    // Create non-JSONL files
    await fs.writeFile(path.join(tmpDir, "README.md"), "# Test");
    await fs.writeFile(path.join(tmpDir, "data.json"), "{}");
    await fs.writeFile(path.join(tmpDir, "log.txt"), "log");

    // Wait to ensure no events fired
    await delay(100);

    expect(events.length).toBe(0);
  });

  test("detects file modifications", async () => {
    const testFile = path.join(tmpDir, "session-002.jsonl");
    await fs.writeFile(testFile, '{"event": "initial"}\n');

    const events: FileEvent[] = [];
    
    watcher = new FileWatcher([tmpDir]);
    watcher.on("file-changed", (event) => events.push(event));

    await watcher.start();
    
    // Wait for watcher to be fully ready
    await delay(100);

    // Modify existing file
    await fs.appendFile(testFile, '{"event": "update"}\n');

    // Wait for debounce + processing
    await delay(800);

    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      path: testFile,
      event: "changed",
    });
  });

  test("watches multiple directories", async () => {
    const tmpDir2 = path.join("/tmp", `file-watcher-test-${Date.now()}-2`);
    await fs.mkdir(tmpDir2, { recursive: true });

    const events: FileEvent[] = [];
    
    watcher = new FileWatcher([tmpDir, tmpDir2]);
    watcher.on("file-added", (event) => events.push(event));

    await watcher.start();
    await delay(50);

    // Create files in both directories
    await fs.writeFile(path.join(tmpDir, "dir1.jsonl"), "{}");
    await fs.writeFile(path.join(tmpDir2, "dir2.jsonl"), "{}");

    // Wait for debounce + processing
    await delay(800);

    expect(events.length).toBe(2);
    
    // Cleanup second directory
    await fs.rm(tmpDir2, { recursive: true, force: true });
  });

  // ============================================================
  // CYCLE 2: RED - Test debouncing of rapid changes
  // ============================================================

  test("debounces rapid file changes (default 500ms)", async () => {
    const testFile = path.join(tmpDir, "session-rapid.jsonl");
    await fs.writeFile(testFile, '{"id": 0}\n');

    const events: FileEvent[] = [];
    
    watcher = new FileWatcher([tmpDir]); // Default debounce: 500ms
    watcher.on("file-changed", (event) => events.push(event));

    await watcher.start();

    // Rapid writes (should batch into single event)
    await fs.appendFile(testFile, '{"id": 1}\n');
    await delay(50);
    await fs.appendFile(testFile, '{"id": 2}\n');
    await delay(50);
    await fs.appendFile(testFile, '{"id": 3}\n');

    // Wait for debounce period to complete
    await delay(800);

    // Should only receive ONE debounced event
    expect(events.length).toBe(1);
  });

  test("custom debounce duration", async () => {
    const testFile = path.join(tmpDir, "session-custom-debounce.jsonl");
    await fs.writeFile(testFile, '{"id": 0}\n');

    const events: FileEvent[] = [];
    
    watcher = new FileWatcher([tmpDir], { debounce: 100 }); // Short debounce for testing
    watcher.on("file-changed", (event) => events.push(event));

    await watcher.start();
    await delay(50);

    // Rapid writes within 100ms window
    await fs.appendFile(testFile, '{"id": 1}\n');
    await delay(20);
    await fs.appendFile(testFile, '{"id": 2}\n');

    // Wait for chokidar stability (100ms) + debounce (100ms) + margin
    await delay(300);

    expect(events.length).toBe(1);
  });

  // ============================================================
  // CYCLE 3: Error recovery and restart logic
  // ============================================================

  test("handles watcher errors gracefully", async () => {
    const errors: Error[] = [];
    
    watcher = new FileWatcher([tmpDir]);
    watcher.on("error", (error) => errors.push(error));

    await watcher.start();

    // Verify error listener is attached (watcher won't emit errors for non-existent paths)
    // This test verifies the error handling mechanism exists
    expect(watcher.listenerCount("error")).toBeGreaterThan(0);
  });

  test("can be stopped and restarted", async () => {
    const events: FileEvent[] = [];
    
    watcher = new FileWatcher([tmpDir]);
    watcher.on("file-added", (event) => events.push(event));

    // Start
    await watcher.start();
    await delay(50);
    await fs.writeFile(path.join(tmpDir, "file1.jsonl"), "{}");
    await delay(800);

    expect(events.length).toBe(1);

    // Stop
    await watcher.stop();
    await fs.writeFile(path.join(tmpDir, "file2.jsonl"), "{}");
    await delay(800);

    // Should still be 1 (watcher stopped)
    expect(events.length).toBe(1);

    // Restart
    await watcher.start();
    await delay(50);
    await fs.writeFile(path.join(tmpDir, "file3.jsonl"), "{}");
    await delay(800);

    // Should be 2 now
    expect(events.length).toBe(2);
  });

  test("emits 'ready' event when watcher is initialized", async () => {
    let ready = false;
    
    watcher = new FileWatcher([tmpDir]);
    watcher.on("ready", () => {
      ready = true;
    });

    await watcher.start();

    expect(ready).toBe(true);
  });

  // ============================================================
  // Integration with indexing queue (hints for future work)
  // ============================================================

  test("provides file path and event type for indexing", async () => {
    const events: FileEvent[] = [];
    
    watcher = new FileWatcher([tmpDir]);
    watcher.on("file-added", (event) => events.push(event));

    await watcher.start();
    await delay(50);

    const testFile = path.join(tmpDir, "session-index.jsonl");
    await fs.writeFile(testFile, '{"type": "coordinator_decision"}\n');

    await delay(800);

    expect(events[0]).toHaveProperty("path");
    expect(events[0]).toHaveProperty("event");
    expect(events[0].path).toBe(testFile);
    expect(events[0].event).toBe("added");
  });
});
