import React, { useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import classnames from 'classnames';
import PlanCard from '@/components/PlanCard';
import { createOrder, getPlans } from '@/services/order';
import type { Plan } from '@/types';
import { formatDuration, formatPrice } from '@/utils/format';
import styles from './index.module.scss';

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState('minutes_240');
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  useDidShow(() => {
    const loadPlans = async () => {
      try {
        const result = await getPlans();
        setPlans(result.plans);
        if (!result.plans.some((plan) => plan.id === selectedId) && result.plans[0]) {
          setSelectedId(result.plans[0].id);
        }
      } catch (error) {
        console.error('[Plans] 套餐加载失败', error);
        Taro.showToast({ title: '套餐加载失败', icon: 'none' });
      } finally {
        setLoading(false);
      }
    };
    void loadPlans();
  });

  const selectedPlan = plans.find((plan) => plan.id === selectedId);

  const handlePurchase = async () => {
    if (!selectedPlan || purchasing) return;
    setPurchasing(true);
    try {
      const { payment } = await createOrder(selectedPlan.id);
      if (!payment) {
        Taro.showToast({
          title: process.env.TARO_ENV === 'weapp' ? '支付能力尚未配置' : '演示环境不会扣款或增加时长',
          icon: 'none',
          duration: 2500
        });
        return;
      }

      await Taro.requestPayment({
        timeStamp: payment.timeStamp,
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType,
        paySign: payment.paySign
      });
      Taro.showToast({ title: '支付完成，时长将陆续到账', icon: 'none', duration: 2200 });
      setTimeout(() => void Taro.switchTab({ url: '/pages/mine/index' }), 1800);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('cancel')) {
        console.error('[Plans] 创建或调用支付失败', error);
        Taro.showToast({ title: message || '支付未完成，请重试', icon: 'none' });
      } else {
        Taro.showToast({ title: '已取消支付', icon: 'none' });
      }
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <View className={styles.page}>
      <View className={styles.hero}>
        <Text className={styles.heroEyebrow}>VOXSCRIBE PASS</Text>
        <Text className={styles.heroTitle}>把时间留给内容，{'\n'}转写交给 VoxScribe</Text>
        <Text className={styles.heroDesc}>按需购买，不设有效期。支付成功后，时长计入当前微信账号。</Text>
      </View>

      <View className={styles.sectionHeader}>
        <Text className={styles.sectionTitle}>选择时长包</Text>
        <Text className={styles.sectionHint}>一次购买，多任务共用</Text>
      </View>

      {loading ? (
        <View className={styles.loading}>正在读取套餐...</View>
      ) : (
        <View className={styles.planList}>
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} selected={selectedId === plan.id} onSelect={setSelectedId} />
          ))}
        </View>
      )}

      <View className={styles.benefitCard}>
        <Text className={styles.benefitTitle}>所有套餐均包含</Text>
        <View className={styles.benefitRow}>
          <Text className={styles.benefitItem}>自动语言识别</Text>
          <Text className={styles.benefitItem}>TXT 纯文本</Text>
        </View>
        <View className={styles.benefitRow}>
          <Text className={styles.benefitItem}>SRT 时间轴字幕</Text>
          <Text className={styles.benefitItem}>JSON 分段数据</Text>
        </View>
      </View>

      <View className={styles.notice}>
        <Text className={styles.noticeTitle}>计费说明</Text>
        <Text className={styles.noticeText}>任务完成后按实际媒体时长扣减，不足 1 秒按 1 秒计。识别失败不扣减时长。</Text>
      </View>

      <View className={styles.purchaseBar}>
        <View className={styles.selectedSummary}>
          <Text className={styles.selectedName}>{selectedPlan ? selectedPlan.name : '请选择套餐'}</Text>
          <Text className={styles.selectedMeta}>
            {selectedPlan ? `${formatDuration(selectedPlan.seconds)} · ¥${formatPrice(selectedPlan.priceFen)}` : ''}
          </Text>
        </View>
        <Button
          className={classnames(styles.purchaseButton, purchasing && styles.purchaseButtonDisabled)}
          disabled={!selectedPlan || purchasing}
          onClick={handlePurchase}
        >
          {purchasing ? '正在创建订单' : '立即支付'}
        </Button>
      </View>
      <Text className={styles.paymentNote}>未配置微信支付商户号时不会发起真实扣款。</Text>
    </View>
  );
}
