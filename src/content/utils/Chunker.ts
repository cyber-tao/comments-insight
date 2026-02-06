import { SimplifiedNode } from '../../types';
import { DOMSimplifier } from '../DOMSimplifier';
import { AI, TOKENIZER } from '@/config/constants';

export class Chunker {
  /**
   * Chunks a simplified DOM tree into smaller strings based on token limits.
   * It assumes the root node contains a list of children (e.g., comment list),
   * and splits these children into multiple batches.
   *
   * @param rootNode The simplified node of the container element
   * @param maxTokens Approximate max tokens per chunk (default: 4000)
   * @returns Array of HTML strings, each representing a chunk of the container
   */
  static chunkSimplifiedNode(
    rootNode: SimplifiedNode,
    maxTokens: number = AI.DEFAULT_CONTEXT_WINDOW,
  ): string[] {
    if (!rootNode.children || rootNode.children.length === 0) {
      // If no children or not expanded, return the whole thing (it's likely small or empty)
      return [DOMSimplifier.toStringFormat(rootNode)];
    }

    const chunks: string[] = [];
    let currentBatch: SimplifiedNode[] = [];
    let currentSize = 0;

    const maxChars = maxTokens * TOKENIZER.CHARS_PER_TOKEN;
    const simplifier = new DOMSimplifier();

    // Calculate wrapper overhead (open tag + close tag)
    // We create a temporary node without children to measure overhead
    const wrapperNode = { ...rootNode, children: [], childCount: 0, expanded: true };
    const wrapperStr = simplifier.nodeToString(wrapperNode);
    // Rough overhead: wrapper string length (which includes <div...></div>)
    // We will inject children inside.
    const wrapperOverhead = wrapperStr.length;

    for (const child of rootNode.children) {
      const childStr = simplifier.nodeToString(child);
      const childSize = childStr.length;

      if (currentSize + childSize + wrapperOverhead > maxChars && currentBatch.length > 0) {
        // Flush current batch
        chunks.push(this.createChunkString(wrapperNode, currentBatch, simplifier));
        currentBatch = [];
        currentSize = 0;
      }

      currentBatch.push(child);
      currentSize += childSize;
    }

    // Flush remaining
    if (currentBatch.length > 0) {
      chunks.push(this.createChunkString(wrapperNode, currentBatch, simplifier));
    }

    return chunks;
  }

  private static createChunkString(
    wrapper: SimplifiedNode,
    children: SimplifiedNode[],
    simplifier: DOMSimplifier,
  ): string {
    // Create a new node with just this batch of children
    const chunkNode: SimplifiedNode = {
      ...wrapper,
      children: children,
      childCount: children.length,
      expanded: true,
    };
    return simplifier.nodeToString(chunkNode);
  }
}
