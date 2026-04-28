import { describe, it, expect } from 'vitest';
import { generateCommentHash } from '@/utils/comment-hash';
import type { Comment } from '@/types';

// Helper function to create a comment object
function createComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'test-id',
    username: 'testuser',
    timestamp: '2024-01-01',
    likes: 0,
    content: 'Test content',
    replies: [],
    ...overrides,
  };
}

describe('comment-hash', () => {
  describe('generateCommentHash', () => {
    it('should generate a hash string', () => {
      const comment = createComment();
      const hash = generateCommentHash(comment);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should generate same hash for identical comments', () => {
      const comment1 = createComment({
        username: 'user1',
        content: 'Same content',
        timestamp: '2024-01-01',
      });
      const comment2 = createComment({
        username: 'user1',
        content: 'Same content',
        timestamp: '2024-01-01',
      });

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different content', () => {
      const comment1 = createComment({ content: 'Content A' });
      const comment2 = createComment({ content: 'Content B' });

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash for different usernames', () => {
      const comment1 = createComment({ username: 'user1' });
      const comment2 = createComment({ username: 'user2' });

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash for different timestamps', () => {
      const comment1 = createComment({ timestamp: '2024-01-01' });
      const comment2 = createComment({ timestamp: '2024-01-02' });

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty content', () => {
      const comment = createComment({ content: '' });
      const hash = generateCommentHash(comment);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle empty username', () => {
      const comment = createComment({ username: '' });
      const hash = generateCommentHash(comment);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle empty timestamp', () => {
      const comment = createComment({ timestamp: '' });
      const hash = generateCommentHash(comment);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle special characters in content', () => {
      const comment = createComment({
        content: '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~',
      });
      const hash = generateCommentHash(comment);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle unicode characters', () => {
      const comment = createComment({
        content: '你好世界 こんにちは 🌍🎉',
        username: '用户名',
      });
      const hash = generateCommentHash(comment);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle emoji content', () => {
      const comment = createComment({
        content: '😀😃😄😁😆😅😂🤣',
      });
      const hash = generateCommentHash(comment);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle newlines and whitespace', () => {
      const comment1 = createComment({ content: 'Line 1\nLine 2\tTab' });
      const comment2 = createComment({ content: 'Line 1 Line 2 Tab' });

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      // Different whitespace should produce different hashes
      expect(hash1).not.toBe(hash2);
    });

    it('should handle very long content', () => {
      const longContent = 'A'.repeat(10000);
      const comment = createComment({ content: longContent });
      const hash = generateCommentHash(comment);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should include content length in hash calculation', () => {
      // These have same content but different lengths
      const comment1 = createComment({ content: 'abc' });
      const comment2 = createComment({ content: 'abc ' }); // trailing space

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      // Different content lengths should produce different hashes
      expect(hash1).not.toBe(hash2);
    });

    it('should produce consistent hashes across multiple calls', () => {
      const comment = createComment({
        username: 'consistent',
        content: 'Consistent content',
        timestamp: '2024-06-15',
      });

      const hashes = Array.from({ length: 10 }, () => generateCommentHash(comment));
      const uniqueHashes = new Set(hashes);

      expect(uniqueHashes.size).toBe(1);
    });

    it('should generate base-36 encoded hash', () => {
      const comment = createComment();
      const hash = generateCommentHash(comment);

      // Base-36 should only contain 0-9 and a-z
      expect(hash).toMatch(/^[0-9a-z]+$/);
    });

    it('should handle comments with same content but different metadata', () => {
      const comment1 = createComment({
        id: 'id-1',
        username: 'user1',
        content: 'Same',
        timestamp: '2024-01-01',
        likes: 100,
      });
      const comment2 = createComment({
        id: 'id-2',
        username: 'user1',
        content: 'Same',
        timestamp: '2024-01-01',
        likes: 200,
      });

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      // id and likes are not included in hash, so these should be same
      expect(hash1).toBe(hash2);
    });

    it('should be deterministic regardless of other comment properties', () => {
      const comment1 = createComment({
        username: 'testuser',
        content: 'test',
        timestamp: '2024-01-01',
        userId: 'uid1',
        platform: 'youtube',
        isHot: true,
        replies: [createComment({ content: 'reply' })],
      });
      const comment2 = createComment({
        username: 'testuser',
        content: 'test',
        timestamp: '2024-01-01',
        userId: 'uid2',
        platform: 'twitter',
        isHot: false,
        replies: [],
      });

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      // Only username, content, and timestamp affect the hash
      expect(hash1).toBe(hash2);
    });
  });

  describe('hash uniqueness', () => {
    it('should generate unique hashes for similar but different comments', () => {
      const comments = [
        createComment({ content: 'Hello' }),
        createComment({ content: 'hello' }), // different case
        createComment({ content: 'Hello ' }), // trailing space
        createComment({ content: ' Hello' }), // leading space
        createComment({ content: 'Helloo' }), // extra character
      ];

      const hashes = comments.map(generateCommentHash);
      const uniqueHashes = new Set(hashes);

      expect(uniqueHashes.size).toBe(comments.length);
    });

    it('should generate different hashes for comments with swapped values', () => {
      const comment1 = createComment({
        username: 'Alice',
        content: 'Bob',
        timestamp: '2024',
      });
      const comment2 = createComment({
        username: 'Bob',
        content: 'Alice',
        timestamp: '2024',
      });

      const hash1 = generateCommentHash(comment1);
      const hash2 = generateCommentHash(comment2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('collision resistance', () => {
    it('should have low collision rate for random comments', () => {
      const randomString = () => Math.random().toString(36).substring(2);
      const comments = Array.from({ length: 1000 }, () =>
        createComment({
          username: randomString(),
          content: randomString() + randomString(),
          timestamp: randomString(),
        }),
      );

      const hashes = comments.map(generateCommentHash);
      const uniqueHashes = new Set(hashes);

      // Expect very few or no collisions
      expect(uniqueHashes.size).toBeGreaterThanOrEqual(990);
    });
  });
});
