import React, { useState } from 'react';
import { Button, Switch, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import classnames from 'classnames';
import { createTranscription, uploadMedia } from '@/services/transcription';
import { formatFileSize } from '@/utils/format';
import styles from './index.module.scss';

interface MediaFile {
  name: string;
  path: string;
  size: number;
}

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' }
];

const MODEL_OPTIONS = [
  { value: 'small', label: 'small · 更快' },
  { value: 'medium', label: 'medium · 更准' }
];

const WAVE_HEIGHTS = [32, 56, 80, 56, 32];
const ALLOWED_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'flac', 'mp4', 'mkv'];

export default function IndexPage() {
  const [file, setFile] = useState<MediaFile | null>(null);
  const [language, setLanguage] = useState('auto');
  const [model, setModel] = useState('small');
  const [withSrt, setWithSrt] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleChoose = async () => {
    if (process.env.TARO_ENV !== 'weapp') {
      setFile({ name: '演示访谈录音.m4a', path: 'mock://demo', size: 8_420_000 });
      return;
    }

    try {
      const result = await Taro.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ALLOWED_EXTENSIONS
      });
      const selected = result.tempFiles[0];
      if (selected) {
        setFile({ name: selected.name, path: selected.path, size: selected.size });
        console.info('[Home] 已选择音视频', { name: selected.name, size: selected.size });
      }
    } catch (error) {
      console.info('[Home] 文件选择已取消或不可用', error);
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      Taro.showToast({ title: '请先选择音视频文件', icon: 'none' });
      return;
    }
    if (submitting) {
      return;
    }

    setSubmitting(true);
    try {
      const fileID = await uploadMedia(file.path, file.name);
      const { job } = await createTranscription({
        fileID,
        fileName: file.name,
        fileSize: file.size,
        language,
        model,
        withSrt
      });
      console.info('[Home] 转写任务创建成功', { id: job._id });
      await Taro.navigateTo({ url: `/pages/result/index?id=${job._id}` });
    } catch (error) {
      console.error('[Home] 创建转写任务失败', error);
      Taro.showToast({
        title: error instanceof Error ? error.message : '创建任务失败，请重试',
        icon: 'none'
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className={styles.page}>
      <View className={styles.hero}>
        <View className={styles.brandRow}>
          <View className={styles.waveLogo}>
            {WAVE_HEIGHTS.map((height, index) => (
              <View key={index} className={styles.waveBar} style={{ height: Taro.pxTransform(height) }} />
            ))}
          </View>
          <View>
            <Text className={styles.brandName}>VoxScribe</Text>
            <Text className={styles.brandTag}>faster-whisper 云端识别</Text>
          </View>
        </View>
        <Text className={styles.heroTitle}>音视频转文字，{'\n'}直接拿到 TXT 与 SRT</Text>
        <Text className={styles.heroDesc}>会议、课程、访谈和短视频，上传后自动完成识别与字幕整理。</Text>
        <View className={styles.quotaPill}>新用户含 10 分钟体验额度</View>
      </View>

      <View className={classnames(styles.card, styles.uploadCard)}>
        <View className={styles.uploadIcon}>+</View>
        <Text className={styles.uploadTitle}>{file?.name || '选择要转写的音视频'}</Text>
        <Text className={styles.uploadDesc}>支持 MP3、M4A、WAV、MP4、MKV 等格式</Text>
        {file && <View className={styles.fileMeta}>{formatFileSize(file.size)} · 单文件最大 200 MB</View>}
        <Button className={styles.chooseButton} onClick={handleChoose}>
          {file ? '重新选择' : process.env.TARO_ENV === 'weapp' ? '从微信聊天选择' : '选择演示文件'}
        </Button>
      </View>

      <View className={styles.card}>
        <Text className={styles.sectionTitle}>识别设置</Text>
        <Text className={styles.optionLabel}>音频语言</Text>
        <View className={styles.optionRow}>
          {LANGUAGE_OPTIONS.map((option) => (
            <View
              key={option.value}
              className={classnames(styles.optionChip, language === option.value && styles.optionChipActive)}
              onClick={() => setLanguage(option.value)}
            >
              {option.label}
            </View>
          ))}
        </View>

        <Text className={styles.optionLabel}>识别模型</Text>
        <View className={styles.optionRow}>
          {MODEL_OPTIONS.map((option) => (
            <View
              key={option.value}
              className={classnames(styles.optionChip, model === option.value && styles.optionChipActive)}
              onClick={() => setModel(option.value)}
            >
              {option.label}
            </View>
          ))}
        </View>

        <View className={styles.switchRow}>
          <View>
            <Text className={styles.switchTitle}>同时生成 SRT 字幕</Text>
            <Text className={styles.switchDesc}>保留每段文字的开始与结束时间</Text>
          </View>
          <Switch
            checked={withSrt}
            color='#3157d5'
            onChange={(event) => setWithSrt(event.detail.value)}
          />
        </View>
      </View>

      <Button
        className={classnames(styles.submitButton, submitting && styles.submitButtonDisabled)}
        disabled={submitting}
        onClick={handleSubmit}
      >
        {submitting ? '正在上传并创建任务' : '开始转写'}
      </Button>
      <Text className={styles.footnote}>任务完成后按实际媒体时长扣减额度；识别结果仅供本人查看。</Text>
    </View>
  );
}
