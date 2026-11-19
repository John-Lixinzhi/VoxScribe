import React from 'react';
import { Button, Text, View } from '@tarojs/components';
import styles from './index.module.scss';

interface EmptyStateProps {
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export default function EmptyState({ title, description, actionText, onAction }: EmptyStateProps) {
  return (
    <View className={styles.container}>
      <View className={styles.symbol}>
        <View className={styles.symbolLine} />
        <View className={styles.symbolLine} />
        <View className={styles.symbolLine} />
      </View>
      <Text className={styles.title}>{title}</Text>
      <Text className={styles.description}>{description}</Text>
      {actionText && onAction && <Button className={styles.action} onClick={onAction}>{actionText}</Button>}
    </View>
  );
}
