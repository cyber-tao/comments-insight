import { PageController } from '../PageController';
import { CommentExtractor } from '../CommentExtractor';
import { DOMAnalyzer } from '../DOMAnalyzer';

/**
 * Shared singletons for content-script handlers.
 * Instantiated lazily so injection cost is only paid once when the first
 * extraction message arrives.
 */
export interface ContentTools {
  domAnalyzer: DOMAnalyzer;
  pageController: PageController;
  commentExtractor: CommentExtractor;
}

let domAnalyzer: DOMAnalyzer | null = null;
let pageController: PageController | null = null;
let commentExtractor: CommentExtractor | null = null;

export function getTools(): ContentTools {
  if (!domAnalyzer) domAnalyzer = new DOMAnalyzer();
  if (!pageController) pageController = new PageController();
  if (!commentExtractor) commentExtractor = new CommentExtractor(pageController);
  return { domAnalyzer, pageController, commentExtractor };
}
