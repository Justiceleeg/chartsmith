/**
 * Fuzzy string matching for LLM string replacement operations.
 * Ported from pkg/llm/execute-action.go:319-435
 *
 * When the LLM provides a string to replace that doesn't exactly match the file content
 * (due to whitespace differences, minor formatting, etc.), this module attempts to find
 * the best matching region in the content.
 */

const MIN_FUZZY_MATCH_LEN = 50; // Minimum length for fuzzy matching
const CHUNK_SIZE = 200; // Chunk size for sliding window approach

export interface StringReplacementResult {
  content: string;
  success: boolean;
  error?: Error;
}

/**
 * Performs string replacement with fuzzy matching fallback.
 *
 * First attempts an exact match. If not found and the old string is long enough,
 * attempts fuzzy matching to find the best matching region.
 *
 * @param content - The original content to search in
 * @param oldStr - The string to find and replace
 * @param newStr - The replacement string
 * @returns Object with updated content, success flag, and optional error
 */
export function performStringReplacement(
  content: string,
  oldStr: string,
  newStr: string
): StringReplacementResult {
  // First try exact match
  if (content.includes(oldStr)) {
    // Use split/join instead of replaceAll for broader compatibility
    const updatedContent = content.split(oldStr).join(newStr);
    return { content: updatedContent, success: true };
  }

  // Attempt fuzzy matching
  const { start, end } = findBestMatchRegion(content, oldStr, MIN_FUZZY_MATCH_LEN);

  if (start === -1 || end === -1) {
    return {
      content,
      success: false,
      error: new Error('Approximate match for replacement not found'),
    };
  }

  // Replace the matched region with newStr
  const updatedContent = content.substring(0, start) + newStr + content.substring(end);
  return { content: updatedContent, success: false }; // success=false indicates fuzzy match was used
}

interface MatchRegion {
  start: number;
  end: number;
}

/**
 * Finds the best matching region in content for the given search string.
 * Uses a sliding window approach with overlapping chunks to find the longest
 * matching subsequence.
 *
 * @param content - The content to search in
 * @param oldStr - The string to find
 * @param minMatchLen - Minimum length for a valid match
 * @returns Start and end positions of the best match, or -1,-1 if not found
 */
function findBestMatchRegion(
  content: string,
  oldStr: string,
  minMatchLen: number
): MatchRegion {
  // Early return if strings are too small
  if (oldStr.length < minMatchLen) {
    return { start: -1, end: -1 };
  }

  let bestStart = -1;
  let bestEnd = -1;
  let bestLen = 0;

  // Set a max number of chunks to process to prevent excessive computation
  const maxChunks = 100;
  let chunksProcessed = 0;

  // Use a sliding window approach with overlapping chunks
  // This helps catch matches that might span chunk boundaries
  for (let i = 0; i < oldStr.length && chunksProcessed < maxChunks; i += Math.floor(CHUNK_SIZE / 2)) {
    // Determine the end of this chunk with overlap
    let chunkEnd = i + CHUNK_SIZE;
    if (chunkEnd > oldStr.length) {
      chunkEnd = oldStr.length;
    }

    // Get the current chunk
    const chunk = oldStr.substring(i, chunkEnd);

    // Skip empty or tiny chunks
    if (chunk.length < 10) {
      continue;
    }

    chunksProcessed++;

    // Find all occurrences of this chunk in the content
    let searchStart = 0;
    const maxOccurrences = 100; // Limit number of occurrences to check
    let occurrencesChecked = 0;

    while (occurrencesChecked < maxOccurrences) {
      const idx = content.indexOf(chunk, searchStart);
      if (idx === -1) {
        break;
      }

      occurrencesChecked++;

      // Try to extend the match forward
      let matchStart = idx;
      let matchEnd = idx + chunk.length;
      let matchLen = chunk.length;

      // Store the original i value, we'll need it for backward extension
      const originalI = i;

      // Try to extend forward
      while (matchEnd < content.length && (i + matchLen) < oldStr.length) {
        if (content[matchEnd] === oldStr[i + matchLen]) {
          matchEnd++;
          matchLen++;
        } else {
          break;
        }
      }

      // Try to extend backward
      let backPos = originalI - 1; // Start one position before chunk
      while (matchStart > 0 && backPos >= 0) {
        if (content[matchStart - 1] === oldStr[backPos]) {
          matchStart--;
          backPos--;
        } else {
          break;
        }
      }

      // Update best match if this one is longer
      if (matchLen > bestLen) {
        bestStart = matchStart;
        bestEnd = matchEnd;
        bestLen = matchLen;
      }

      // Move start position for next search
      searchStart = idx + 1;
    }
  }

  if (bestLen >= minMatchLen) {
    return { start: bestStart, end: bestEnd };
  }

  return { start: -1, end: -1 };
}
