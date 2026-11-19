import React from 'react';
import { Text, View } from '@tarojs/components';
import classnames from 'classnames';
import type { Plan } from '@/types';
import { formatDuration, formatPrice } from '@/utils/format';
import styles from './index.module.scss';

interface PlanCardProps {
  plan: Plan;
  selected: boolean;
  onSelect: (id: string) => void;
}

export default function PlanCard({ plan, selected, onSelect }: PlanCardProps) {
  const unitPrice = (plan.priceFen / 100 / (plan.seconds / 60)).toFixed(2);
  return (
    <View
      className={classnames(styles.card, selected && styles.cardSelected)}
      onClick={() => onSelect(plan.id)}
    >
      <View className={styles.main}>
        <View className={styles.nameRow}>
          <Text className={styles.name}>{plan.name}</Text>
          {plan.tag && <View className={styles.tag}>{plan.tag}</View>}
        </View>
        <Text className={styles.duration}>{formatDuration(plan.seconds)}转写额度</Text>
        <Text className={styles.description}>{plan.description}</Text>
      </View>
      <View className={styles.side}>
        <View className={styles.priceRow}>
          <Text className={styles.currency}>¥</Text>
          <Text className={styles.price}>{formatPrice(plan.priceFen)}</Text>
        </View>
        <Text className={styles.unitPrice}>约 ¥{unitPrice} / 分钟</Text>
        <View className={classnames(styles.radio, selected && styles.radioSelected)}>
          {selected && <View className={styles.radioInner} />}
        </View>
      </View>
    </View>
  );
}
