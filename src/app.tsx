import React, { useEffect } from 'react';
import Taro from '@tarojs/taro';
import './app.scss';

interface AppProps {
  children?: React.ReactNode;
}

function App(props: AppProps) {
  useEffect(() => {
    if (process.env.TARO_ENV === 'weapp') {
      Taro.cloud.init({ env: '', traceUser: true });
      console.info('[Cloud] 微信云开发已初始化');
    }
  }, []);

  return props.children;
}

export default App;
