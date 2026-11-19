import React, { useCallback, useState } from 'react';
import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import classnames from 'classnames';
import EmptyState from '@/components/EmptyState';
import JobCard from '@/components/JobCard';
import { getTranscriptions } from '@/services/transcription';
import type { TranscriptionJob } from '@/types';
import styles from './index.module.scss';

type Filter = 'all' | 'active' | 'completed' | 'failed';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' }
];

export default function TasksPage() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    try {
      const result = await getTranscriptions();
      setJobs(result.jobs);
      console.info('[Tasks] 任务列表已刷新', { count: result.jobs.length });
    } catch (error) {
      console.error('[Tasks] 获取任务列表失败', error);
      Taro.showToast({ title: '任务列表加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }, []);

  useDidShow(() => {
    void loadJobs();
  });

  usePullDownRefresh(async () => {
    await loadJobs();
    await Taro.stopPullDownRefresh();
  });

  const filteredJobs = jobs.filter((job) => {
    if (filter === 'active') return job.status === 'queued' || job.status === 'processing';
    if (filter === 'all') return true;
    return job.status === filter;
  });
  const activeCount = jobs.filter((job) => job.status === 'queued' || job.status === 'processing').length;

  const openResult = (id: string) => {
    void Taro.navigateTo({ url: `/pages/result/index?id=${id}` });
  };

  return (
    <View className={styles.page}>
      <Text className={styles.pageTitle}>我的转写</Text>
      <Text className={styles.pageDesc}>查看识别进度，整理每一次会议与创作。</Text>

      <View className={styles.stats}>
        <View className={styles.statCard}>
          <Text className={styles.statValue}>{jobs.length}</Text>
          <Text className={styles.statLabel}>全部任务</Text>
        </View>
        <View className={styles.statCard}>
          <Text className={styles.statValue}>{activeCount}</Text>
          <Text className={styles.statLabel}>正在处理</Text>
        </View>
      </View>

      <View className={styles.filterRow}>
        {FILTERS.map((item) => (
          <View
            key={item.value}
            className={classnames(styles.filterChip, filter === item.value && styles.filterChipActive)}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </View>
        ))}
      </View>

      {loading ? (
        <View className={styles.loading}>正在读取任务...</View>
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          title={jobs.length === 0 ? '还没有转写任务' : '当前分类没有任务'}
          description={jobs.length === 0 ? '上传一段音视频，TXT 与字幕会出现在这里。' : '切换其他分类看看。'}
          actionText={jobs.length === 0 ? '去转写' : undefined}
          onAction={jobs.length === 0 ? () => void Taro.switchTab({ url: '/pages/index/index' }) : undefined}
        />
      ) : (
        filteredJobs.map((job) => (
          <View key={job._id} className={styles.jobItem}>
            <JobCard job={job} onClick={openResult} />
          </View>
        ))
      )}
    </View>
  );
}
