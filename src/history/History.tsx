import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HistoryItem, Comment } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { exportCommentsAsCSV, exportAnalysisAsMarkdown, exportCompleteData } from '../utils/export';
import i18n from '../utils/i18n';

const History: React.FC = () => {
  const { t } = useTranslation();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'comments' | 'analysis'>('analysis');

  useEffect(() => {
    // Load language from settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
      if (response?.settings?.language) {
        i18n.changeLanguage(response.settings.language);
      }
    });

    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      
      if (chrome.runtime.lastError) {
        console.error('[History] Failed to load history:', chrome.runtime.lastError);
        return;
      }
      
      if (response?.history) {
        setHistory(response.history);
      }
    } catch (error) {
      console.error('[History] Failed to load history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadHistory();
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_HISTORY',
        payload: { query: searchQuery },
      });
      if (response?.items) {
        setHistory(response.items);
      }
    } catch (error) {
      console.error('Failed to search:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('history.deleteConfirm'))) return;

    try {
      await chrome.runtime.sendMessage({
        type: 'DELETE_HISTORY',
        payload: { id },
      });
      setHistory(history.filter((item) => item.id !== id));
      if (selectedItem?.id === id) {
        setSelectedItem(null);
      }
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const handleClearAll = async () => {
    if (!confirm(t('history.clearAllConfirm'))) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLEAR_ALL_HISTORY',
      });
      
      if (response?.success) {
        setHistory([]);
        setSelectedItem(null);
      }
    } catch (error) {
      console.error('Failed to clear all:', error);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getPlatformIcon = (platform: string) => {
    const icons: Record<string, string> = {
      youtube: '📺',
      bilibili: '📱',
      weibo: '🐦',
      douyin: '🎵',
      twitter: '🐦',
      tiktok: '🎵',
      reddit: '🤖',
    };
    return icons[platform] || '❓';
  };

  const renderCommentTree = (comments: Comment[], depth = 0) => {
    return (
      <div className={`${depth > 0 ? 'ml-6 border-l-2 border-gray-200 pl-4' : ''}`}>
        {comments.map((comment) => (
          <div key={comment.id} className="mb-4">
            <div className="bg-gray-50 p-3 rounded">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-gray-800">{comment.username}</span>
                <span className="text-xs text-gray-500">{comment.timestamp}</span>
                <span className="text-xs text-gray-500">👍 {comment.likes}</span>
              </div>
              <p className="text-gray-700">{comment.content}</p>
            </div>
            {comment.replies && comment.replies.length > 0 && (
              <div className="mt-2">{renderCommentTree(comment.replies, depth + 1)}</div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - History List */}
      <div className="w-1/3 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">{t('history.title')}</h2>
            {history.length > 0 && (
              <button
                onClick={handleClearAll}
                className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
              >
                🗑️ {t('history.clearAll')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('history.searchPlaceholder')}
              className="flex-1 px-3 py-2 border rounded"
            />
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              🔍
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500">{t('common.loading')}</div>
          ) : history.length === 0 ? (
            <div className="p-4 text-center text-gray-500">{t('history.noHistory')}</div>
          ) : (
            <div className="divide-y">
              {history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedItem?.id === item.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-2xl">{getPlatformIcon(item.platform)}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-800 truncate">{item.title}</h3>
                      <p className="text-xs text-gray-500">{formatDate(item.extractedAt)}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id);
                      }}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      🗑️
                    </button>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>💬 {item.commentsCount} comments</span>
                    {item.analysis && <span>🔥 {item.analysis.tokensUsed} tokens</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Details */}
      <div className="flex-1 flex flex-col">
        {selectedItem ? (
          <>
            {/* Header */}
            <div className="bg-white border-b p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold">{selectedItem.title}</h2>
                <a
                  href={selectedItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                >
                  {t('history.openOriginal')}
                </a>
              </div>
              <div className="flex gap-4 text-sm text-gray-600">
                <span>{getPlatformIcon(selectedItem.platform)} {selectedItem.platform}</span>
                <span>📅 {formatDate(selectedItem.extractedAt)}</span>
                <span>💬 {selectedItem.commentsCount} comments</span>
              </div>
            </div>

            {/* View Mode Tabs */}
            <div className="bg-white border-b px-4">
              <div className="flex gap-4">
                <button
                  onClick={() => setViewMode('analysis')}
                  className={`px-4 py-2 border-b-2 transition-colors ${
                    viewMode === 'analysis'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-800'
                  }`}
                >
                  📊 {t('history.analysis')}
                </button>
                <button
                  onClick={() => setViewMode('comments')}
                  className={`px-4 py-2 border-b-2 transition-colors ${
                    viewMode === 'comments'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-800'
                  }`}
                >
                  💬 {t('history.comments')}
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {viewMode === 'analysis' ? (
                <div className="prose prose-sm md:prose-base max-w-none prose-table:border-collapse prose-th:border prose-th:border-gray-300 prose-th:bg-gray-100 prose-th:p-2 prose-td:border prose-td:border-gray-300 prose-td:p-2">
                  {selectedItem.analysis ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedItem.analysis.markdown}
                    </ReactMarkdown>
                  ) : (
                    <div className="text-center text-gray-500 py-8">
                      No analysis available yet
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="mb-4 flex justify-between items-center">
                    <h3 className="text-lg font-semibold">
                      {t('history.allComments')} ({selectedItem.comments.length})
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => exportCommentsAsCSV(selectedItem.comments)}
                        className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
                        title="Export comments as CSV"
                      >
                        📄 CSV
                      </button>
                      <button
                        onClick={() => exportAnalysisAsMarkdown(selectedItem)}
                        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                        title="Export analysis as Markdown"
                      >
                        📝 Markdown
                      </button>
                      <button
                        onClick={() => exportCompleteData(selectedItem)}
                        className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm"
                        title="Export complete data as JSON"
                      >
                        📦 JSON
                      </button>
                    </div>
                  </div>
                  {renderCommentTree(selectedItem.comments)}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <p className="text-xl mb-2">📜</p>
              <p>{t('history.selectItem')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default History;

