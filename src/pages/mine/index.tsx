import React, { useCallback, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import classnames from 'classnames';
import { getAccount } from '@/services/account';
import type { Account, Order } from '@/types';
import { formatDateTime, formatDuration, formatPrice } from '@/utils/format';
import styles from './index.module.scss';

const ORDER_STATUS_TEXT: Record<Order['status'], string> = {
  pending: '待支付',
  paid: '已支付',
  failed: '已关闭'
};

export default function MinePage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAccount = useCallback(async () => {
    try {
      const result = await getAccount();
      setAccount(result.account);
      setOrders(result.recentOrders);
    } catch (error) {
      console.error('[Mine] 获取账户信息失败', error);
      Taro.showToast({ title: '账户信息加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }, []);

  useDidShow(() => {
    void loadAccount();
  });

  usePullDownRefresh(async () => {
    await loadAccount();
    await Taro.stopPullDownRefresh();
  });

  const remainingMinutes = account ? Math.floor(account.remainingSeconds / 60) : 0;

  return (
    <View className={styles.page}>
      <View className={styles.profile}>
        <View className={styles.avatar}>V</View>
        <View className={styles.profileText}>
          <Text className={styles.nickname}>{account?.nickname || '微信用户'}</Text>
          <Text className={styles.profileDesc}>云端识别记录仅当前账号可见</Text>
        </View>
      </View>

      <View className={styles.quotaCard}>
        <Text className={styles.quotaLabel}>剩余转写时长</Text>
        <View className={styles.quotaValueRow}>
          <Text className={styles.quotaValue}>{loading && !account ? '--' : remainingMinutes}</Text>
          <Text className={styles.quotaUnit}>分钟</Text>
        </View>
        <Text className={styles.quotaMeta}>
          累计使用 {account ? formatDuration(account.usedSeconds) : '--'} · 新用户赠送 10 分钟
        </Text>
        <Button
          className={styles.rechargeButton}
          onClick={() => void Taro.navigateTo({ url: '/pages/plans/index' })}
        >
          购买时长包
        </Button>
      </View>

      <View className={styles.actionRow}>
        <View className={styles.actionItem} onClick={() => void Taro.switchTab({ url: '/pages/index/index' })}>
          <View className={classnames(styles.actionIcon, styles.actionIconPrimary)}>↑</View>
          <Text className={styles.actionTitle}>新建转写</Text>
          <Text className={styles.actionDesc}>上传音视频</Text>
        </View>
        <View className={styles.actionItem} onClick={() => void Taro.switchTab({ url: '/pages/tasks/index' })}>
          <View className={classnames(styles.actionIcon, styles.actionIconSuccess)}>✓</View>
          <Text className={styles.actionTitle}>转写任务</Text>
          <Text className={styles.actionDesc}>查看识别结果</Text>
        </View>
      </View>

      <View className={styles.section}>
        <View className={styles.sectionHeader}>
          <Text className={styles.sectionTitle}>最近订单</Text>
          <Text className={styles.sectionLink} onClick={() => void Taro.navigateTo({ url: '/pages/plans/index' })}>
            时长套餐
          </Text>
        </View>
        {orders.length === 0 ? (
          <View className={styles.emptyOrders}>暂无充值订单，已支付的时长包会显示在这里。</View>
        ) : (
          orders.slice(0, 5).map((order) => (
            <View className={styles.orderItem} key={order._id}>
              <View className={styles.orderMain}>
                <Text className={styles.orderName}>{order.planName}</Text>
                <Text className={styles.orderMeta}>
                  {formatDateTime(order.createdAt)} · {formatDuration(order.seconds)}
                </Text>
              </View>
              <View className={styles.orderSide}>
                <Text className={styles.orderPrice}>¥{formatPrice(order.amountFen)}</Text>
                <Text className={classnames(styles.orderStatus, styles[order.status])}>
                  {ORDER_STATUS_TEXT[order.status]}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>服务说明</Text>
        <View className={styles.infoRow}>
          <Text>识别引擎</Text>
          <Text className={styles.infoValue}>faster-whisper</Text>
        </View>
        <View className={styles.infoRow}>
          <Text>结果格式</Text>
          <Text className={styles.infoValue}>TXT / SRT / JSON</Text>
        </View>
        <View className={styles.infoRow}>
          <Text>计费方式</Text>
          <Text className={styles.infoValue}>按实际媒体时长扣减</Text>
        </View>
      </View>

      <Text className={styles.version}>VoxScribe Mini · 音视频转文字</Text>
    </View>
  );
}
