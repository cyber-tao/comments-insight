import { Platform } from '../types';

/**
 * PlatformDetector identifies the current platform based on URL and DOM
 */
export class PlatformDetector {
  /**
   * Detect the current platform
   * @returns Platform type
   */
  static detect(): Platform {
    const hostname = window.location.hostname;

    // YouTube
    if (hostname.includes('youtube.com')) {
      return 'youtube';
    }

    // Bilibili
    if (hostname.includes('bilibili.com')) {
      return 'bilibili';
    }

    // Weibo
    if (hostname.includes('weibo.com')) {
      return 'weibo';
    }

    // Douyin
    if (hostname.includes('douyin.com')) {
      return 'douyin';
    }

    // Twitter/X
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      return 'twitter';
    }

    // TikTok
    if (hostname.includes('tiktok.com')) {
      return 'tiktok';
    }

    // Reddit
    if (hostname.includes('reddit.com')) {
      return 'reddit';
    }

    console.warn('[PlatformDetector] Unknown platform:', hostname);
    return 'unknown';
  }

  /**
   * Get post information (URL and title)
   * @returns Post info object
   */
  static getPostInfo(): { url: string; title: string } {
    const platform = this.detect();
    const url = window.location.href;
    let title = document.title;

    try {
      switch (platform) {
        case 'youtube':
          title = this.getYouTubeTitle();
          break;

        case 'bilibili':
          title = this.getBilibiliTitle();
          break;

        case 'weibo':
          title = this.getWeiboTitle();
          break;

        case 'douyin':
          title = this.getDouyinTitle();
          break;

        case 'twitter':
          title = this.getTwitterTitle();
          break;

        case 'tiktok':
          title = this.getTikTokTitle();
          break;

        case 'reddit':
          title = this.getRedditTitle();
          break;

        default:
          // Use document title as fallback
          break;
      }
    } catch (error) {
      console.error('[PlatformDetector] Error getting title:', error);
    }

    return { url, title };
  }

  /**
   * Get YouTube video title
   */
  private static getYouTubeTitle(): string {
    const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
                        document.querySelector('h1.title yt-formatted-string') ||
                        document.querySelector('h1 yt-formatted-string');
    
    return titleElement?.textContent?.trim() || document.title;
  }

  /**
   * Get Bilibili video title
   */
  private static getBilibiliTitle(): string {
    const titleElement = document.querySelector('h1.video-title') ||
                        document.querySelector('.video-title') ||
                        document.querySelector('h1');
    
    return titleElement?.textContent?.trim() || document.title;
  }

  /**
   * Get Weibo post title
   */
  private static getWeiboTitle(): string {
    const titleElement = document.querySelector('.Feed_retweet_reason') ||
                        document.querySelector('.wbpro-feed-content') ||
                        document.querySelector('.txt');
    
    const text = titleElement?.textContent?.trim() || document.title;
    // Limit to first 100 characters
    return text.length > 100 ? text.substring(0, 100) + '...' : text;
  }

  /**
   * Get Douyin video title
   */
  private static getDouyinTitle(): string {
    const titleElement = document.querySelector('.video-info-detail h1') ||
                        document.querySelector('.title') ||
                        document.querySelector('h1');
    
    return titleElement?.textContent?.trim() || document.title;
  }

  /**
   * Get Twitter/X post title
   */
  private static getTwitterTitle(): string {
    const tweetElement = document.querySelector('[data-testid="tweetText"]') ||
                        document.querySelector('.tweet-text');
    
    const text = tweetElement?.textContent?.trim() || document.title;
    // Limit to first 100 characters
    return text.length > 100 ? text.substring(0, 100) + '...' : text;
  }

  /**
   * Get TikTok video title
   */
  private static getTikTokTitle(): string {
    const titleElement = document.querySelector('[data-e2e="browse-video-desc"]') ||
                        document.querySelector('.video-meta-title') ||
                        document.querySelector('h1');
    
    return titleElement?.textContent?.trim() || document.title;
  }

  /**
   * Get Reddit post title
   */
  private static getRedditTitle(): string {
    const titleElement = document.querySelector('h1') ||
                        document.querySelector('[data-test-id="post-content"] h3') ||
                        document.querySelector('.title');
    
    return titleElement?.textContent?.trim() || document.title;
  }

  /**
   * Check if current page is a valid post/video page
   * @returns True if valid
   */
  static isValidPage(): boolean {
    const platform = this.detect();
    const url = window.location.href;

    switch (platform) {
      case 'youtube':
        return url.includes('/watch?v=');

      case 'bilibili':
        return url.includes('/video/') || url.includes('/bangumi/');

      case 'weibo':
        return url.includes('/status/') || url.includes('/detail/');

      case 'douyin':
        return url.includes('/video/');

      case 'twitter':
        return url.includes('/status/');

      case 'tiktok':
        return url.includes('/video/') || url.includes('/@');

      case 'reddit':
        return url.includes('/comments/');

      default:
        return false;
    }
  }

  /**
   * Get platform display name
   * @param platform - Platform type
   * @returns Display name
   */
  static getDisplayName(platform: Platform): string {
    const names: Record<Platform, string> = {
      youtube: 'YouTube',
      bilibili: 'Bilibili',
      weibo: 'Weibo',
      douyin: 'Douyin',
      twitter: 'Twitter/X',
      tiktok: 'TikTok',
      reddit: 'Reddit',
      unknown: 'Unknown',
    };

    return names[platform];
  }
}
