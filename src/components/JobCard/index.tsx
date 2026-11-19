import React from 'react';
import { Text, View } from '@tarojs/components';
import classnames from 'classnames';
import type { TranscriptionJob } from '@/types';
import { formatDateTime, formatDuration, formatFileSize, JOB_STATUS_TEXT } from '@/utils/format';
import styles from './index.module.scss';

interface JobCardProps {
  job: TranscriptionJob;
  onClick: (id: string) => void;
}

export default function JobCard({ job, onClick }: JobCardProps) {
  const active = job.status === 'queued' || job.status === 'processing';
  return (
    <View className={styles.card} onClick={() => onClick(job._id)}>
      <View className={styles.header}>
        <Text className={styles.fileName}>{job.fileName}</Text>
        <View className={classnames(styles.status, styles[job.status])}>{JOB_STATUS_TEXT[job.status]}</View>
      </View>
      <View className={styles.meta}>
        <Text>{formatFileSize(job.fileSize)}</Text>
        <Text>{formatDateTime(job.createdAt)}</Text>
        <Text>{job.model}</Text>
      </View>
      {active && (
        <View className={styles.progressSection}>
          <View className={styles.progressTrack}>
            <View className={styles.progressValue} style={{ width: `${Math.max(2, job.progress)}%` }} />
          </View>
          <Text className={styles.progressText}>{job.progress}%</Text>
        </View>
      )}
      {job.status === 'failed' && <Text className={styles.error}>{job.error || '转写失败，请重试'}</Text>}
      {job.status === 'completed' && job.result && (
        <Text className={styles.resultMeta}>识别 {formatDuration(job.result.duration)} · TXT / SRT 已生成</Text>
      )}
    </View>
  );
}
