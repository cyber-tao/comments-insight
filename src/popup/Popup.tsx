import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Task } from '../types';
import i18n from '../utils/i18n';

const Popup: React.FC = () => {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [isValidPage, setIsValidPage] = useState(false);
  const [postInfo, setPostInfo] = useState<{ url: string; title: string } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);

  useEffect(() => {
    // Load language from settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
      if (response?.settings?.language) {
        i18n.changeLanguage(response.settings.language);
      }
    });

    // Get platform info from content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: 'GET_PLATFORM_INFO' },
          (response) => {
            // Check for errors (e.g., content script not loaded)
            if (chrome.runtime.lastError) {
              console.log('[Popup] Content script not available:', chrome.runtime.lastError.message);
              // Set default values for non-supported pages
              setPlatform('unknown');
              setIsValidPage(false);
              setPostInfo(null);
              return;
            }
            
            if (response) {
              setPlatform(response.platform);
              setIsValidPage(response.isValid);
              setPostInfo(response.postInfo);
            }
          }
        );
      }
    });

    // Get current tasks
    chrome.runtime.sendMessage({ type: 'GET_TASK_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Popup] Failed to get task status:', chrome.runtime.lastError);
        return;
      }
      
      if (response?.tasks) {
        setTasks(response.tasks);
      }
    });

    // Listen for task updates
    const handleMessage = (message: any) => {
      if (message.type === 'TASK_UPDATE') {
        setTasks((prev) => {
          const index = prev.findIndex((t) => t.id === message.payload.id);
          if (index >= 0) {
            const newTasks = [...prev];
            newTasks[index] = message.payload;
            return newTasks;
          }
          return [...prev, message.payload];
        });
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleStartExtraction = async () => {
    if (!isValidPage || !postInfo) return;

    setIsExtracting(true);
    try {
      // Get settings for maxComments
      const settingsResponse = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      const maxComments = settingsResponse?.settings?.maxComments || 100;

      const response = await chrome.runtime.sendMessage({
        type: 'START_EXTRACTION',
        payload: {
          url: postInfo.url,
          platform,
          maxComments,
        },
      });

      if (response?.taskId) {
        console.log('Extraction started:', response.taskId);
      }
    } catch (error) {
      console.error('Failed to start extraction:', error);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      await chrome.runtime.sendMessage({
        type: 'CANCEL_TASK',
        payload: { taskId },
      });
    } catch (error) {
      console.error('Failed to cancel task:', error);
    }
  };

  const getPlatformIcon = (p: Platform) => {
    const icons: Record<Platform, string> = {
      youtube: '📺',
      bilibili: '📱',
      weibo: '🐦',
      douyin: '🎵',
      twitter: '🐦',
      tiktok: '🎵',
      reddit: '🤖',
      unknown: '❓',
    };
    return icons[p];
  };

  const getStatusColor = (status: Task['status']) => {
    const colors = {
      pending: 'bg-gray-200 text-gray-700',
      running: 'bg-blue-200 text-blue-700',
      completed: 'bg-green-200 text-green-700',
      failed: 'bg-red-200 text-red-700',
    };
    return colors[status];
  };

  return (
    <div className="w-96 p-4 bg-white">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">{t('popup.title')}</h1>
        <p className="text-sm text-gray-500">{t('common.appName')}</p>
      </div>

      {/* Platform Info */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">{getPlatformIcon(platform)}</span>
          <div className="flex-1">
            <p className="font-medium text-gray-800">
              {platform === 'unknown' ? t('popup.unknownPlatform') : platform.toUpperCase()}
            </p>
            <p className="text-xs text-gray-500">
              {isValidPage ? `✓ ${t('popup.validPage')}` : `✗ ${t('popup.invalidPage')}`}
            </p>
          </div>
        </div>
        {postInfo && (
          <p className="text-sm text-gray-600 truncate" title={postInfo.title}>
            {postInfo.title}
          </p>
        )}
      </div>

      {/* Action Button */}
      <button
        onClick={handleStartExtraction}
        disabled={!isValidPage || isExtracting}
        className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
          !isValidPage || isExtracting
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-blue-500 text-white hover:bg-blue-600'
        }`}
      >
        {isExtracting ? t('popup.starting') : t('popup.startExtraction')}
      </button>

      {/* Quick Links */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="flex-1 py-2 px-3 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          ⚙️ {t('popup.openSettings')}
        </button>
        <button
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/history/index.html') })}
          className="flex-1 py-2 px-3 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          📜 {t('popup.openHistory')}
        </button>
      </div>

      {/* Tasks List */}
      {tasks.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">{t('popup.recentTasks')}</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {tasks.slice(0, 5).map((task) => (
              <div key={task.id} className="p-2 bg-gray-50 rounded text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(task.status)}`}>
                    {t(`task.${task.status}`)}
                  </span>
                  <span className="text-xs text-gray-500">{t(`task.${task.type}`)}</span>
                </div>
                {task.status === 'running' && (
                  <div className="mt-1">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-xs text-gray-500">{task.progress}%</span>
                      <button
                        onClick={() => handleCancelTask(task.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        {t('task.cancel')}
                      </button>
                    </div>
                  </div>
                )}
                {task.error && (
                  <p className="text-xs text-red-500 mt-1">{task.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Popup;
