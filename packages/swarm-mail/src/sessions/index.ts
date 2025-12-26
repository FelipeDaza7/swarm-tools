/**
 * Sessions Module - Session indexing and search
 *
 * Provides session parsing, chunking, embedding, and search capabilities
 * for multi-agent conversation history.
 *
 * @module sessions
 */

// Chunk processor (message-level chunking + embedding)
export {
	ChunkProcessor,
	type EmbeddedChunk,
	type MessageChunk,
	type NormalizedMessage,
} from "./chunk-processor.js";

// File watcher (auto-indexing)
// export {
// 	FileWatcher,
// 	type FileWatcherOptions,
// 	type WatchEvent,
// } from "./file-watcher.js";

// Session parser (JSONL → NormalizedMessage)
// export {
// 	SessionParser,
// 	type SessionParserOptions,
// } from "./session-parser.js";

// Session viewer (JSONL line reader)
// export {
// 	SessionViewer,
// 	type SessionViewerOptions,
// } from "./session-viewer.js";

// Staleness detector (track index freshness)
export {
	StalenessDetector,
	type IndexState,
	type RecordIndexedOpts,
	type CheckStalenessOpts,
	type BulkStalenessCheckItem,
	type BulkStalenessResult,
} from "./staleness-detector.js";

// Pagination (field projection for compact output)
export {
	FIELD_SETS,
	projectSearchResult,
	projectSearchResults,
	type FieldSelection,
	type FieldSet,
	type MemoryField,
	type SearchResultField,
} from "./pagination.js";

// Session indexer (main orchestrator)
export {
	SessionIndexer,
	type IndexDirectoryOptions,
	type IndexFileResult,
	type IndexHealth,
	type SearchOptions,
	type SessionStats,
	type StalenessResult,
} from "./session-indexer.js";
