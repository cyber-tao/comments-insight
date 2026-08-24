import { SimplifiedNode } from '../../types';
import { DOMSimplifier } from '../DOMSimplifier';
import { AI } from '@/config/constants';
import { Tokenizer } from '@/utils/tokenizer';

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
    const simplifier = new DOMSimplifier();
    const tokenLimit = Math.max(1, Math.floor(maxTokens));
    const serialized = simplifier.nodeToString(rootNode);
    if (Tokenizer.estimateTokens(serialized) <= tokenLimit) {
      return [serialized];
    }

    if (!rootNode.children || rootNode.children.length === 0) {
      return this.splitTextByTokenBudget(serialized, tokenLimit);
    }

    const wrapperNode = { ...rootNode, children: [], childCount: 0, expanded: true };
    const wrapper = simplifier.nodeToString(wrapperNode);
    if (Tokenizer.estimateTokens(wrapper) >= tokenLimit) {
      return this.splitTextByTokenBudget(serialized, tokenLimit);
    }

    const chunks: string[] = [];
    let currentBatch: SimplifiedNode[] = [];

    const flushCurrentBatch = (): void => {
      if (currentBatch.length === 0) {
        return;
      }
      chunks.push(this.createChunkString(wrapperNode, currentBatch, simplifier));
      currentBatch = [];
    };

    for (const child of rootNode.children) {
      const candidate = this.createChunkString(wrapperNode, [...currentBatch, child], simplifier);
      if (Tokenizer.estimateTokens(candidate) <= tokenLimit) {
        currentBatch.push(child);
        continue;
      }

      flushCurrentBatch();
      const singleChildChunk = this.createChunkString(wrapperNode, [child], simplifier);
      if (Tokenizer.estimateTokens(singleChildChunk) <= tokenLimit) {
        currentBatch.push(child);
      } else {
        chunks.push(...this.chunkSimplifiedNode(child, tokenLimit));
      }
    }

    flushCurrentBatch();
    return chunks.length > 0 ? chunks : this.splitTextByTokenBudget(serialized, tokenLimit);
  }

  private static splitTextByTokenBudget(text: string, maxTokens: number): string[] {
    const chunks: string[] = [];
    let offset = 0;

    while (offset < text.length) {
      let low = offset + 1;
      let high = text.length;
      let bestEnd = low;

      while (low <= high) {
        const midpoint = Math.floor((low + high) / 2);
        if (Tokenizer.estimateTokens(text.slice(offset, midpoint)) <= maxTokens) {
          bestEnd = midpoint;
          low = midpoint + 1;
        } else {
          high = midpoint - 1;
        }
      }

      chunks.push(text.slice(offset, bestEnd));
      offset = bestEnd;
    }

    return chunks.length > 0 ? chunks : [''];
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
