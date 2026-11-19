import React, { useCallback, useEffect, useState } from 'react';
import { Button, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import classnames from 'classnames';
import { getTranscription } from '@/services/transcription';
import type { TranscriptionJob } from '@/types';
import { formatDateTime, formatDuration, formatFileSize, JOB_STATUS_TEXT } from '@/utils/format';
import styles from './index.module.scss';

type ResultTab = 'text' | 'srt' | 'json';

const RESULT_TABS: { value: ResultTab; label: string }[] = [
  { value: 'text', label: 'TXT 文本' },
  { value: 'srt', label: 'SRT 字幕' },
  { value: 'json', label: 'JSON' }
];

export default function ResultPage() {
  const router = useRouter();
  const id = router.params.id || '';
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>('text');
  const [loading, setLoading] = useState(true);

  const loadJob = useCallback(async (showError = true) => {
    if (!id) return;
    try {
      const result = await getTranscription(id);
      setJob(result.job);
    } catch (error) {
      console.error('[Result] 获取任务失败', error);
      if (showError) {
        Taro.showToast({
          title: error instanceof Error ? error.message : '任务加载失败',
          icon: 'none'
        });
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useDidShow(() => {
    void loadJob();
  });

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'processing')) return undefined;
    const timer = setInterval(() => void loadJob(false), 2500);
    return () => clearInterval(timer);
  }, [job?.status, loadJob]);

  usePullDownRefresh(async () => {
    await loadJob();
    await Taro.stopPullDownRefresh();
  });

  const copyCurrent = async () => {
    if (!job?.result) return;
    const content = job.result[activeTab];
    if (!content) {
      Taro.showToast({ title: '当前格式没有内容', icon: 'none' });
      return;
    }
    await Taro.setClipboardData({ data: content });
    Taro.showToast({ title: `${RESULT_TABS.find((tab) => tab.value === activeTab)?.label}已复制`, icon: 'none' });
  };

  if (!id) {
    return (
      <View className={styles.page}>
        <View className={styles.notFound}>缺少任务编号，请从任务列表重新进入。</View>
      </View>
    );
  }

  if (loading && !job) {
    return (
      <View className={styles.page}>
        <View className={styles.loading}>正在读取转写任务...</View>
      </View>
    );
  }

  if (!job) {
    return (
      <View className={styles.page}>
        <View className={styles.notFound}>任务不存在或暂时无法读取。</View>
        <Button className={styles.secondaryButton} onClick={() => void Taro.switchTab({ url: '/pages/tasks/index' })}>
          返回任务列表
        </Button>
      </View>
    );
  }

  const active = job.status === 'queued' || job.status === 'processing';
  const result = job.result;
  const currentContent = result ? result[activeTab] : '';

  return (
    <View className={styles.page}>
      <View className={styles.fileCard}>
        <View className={styles.fileHeader}>
          <Text className={styles.fileName}>{job.fileName}</Text>
          <View className={classnames(styles.status, styles[job.status])}>{JOB_STATUS_TEXT[job.status]}</View>
        </View>
        <View className={styles.fileMeta}>
          <Text>{formatFileSize(job.fileSize)}</Text>
          <Text>{job.model} 模型</Text>
          <Text>{formatDateTime(job.createdAt)}</Text>
        </View>
      </View>

      {active && (
        <View className={styles.progressCard}>
          <View className={styles.progressIcon}>
            <View className={styles.progressDot} />
          </View>
          <Text className={styles.progressTitle}>{job.status === 'queued' ? '任务正在排队' : '正在识别语音内容'}</Text>
          <Text className={styles.progressDesc}>可以离开当前页面，稍后到任务列表查看结果。</Text>
          <View className={styles.progressRow}>
            <View className={styles.progressTrack}>
              <View className={styles.progressValue} style={{ width: `${Math.max(2, job.progress)}%` }} />
            </View>
            <Text className={styles.progressText}>{job.progress}%</Text>
          </View>
          <Button className={styles.secondaryButton} onClick={() => void loadJob()}>
            刷新进度
          </Button>
        </View>
      )}

      {job.status === 'failed' && (
        <View className={styles.failedCard}>
          <Text className={styles.failedTitle}>本次转写未完成</Text>
          <Text className={styles.failedDesc}>{job.error || '文件无法识别，请检查音轨后重试。'}</Text>
          <Button className={styles.primaryButton} onClick={() => void Taro.switchTab({ url: '/pages/index/index' })}>
            重新选择文件
          </Button>
        </View>
      )}

      {job.status === 'completed' && result && (
        <>
          <View className={styles.summaryCard}>
            <View className={styles.summaryItem}>
              <Text className={styles.summaryValue}>{formatDuration(result.duration)}</Text>
              <Text className={styles.summaryLabel}>媒体时长</Text>
            </View>
            <View className={styles.summaryItem}>
              <Text className={styles.summaryValue}>{result.language.toUpperCase()}</Text>
              <Text className={styles.summaryLabel}>识别语言</Text>
            </View>
            <View className={styles.summaryItem}>
              <Text className={styles.summaryValue}>3</Text>
              <Text className={styles.summaryLabel}>结果格式</Text>
            </View>
          </View>

          <View className={styles.resultCard}>
            <View className={styles.tabRow}>
              {RESULT_TABS.map((tab) => (
                <View
                  key={tab.value}
                  className={classnames(styles.tabItem, activeTab === tab.value && styles.tabItemActive)}
                  onClick={() => setActiveTab(tab.value)}
                >
                  {tab.label}
                </View>
              ))}
            </View>
            <ScrollView className={styles.resultContent} scrollY enhanced showScrollbar={false}>
              <Text className={classnames(styles.resultText, activeTab !== 'text' && styles.monospace)}>
                {currentContent || '当前格式未生成内容'}
              </Text>
            </ScrollView>
            <Button className={styles.copyButton} onClick={copyCurrent}>
              复制{RESULT_TABS.find((tab) => tab.value === activeTab)?.label}
            </Button>
          </View>
        </>
      )}

      {job.status === 'completed' && !result && (
        <View className={styles.failedCard}>
          <Text className={styles.failedTitle}>结果内容为空</Text>
          <Text className={styles.failedDesc}>下拉刷新重试，或稍后再查看。</Text>
        </View>
      )}
    </View>
  );
}
