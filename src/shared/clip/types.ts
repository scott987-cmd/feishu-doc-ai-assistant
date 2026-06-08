/**
 * Web Clipper — shared types and message contracts.
 *
 * Security note: a clip is captured from the ACTIVE tab only, on an explicit user gesture
 * (context menu / action click / keyboard command), via chrome.scripting.executeScript +
 * `activeTab`. No broad host_permissions, no new network egress — reading the page DOM is
 * local. The captured text is shown to the user (preview) BEFORE anything leaves the panel.
 */

export interface ClipCapture {
  /** Source page URL. */
  url: string
  /** Source page title. */
  title: string
  /** The user's text selection at capture time (empty if none). */
  selectedText: string
  /** Readable main content of the page (used when there's no selection). */
  content: string
  /** Set when this clip is a SCREENSHOT pending vision recognition; `content` is filled in
   *  after the vision model extracts a Markdown table from the image. */
  imageDataUrl?: string
  /** ms epoch when captured (stamped in the page world). */
  capturedAt: number
  /** True if `content` was truncated to the size cap. */
  truncated: boolean
}

/** Max characters of page content we capture/send (avoid dumping a whole huge page). */
export const MAX_CLIP_CHARS = 50_000

/** background → side panel: a fresh clip is ready. */
export interface ClipCaptureMessage {
  type: 'CLIP_CAPTURE'
  payload: ClipCapture
}

/** side panel → background: panel just mounted, pull any pending clip (open→message race). */
export interface ClipRequestMessage {
  type: 'CLIP_REQUEST'
}
